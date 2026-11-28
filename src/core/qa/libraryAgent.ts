import type { ChatMessage, LlmClient, ReasoningLevel, ToolCall, ToolSpec } from '../llm/types';
import type { Tracer } from '../trace/tracer';
import { formatTime } from '../transcript/captions';
import type { CaptionLine } from '../types';
import { resolveCitations, type Citation } from './citations';

/**
 * Questions across every video the user has analysed ("which video explained X", "how do these
 * two differ"). The library does not fit in one prompt, so this is where an agent earns its
 * keep: it searches segment summaries and transcript windows, reads the passages it needs, and
 * answers with citations into each video. Citations are checked against what it actually read.
 */

export interface LibraryVideo {
  videoId: string;
  bvid: string;
  title: string;
  durationSec: number;
  tldr?: string;
}

export interface LibraryHit {
  videoId: string;
  bvid: string;
  title: string;
  fromLine: number;
  toLine: number;
  start: number;
  end: number;
  text: string;
  context?: string;
}

export interface LibraryEnv {
  listVideos(): Promise<LibraryVideo[]>;
  search(query: string, k: number): Promise<LibraryHit[]>;
  lines(bvid: string): Promise<CaptionLine[] | undefined>;
}

export type AgentEvent =
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; summary: string }
  | { type: 'delta'; text: string };

export interface LibraryAnswer {
  answer: string;
  citations: Citation[];
  steps: number;
}

const TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'list_videos',
      description: '列出知识库里所有分析过的视频：BV 号、标题、时长、一句话总结。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_library',
      description: '在所有视频的片段摘要和字幕里检索，返回最相关的片段（BV 号、行号范围、原文）。换几种说法多查几次效果更好。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '检索词，写成视频里可能出现的说法' }, k: { type: 'number', description: '返回条数，默认 6，最多 10' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_transcript',
      description: '读取某个视频一段行号范围内的完整字幕（最多 150 行），用来看清上下文或核对细节。',
      parameters: {
        type: 'object',
        properties: { bvid: { type: 'string' }, from_line: { type: 'number' }, to_line: { type: 'number' } },
        required: ['bvid', 'from_line', 'to_line']
      }
    }
  }
];

const SYSTEM = `你是 BilibiliDry 的知识库助手。用户分析过的 B 站视频都在知识库里，你可以用工具列出视频、检索片段、阅读字幕。

规则：
- 先用工具找证据再回答，结论必须来自工具返回的字幕原文；找不到就直说知识库里没有。
- 每个结论后面用 [BV号 L行号] 标出处，例如 [BV1xx411c7mD L88]，跨几行写 [BV1xx411c7mD L88-L92]。只引用你在工具结果里看到过的行。
- 用中文，简洁，先给结论；比较多个视频时可以用列表或表格。`;

interface Seen {
  bvid: string;
  from: number;
  to: number;
}

async function runTool(env: LibraryEnv, call: ToolCall, seen: Seen[]): Promise<{ output: string; summary: string; args: Record<string, unknown> }> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return { output: '参数不是合法 JSON，请重试。', summary: '参数错误', args };
  }
  switch (call.function.name) {
    case 'list_videos': {
      const videos = await env.listVideos();
      return {
        output: videos.length ? videos.map((v) => `${v.bvid}《${v.title}》${formatTime(v.durationSec)}${v.tldr ? `：${v.tldr}` : ''}`).join('\n') : '知识库是空的。',
        summary: `${videos.length} 个视频`,
        args
      };
    }
    case 'search_library': {
      const q = String(args.query ?? '').trim();
      if (!q) return { output: 'query 不能为空', summary: '参数错误', args };
      const k = Math.max(1, Math.min(10, Math.round(Number(args.k) || 6)));
      const hits = await env.search(q, k);
      for (const h of hits) seen.push({ bvid: h.bvid, from: h.fromLine, to: h.toLine });
      return {
        output: hits.length
          ? hits.map((h, i) => `${i + 1}. ${h.bvid}《${h.title}》 L${h.fromLine}-L${h.toLine} [${formatTime(h.start)}]${h.context ? `（${h.context.slice(0, 60)}）` : ''}\n   ${h.text.slice(0, 400)}`).join('\n')
          : '没有找到相关内容。',
        summary: `找到 ${hits.length} 段`,
        args
      };
    }
    case 'read_transcript': {
      const bvid = String(args.bvid ?? '');
      const lines = await env.lines(bvid);
      if (!lines) return { output: `知识库里没有 ${bvid}。`, summary: '没有这个视频', args };
      let from = Math.max(0, Math.round(Number(args.from_line) || 0));
      let to = Math.min(lines.length - 1, Math.round(Number(args.to_line) || from + 60));
      if (to < from) [from, to] = [to, from];
      to = Math.min(to, from + 149);
      seen.push({ bvid, from, to });
      return {
        output: lines
          .slice(from, to + 1)
          .map((l) => `[L${l.idx}|${formatTime(l.from)}] ${l.text}`)
          .join('\n'),
        summary: `读取 ${bvid} L${from}-L${to}`,
        args
      };
    }
    default:
      return { output: `未知工具 ${call.function.name}`, summary: '未知工具', args };
  }
}

function safeArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.function.arguments || '{}');
  } catch {
    return { raw: call.function.arguments };
  }
}

export async function askLibrary(params: {
  llm: LlmClient;
  env: LibraryEnv;
  question: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  tracer?: Tracer;
  maxSteps?: number;
  model?: string;
  reasoning?: ReasoningLevel;
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
}): Promise<LibraryAnswer> {
  const { llm, env, onEvent } = params;
  const maxSteps = params.maxSteps ?? 6;
  const seen: Seen[] = [];
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    ...(params.history ?? []).slice(-6).map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }) as ChatMessage),
    { role: 'user', content: params.question }
  ];
  let answer = '';
  let steps = 0;
  for (let step = 1; step <= maxSteps; step += 1) {
    steps = step;
    const last = step === maxSteps;
    const res = await llm.chat(
      {
        purpose: `library:step-${step}`,
        model: params.model,
        reasoning: params.reasoning,
        signal: params.signal,
        temperature: 0.3,
        messages: last ? [...messages, { role: 'user', content: '请根据已经查到的内容直接给出最终回答。' }] : messages,
        tools: last ? undefined : TOOLS
      },
      (text) => onEvent?.({ type: 'delta', text })
    );
    if (res.toolCalls.length === 0) {
      answer = res.content.trim();
      break;
    }
    // DeepSeek requires the thinking text of tool-calling turns to be sent back.
    messages.push({ role: 'assistant', content: res.content || null, tool_calls: res.toolCalls, ...(res.reasoning ? { reasoning_content: res.reasoning } : {}) });
    for (const call of res.toolCalls) {
      onEvent?.({ type: 'tool_call', id: call.id, name: call.function.name, args: safeArgs(call) });
      const exec = () => runTool(env, call, seen);
      const out = params.tracer ? await params.tracer.run(`tool:${call.function.name}`, 'tool', exec, { args: call.function.arguments.slice(0, 200) }) : await exec();
      onEvent?.({ type: 'tool_result', id: call.id, name: call.function.name, summary: out.summary });
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: out.output });
    }
  }
  if (!answer) answer = '抱歉，没能在步数限制内得出答案，请换个问法。';

  const cited = [...new Set((answer.match(/BV[0-9A-Za-z]{10}/g) ?? []).map(String))];
  const linesByBvid = new Map<string, CaptionLine[]>();
  for (const bvid of cited) {
    const lines = await env.lines(bvid);
    if (lines) linesByBvid.set(bvid, lines);
  }
  const citations = resolveCitations(answer, (bvid) => (bvid ? linesByBvid.get(bvid) : undefined)).map((c) => ({
    ...c,
    // Only lines the agent actually looked at count as evidence.
    supported: Boolean(c.supported) && seen.some((s) => s.bvid === c.bvid && c.fromLine >= s.from - 3 && c.toLine <= s.to + 3)
  }));
  return { answer, citations, steps };
}

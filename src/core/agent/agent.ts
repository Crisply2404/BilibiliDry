import type { ChatMessage, LlmClient, ToolCall, ToolSpec } from '../llm/types';
import { LlmError } from '../llm/types';
import type { SearchHit } from '../retrieval/hybrid';
import type { Tracer } from '../trace/tracer';
import { formatTime, parseTime, renderLines } from '../transcript/captions';
import type { CaptionLine, Segment, VideoDigest, VideoInfo } from '../types';
import { isCitationGrounded, parseCitations, type EvidenceSpan } from './citations';

export interface LibraryHit extends SearchHit {
  videoTitle: string;
  bvid: string;
}

/** Everything the agent may look at. The background wires it to IndexedDB; tests wire it to fixtures. */
export interface AgentEnv {
  video: VideoInfo;
  lines: CaptionLine[];
  segments: Segment[];
  digest: VideoDigest | null;
  searchVideo: (query: string, k: number) => Promise<SearchHit[]>;
  searchLibrary?: (query: string, k: number) => Promise<LibraryHit[]>;
  /** Current playback time, so "这里讲的是什么" can be resolved. */
  currentTime?: number;
}

export type AgentEvent =
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; summary: string }
  | { type: 'delta'; text: string }
  | { type: 'final'; answer: string; citations: Array<{ raw: string; bvid?: string; time: number; grounded: boolean }>; steps: number; mode: 'agent' | 'rag' };

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'search_transcript',
      description: '在当前视频字幕里做混合检索（关键词 + 语义），返回最相关的几段原文和时间。回答事实性问题前必须先调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索词，写成视频里可能出现的说法；可以换几种说法多查几次' },
          k: { type: 'number', description: '返回条数，默认 5，最多 8' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_transcript',
      description: '读取当前视频某个时间范围内的完整字幕，用于看清上下文或核对细节。范围最长 4 分钟。',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', description: '开始时间，如 "3:20"' },
          end: { type: 'string', description: '结束时间，如 "5:00"' }
        },
        required: ['start', 'end']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_outline',
      description: '获取当前视频的总结、章节和各片段标题。适合回答“讲了什么”“结构是什么”这类整体问题。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_library',
      description: '在用户分析过的所有视频（本地知识库）里检索，用于跨视频对比或“我以前看过的哪个视频讲过 X”。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, k: { type: 'number' } },
        required: ['query']
      }
    }
  }
];

function systemPrompt(env: AgentEnv): string {
  const now = env.currentTime !== undefined ? `用户当前播放到 ${formatTime(env.currentTime)}。` : '';
  return `你是 BilibiliDry 的视频助手，帮用户理解 B 站视频《${env.video.title}》（时长 ${formatTime(env.video.durationSec)}，${env.video.bvid}）。${now}

工作方式：
- 先用工具找证据再回答。具体事实、数字、观点、步骤必须来自工具返回的字幕原文；字幕没有就直说“视频里没讲到”，可以另外说明常识但要标明“视频外补充”。
- 每个来自视频的结论后面用 [分:秒] 标注出处，例如 [3:25]；引用别的视频时写成 [BV号 分:秒]。只引用你在工具结果里看到过的时间。
- 字幕是自动识别的，可能有同音错字，按上下文理解。
- 用中文回答，简洁直接，先给结论再展开，适当使用列表。`;
}

function summarizeHits(hits: SearchHit[], spans: EvidenceSpan[], bvidOf?: (h: SearchHit) => string, titleOf?: (h: SearchHit) => string): string {
  if (hits.length === 0) return '没有找到相关内容。';
  return hits
    .map((h, i) => {
      const bvid = bvidOf?.(h);
      spans.push({ bvid, start: h.passage.start, end: h.passage.end });
      const where = `${bvid ? `${bvid} ` : ''}${formatTime(h.passage.start)}-${formatTime(h.passage.end)}`;
      const title = titleOf ? `《${titleOf(h)}》 ` : '';
      return `${i + 1}. ${title}[${where}] ${h.passage.text.slice(0, 360)}${h.passage.context ? `\n   （所在片段：${h.passage.context.slice(0, 80)}）` : ''}`;
    })
    .join('\n');
}

async function runTool(env: AgentEnv, call: ToolCall, spans: EvidenceSpan[]): Promise<{ output: string; summary: string; args: Record<string, unknown> }> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return { output: '参数不是合法 JSON，请重试。', summary: '参数错误', args };
  }
  const k = Math.max(1, Math.min(8, Math.round(Number(args.k) || 5)));
  switch (call.function.name) {
    case 'search_transcript': {
      const q = String(args.query ?? '').trim();
      if (!q) return { output: 'query 不能为空', summary: '参数错误', args };
      const hits = await env.searchVideo(q, k);
      return { output: summarizeHits(hits, spans), summary: `找到 ${hits.length} 段`, args };
    }
    case 'read_transcript': {
      let start = parseTime(String(args.start ?? '')) ?? 0;
      let end = parseTime(String(args.end ?? '')) ?? start + 60;
      if (end < start) [start, end] = [end, start];
      end = Math.min(end, start + 240);
      const lines = env.lines.filter((l) => l.to >= start && l.from <= end);
      if (lines.length === 0) return { output: '该时间范围没有字幕。', summary: '无字幕', args };
      spans.push({ start: lines[0].from, end: lines[lines.length - 1].to });
      return {
        output: renderLines(lines, 6000).replace(/^\[\d+\|/gm, '['),
        summary: `读取 ${formatTime(start)}-${formatTime(end)}（${lines.length} 行）`,
        args
      };
    }
    case 'get_outline': {
      const d = env.digest;
      const segs = env.segments
        .filter((s) => s.kind === 'dry')
        .slice(0, 80)
        .map((s) => `[${formatTime(s.start)}] ${s.title}：${s.summary}`)
        .join('\n');
      for (const s of env.segments) spans.push({ start: s.start, end: s.end });
      const head = d
        ? `总结：${d.tldr}\n要点：${d.takeaways.join('；')}\n章节：\n${d.chapters.map((c) => `[${formatTime(c.start)}] ${c.title}：${c.summary}`).join('\n')}`
        : '（还没有生成总结）';
      return { output: `${head}\n\n干货片段：\n${segs || '（还没有分析结果，请用 search_transcript）'}`, summary: d ? `${d.chapters.length} 个章节` : '无总结', args };
    }
    case 'search_library': {
      if (!env.searchLibrary) return { output: '知识库不可用。', summary: '不可用', args };
      const q = String(args.query ?? '').trim();
      const hits = await env.searchLibrary(q, k);
      return {
        output: summarizeHits(
          hits,
          spans,
          (h) => (h as LibraryHit).bvid,
          (h) => (h as LibraryHit).videoTitle
        ),
        summary: `知识库找到 ${hits.length} 段`,
        args
      };
    }
    default:
      return { output: `未知工具 ${call.function.name}`, summary: '未知工具', args };
  }
}

function toolsUnsupported(err: unknown): boolean {
  if (!(err instanceof LlmError) || err.status !== 400) return false;
  return /tool|function/i.test(err.message);
}

function finalize(answer: string, spans: EvidenceSpan[], env: AgentEnv, steps: number, mode: 'agent' | 'rag'): AgentEvent & { type: 'final' } {
  const citations = parseCitations(answer).map((c) => ({ raw: c.raw, bvid: c.bvid, time: c.time, grounded: isCitationGrounded(c, spans, env.video.bvid) }));
  return { type: 'final', answer, citations, steps, mode };
}

/**
 * ReAct-style tool-calling loop over the video's transcript.
 *
 * The model decides which tools to call; the loop executes them, feeds back
 * compact results, and stops when the model answers or after `maxSteps`. Every
 * span of transcript the tools return is remembered, and citations in the
 * final answer are checked against those spans. Providers without tool
 * calling fall back to a single retrieve-then-answer pass.
 */
export async function runAgent(params: {
  llm: LlmClient;
  env: AgentEnv;
  question: string;
  history?: ChatTurn[];
  tracer?: Tracer;
  maxSteps?: number;
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
}): Promise<AgentEvent & { type: 'final' }> {
  const { llm, env, question, onEvent } = params;
  const maxSteps = params.maxSteps ?? 6;
  const spans: EvidenceSpan[] = [];
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(env) },
    ...(params.history ?? []).slice(-8).map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }) as ChatMessage),
    { role: 'user', content: question }
  ];

  try {
    for (let step = 1; step <= maxSteps; step += 1) {
      const lastStep = step === maxSteps;
      const res = await llm.chat(
        {
          purpose: `agent:step-${step}`,
          messages: lastStep ? [...messages, { role: 'user', content: '请根据已有信息直接给出最终回答。' }] : messages,
          tools: lastStep ? undefined : TOOLS.filter((t) => t.function.name !== 'search_library' || env.searchLibrary),
          temperature: 0.3,
          signal: params.signal
        },
        (text) => onEvent?.({ type: 'delta', text })
      );
      if (res.toolCalls.length === 0) {
        const done = finalize(res.content.trim(), spans, env, step, 'agent');
        onEvent?.(done);
        return done;
      }
      messages.push({ role: 'assistant', content: res.content || null, tool_calls: res.toolCalls });
      for (const call of res.toolCalls) {
        const exec = async () => runTool(env, call, spans);
        onEvent?.({ type: 'tool_call', id: call.id, name: call.function.name, args: safeArgs(call) });
        const out = params.tracer ? await params.tracer.run(`tool:${call.function.name}`, 'tool', exec, { args: call.function.arguments.slice(0, 200) }) : await exec();
        onEvent?.({ type: 'tool_result', id: call.id, name: call.function.name, summary: out.summary });
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: out.output });
      }
    }
  } catch (err) {
    if (!toolsUnsupported(err)) throw err;
    return runRagFallback({ ...params, spans });
  }
  const done = finalize('抱歉，没能在步数限制内得出答案，请换个问法。', spans, env, maxSteps, 'agent');
  onEvent?.(done);
  return done;
}

async function runRagFallback(params: {
  llm: LlmClient;
  env: AgentEnv;
  question: string;
  history?: ChatTurn[];
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
  spans: EvidenceSpan[];
}): Promise<AgentEvent & { type: 'final' }> {
  const { env, onEvent, spans } = params;
  onEvent?.({ type: 'tool_call', id: 'rag', name: 'search_transcript', args: { query: params.question } });
  const hits = await env.searchVideo(params.question, 6);
  const context = summarizeHits(hits, spans);
  onEvent?.({ type: 'tool_result', id: 'rag', name: 'search_transcript', summary: `找到 ${hits.length} 段（模型不支持工具调用，已降级为单轮检索）` });
  const res = await params.llm.chat(
    {
      purpose: 'agent:rag',
      temperature: 0.3,
      signal: params.signal,
      messages: [
        { role: 'system', content: systemPrompt(env) },
        ...(params.history ?? []).slice(-6).map((t) => ({ role: t.role, content: t.content.slice(0, 1500) }) as ChatMessage),
        { role: 'user', content: `检索到的字幕：\n${context}\n\n问题：${params.question}` }
      ]
    },
    (text) => onEvent?.({ type: 'delta', text })
  );
  const done = finalize(res.content.trim(), spans, env, 1, 'rag');
  onEvent?.(done);
  return done;
}

function safeArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.function.arguments || '{}');
  } catch {
    return { raw: call.function.arguments };
  }
}

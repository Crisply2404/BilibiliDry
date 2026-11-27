/**
 * Plays the model's part for the demo, speaking the OpenAI chat-completions
 * protocol (JSON and SSE streaming, tool calls included) so the extension's
 * real LLM client, pipeline and agent loop run unchanged.
 *
 * It recognises each request by its system prompt and answers from the
 * prepared notes in `videos.ts`. Anything not prepared falls back to quoting
 * what the tools retrieved, and says so.
 */
import { formatTime, parseTime } from '../../src/core/transcript/captions';
import { WATER_REASON_LABEL } from '../../src/core/types';
import { blockAt, DEMO_VIDEOS, lineBlock, videoByTitle, type DemoVideo, type PreparedAnswer } from './videos';

interface Msg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: unknown[];
  name?: string;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
const jitter = (min: number, max: number) => min + Math.random() * (max - min);
const tokens = (s: string) => Math.ceil(s.length / 1.6);

// ——— pipeline steps ———

function mapChunk(v: DemoVideo, user: string): string {
  const m = /行号 (\d+)–(\d+)/.exec(user);
  if (!m) return '{"segments":[]}';
  const from = Number(m[1]);
  const to = Number(m[2]);
  const lines = v.built.lines;
  const segments: Array<Record<string, unknown>> = [];
  let start = from;
  for (let i = from; i <= to; i += 1) {
    const block = lineBlock(v, lines[i]);
    const next = i < to ? lineBlock(v, lines[i + 1]) : null;
    if (block === next) continue;
    const fb = v.built.fixture.blocks.find((b) => b.id === block)!;
    const note = v.notes[block];
    segments.push({
      from: start,
      to: i,
      kind: fb.kind,
      importance: note.importance,
      title: note.title,
      summary: note.summary,
      keyPoints: note.keyPoints ?? [],
      ...(fb.reason ? { waterReason: fb.reason } : {})
    });
    start = i + 1;
  }
  return JSON.stringify({ segments });
}

function digest(v: DemoVideo, user: string): string {
  const segBlocks: string[] = [];
  for (const m of user.matchAll(/^#(\d+) \[(\d+:\d{2})\]/gm)) segBlocks[Number(m[1])] = blockAt(v, (parseTime(m[2]) ?? 0) + 0.5);
  const chapters = v.digest.chapters
    .map((c) => ({ startSegment: segBlocks.indexOf(c.block), title: c.title, summary: c.summary }))
    .filter((c) => c.startSegment >= 0);
  return JSON.stringify({ tldr: v.digest.tldr, takeaways: v.digest.takeaways, chapters });
}

function verify(user: string): string {
  const idx = Array.from(user.matchAll(/^\[(\d+)\|/gm), (m) => Number(m[1]));
  return JSON.stringify({ verdict: 'supported', reason: '摘要的关键信息字幕里都有', evidence: idx.slice(3, 5) });
}

function refine(user: string): string {
  const draft = /初稿：(.*)$/s.exec(user)?.[1] ?? '';
  const [title = '', summary = '', points = ''] = draft.split('｜');
  return JSON.stringify({ title, summary, keyPoints: points.split('；').filter(Boolean) });
}

// ——— agent ———

interface Evidence {
  bvid?: string;
  start: number;
  end: number;
  title?: string;
  text?: string;
}

/** Read back what the tools returned this turn, in the formats `agent.ts` writes. */
function evidenceFrom(toolMsgs: Msg[]): { ranges: Evidence[]; outline: boolean } {
  const ranges: Evidence[] = [];
  let outline = false;
  for (const m of toolMsgs) {
    const text = m.content ?? '';
    if (m.name === 'get_outline') outline = true;
    if (m.name === 'read_transcript') {
      const times = Array.from(text.matchAll(/^\[(\d+:\d{2})\]/gm), (x) => parseTime(x[1]) ?? 0);
      if (times.length) ranges.push({ start: Math.min(...times), end: Math.max(...times) + 5 });
      continue;
    }
    for (const x of text.matchAll(/^\d+\. (?:《(.+?)》 )?\[(?:(BV[0-9A-Za-z]{10}) )?(\d+:\d{2})-(\d+:\d{2})\] (.*)$/gm)) {
      ranges.push({ title: x[1], bvid: x[2], start: parseTime(x[3]) ?? 0, end: parseTime(x[4]) ?? 0, text: x[5] });
    }
  }
  return { ranges, outline };
}

/** A `[m:ss]` for a block, placed inside evidence the tools really returned whenever possible. */
function citeBlock(v: DemoVideo, block: string, ev: { ranges: Evidence[]; outline: boolean }): string {
  const span = v.built.spans.get(block);
  if (!span) return '';
  const hit = ev.ranges.find((r) => !r.bvid && r.start <= span.end && r.end >= span.start);
  const t = hit ? Math.max(hit.start, span.start) : span.start;
  return `[${formatTime(Math.ceil(t))}]`;
}

function fill(v: DemoVideo, template: string, ev: { ranges: Evidence[]; outline: boolean }): string {
  return template.replace(/\{([a-z0-9-]+)\}/g, (_, block: string) => citeBlock(v, block, ev));
}

function quoteHits(ev: { ranges: Evidence[] }, library: boolean): string {
  const hits = ev.ranges.filter((r) => r.text).slice(0, 3);
  if (hits.length === 0) return '视频里没有找到和这个问题相关的内容。';
  const lines = hits.map((h) => {
    const where = h.bvid ? `[${h.bvid} ${formatTime(h.start)}]` : `[${formatTime(h.start)}]`;
    const from = library && h.title ? `《${h.title}》：` : '';
    return `- ${from}「${h.text!.replace(/\s+/g, ' ').slice(0, 54)}…」${where}`;
  });
  return `（演示模式没有接真实模型，所以这里直接列出检索到的原文；真实模型会读完这些再组织成回答。）\n\n${lines.join('\n')}`;
}

interface Plan {
  steps: PreparedAnswer['steps'];
  answer: (ev: { ranges: Evidence[]; outline: boolean }) => string;
}

function planFor(v: DemoVideo, question: string, now: number | undefined): Plan {
  if (/讲了(哪|什么|啥)|几件事|总结|大纲|结构|概括/.test(question)) {
    return {
      steps: [[{ name: 'get_outline', args: {} }]],
      answer: (ev) => {
        const parts = v.digest.chapters.map((c, i) => `${i + 1}. **${c.title}** {${c.block}}：${c.summary}`);
        const skippable = v.built.fixture.blocks.filter((b) => b.kind === 'water' && b.reason && b.reason !== 'smalltalk');
        const kinds = [...new Set(skippable.map((b) => WATER_REASON_LABEL[b.reason!]))].join('、');
        const tail = skippable.length ? `\n\n中间还有${kinds}（${skippable.map((b) => `{${b.id}}`).join(' ')}），可以跳过。` : '';
        return fill(v, `${v.digest.tldr}\n\n分成 ${parts.length} 部分：\n\n${parts.join('\n')}${tail}`, ev);
      }
    };
  }
  if (/这里|这段|现在|刚才/.test(question) && now !== undefined) {
    const block = blockAt(v, now);
    return {
      steps: [[{ name: 'read_transcript', args: { start: formatTime(Math.max(0, now - 20)), end: formatTime(now + 40) } }]],
      answer: (ev) => {
        const note = v.notes[block];
        const fb = v.built.fixture.blocks.find((b) => b.id === block)!;
        const span = v.built.spans.get(block)!;
        const r = ev.ranges[0];
        const t = r ? Math.min(Math.max(span.start, r.start), r.end) : span.start;
        const head = `你现在看到的 ${formatTime(now)} 左右在讲**${note.title}** [${formatTime(Math.ceil(t))}]：${note.summary}`;
        return fb.kind === 'water' ? `${head}\n\n这段属于${fb.reason ? WATER_REASON_LABEL[fb.reason] : '注水'}，可以点“跳过注水”。` : head;
      }
    };
  }
  const prepared = v.answers.find((a) => a.match.test(question));
  if (prepared) return { steps: prepared.steps, answer: (ev) => fill(v, prepared.answer, ev) };
  if (/以前|之前|别的视频|其他视频|另一个|知识库|哪个视频/.test(question)) {
    return { steps: [[{ name: 'search_library', args: { query: question.replace(/[？?。]/g, ''), k: 5 } }]], answer: (ev) => quoteHits(ev, true) };
  }
  return { steps: [[{ name: 'search_transcript', args: { query: question.replace(/[？?。]/g, ''), k: 5 } }]], answer: (ev) => quoteHits(ev, false) };
}

type AgentReply = { toolCalls: Array<{ id: string; name: string; arguments: string }> } | { content: string };

function agentStep(v: DemoVideo, messages: Msg[]): AgentReply {
  const forced = messages[messages.length - 1]?.content === '请根据已有信息直接给出最终回答。';
  const convo = forced ? messages.slice(0, -1) : messages;
  let qi = convo.length - 1;
  while (qi > 0 && convo[qi].role !== 'user') qi -= 1;
  const question = convo[qi].content ?? '';
  const after = convo.slice(qi + 1);
  const done = after.filter((m) => m.role === 'assistant' && m.tool_calls?.length).length;
  const nowRaw = /用户当前播放到 (\d+:\d{2})/.exec(convo[0].content ?? '')?.[1];
  const plan = planFor(v, question, nowRaw ? parseTime(nowRaw) ?? undefined : undefined);
  if (!forced && done < plan.steps.length) {
    return { toolCalls: plan.steps[done].map((c, i) => ({ id: `call_${done}_${i}`, name: c.name, arguments: JSON.stringify(c.args) })) };
  }
  return { content: plan.answer(evidenceFrom(after.filter((m) => m.role === 'tool'))) };
}

// ——— HTTP ———

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function sse(write: (emit: (data: unknown) => void) => Promise<void>, signal?: AbortSignal): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await write((data) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`)));
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    }
  });
  signal?.addEventListener('abort', () => body.cancel().catch(() => undefined));
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

export async function handleChatCompletion(body: { model?: string; messages: Msg[]; stream?: boolean }, signal?: AbortSignal): Promise<Response> {
  const messages = body.messages ?? [];
  const sys = messages[0]?.content ?? '';
  const user = messages.find((m) => m.role === 'user')?.content ?? '';
  const promptTokens = tokens(messages.map((m) => m.content ?? '').join(''));
  const model = body.model ?? 'demo';

  if (sys.includes('BilibiliDry 的视频助手')) {
    const v = videoByTitle(sys) ?? DEMO_VIDEOS[0];
    await sleep(jitter(500, 900), signal);
    const reply = agentStep(v, messages);
    if ('toolCalls' in reply) {
      const tool_calls = reply.toolCalls.map((c, index) => ({ index, id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }));
      if (body.stream) return sse(async (emit) => emit({ model, choices: [{ delta: { tool_calls }, finish_reason: 'tool_calls' }] }), signal);
      return json({ model, choices: [{ message: { role: 'assistant', content: null, tool_calls: tool_calls.map(({ index: _i, ...c }) => c) }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: promptTokens, completion_tokens: 40 } });
    }
    if (body.stream) {
      return sse(async (emit) => {
        for (const piece of reply.content.match(/[\s\S]{1,3}/g) ?? []) {
          emit({ model, choices: [{ delta: { content: piece } }] });
          await sleep(28, signal);
        }
        emit({ model, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: promptTokens, completion_tokens: tokens(reply.content) } });
      }, signal);
    }
    return json({ model, choices: [{ message: { role: 'assistant', content: reply.content }, finish_reason: 'stop' }], usage: { prompt_tokens: promptTokens, completion_tokens: tokens(reply.content) } });
  }

  const v = videoByTitle(user) ?? DEMO_VIDEOS[0];
  let content: string;
  if (sys.includes('切成若干连续片段')) {
    await sleep(jitter(1300, 2600), signal);
    content = mapChunk(v, user);
  } else if (sys.includes('startSegment')) {
    await sleep(jitter(1400, 2000), signal);
    content = digest(v, user);
  } else if (sys.includes('事实核查员')) {
    await sleep(jitter(700, 1100), signal);
    content = verify(user);
  } else if (sys.includes('资深内容编辑')) {
    await sleep(jitter(900, 1400), signal);
    content = refine(user);
  } else {
    await sleep(400, signal);
    content = '你好，这是 BilibiliDry 演示用的模拟模型。';
  }
  return json({ model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: promptTokens, completion_tokens: tokens(content) } });
}

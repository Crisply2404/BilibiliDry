/**
 * Plays the model's part for the demo, speaking the OpenAI chat-completions protocol (JSON and
 * SSE streaming, tool calls included) so the extension's real client, analysis, Q&A and library
 * agent run unchanged.
 *
 * It recognises each request by the extension's own prompts and answers from the notes
 * prepared in `videos.ts`. Questions without a prepared answer get the most relevant caption
 * lines quoted back, and the answer says so.
 */
import { formatTime, parseTime } from '../../src/core/transcript/captions';
import { tokenize } from '../../src/core/text/tokenize';
import { WATER_REASON_LABEL } from '../../src/core/types';
import { blockAt, DEMO_VIDEOS, lineBlock, videoByTitle, type DemoVideo } from './videos';

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
const tokens = (s: string) => Math.ceil(s.length / 1.6);

/** The caption-line range of a fixture block. */
function blockLines(v: DemoVideo, block: string): [number, number] {
  const idx = v.built.lines.filter((l) => lineBlock(v, l) === block).map((l) => l.idx);
  return [idx[0] ?? 0, idx[idx.length - 1] ?? 0];
}

function cite(v: DemoVideo, block: string): string {
  const [a, b] = blockLines(v, block);
  return a === b ? `[L${a}]` : `[L${a}-L${b}]`;
}

// ——— whole-video analysis: JSON Lines, one segment per fixture block in the requested range ———

function analysisLines(v: DemoVideo, user: string): string[] {
  const m = /行号 (\d+)–(\d+)/.exec(user);
  const from = m ? Number(m[1]) : 0;
  const to = m ? Number(m[2]) : v.built.lines.length - 1;
  const out: string[] = [];
  let start = from;
  for (let i = from; i <= to; i += 1) {
    const block = lineBlock(v, v.built.lines[i]);
    if (i < to && lineBlock(v, v.built.lines[i + 1]) === block) continue;
    const fb = v.built.fixture.blocks.find((b) => b.id === block)!;
    const note = v.notes[block];
    out.push(JSON.stringify({ t: 'seg', from: start, to: i, kind: fb.kind, ...(fb.reason ? { reason: fb.reason } : {}), importance: note.importance, title: note.title, summary: note.summary, keyPoints: note.keyPoints ?? [] }));
    start = i + 1;
  }
  const keyBlocks = v.built.fixture.blocks.filter((b) => b.key).map((b) => blockLines(v, b.id)[0]);
  out.push(
    JSON.stringify({
      t: 'digest',
      tldr: v.digest.tldr,
      takeaways: v.digest.takeaways,
      chapters: v.digest.chapters.map((c) => ({ from: blockLines(v, c.block)[0], title: c.title })),
      highlights: keyBlocks
    })
  );
  return out;
}

// ——— questions about one video (whole transcript in context) ———

/** Most relevant caption lines by shared words, for questions nobody prepared an answer for. */
function bestLines(v: DemoVideo, question: string, k = 3): number[] {
  const q = new Set(tokenize(question));
  return v.built.lines
    .map((l) => ({ idx: l.idx, score: tokenize(l.text).filter((t) => q.has(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, k)
    .map((x) => x.idx)
    .sort((a, b) => a - b);
}

function answerVideo(v: DemoVideo, question: string, now: number | undefined): string {
  if (/讲了(哪|什么|啥)|几件事|总结|大纲|结构|概括/.test(question)) {
    const parts = v.digest.chapters.map((c, i) => `${i + 1}. **${c.title}** ${cite(v, c.block)}：${c.summary}`);
    const skippable = v.built.fixture.blocks.filter((b) => b.kind === 'water' && b.reason && b.reason !== 'smalltalk');
    const kinds = [...new Set(skippable.map((b) => WATER_REASON_LABEL[b.reason!]))].join('、');
    return `${v.digest.tldr}\n\n分成 ${parts.length} 部分：\n\n${parts.join('\n')}${skippable.length ? `\n\n中间还有${kinds}（${skippable.map((b) => cite(v, b.id)).join(' ')}），可以跳过。` : ''}`;
  }
  if (/这里|这段|现在|刚才/.test(question) && now !== undefined) {
    const block = blockAt(v, now);
    const note = v.notes[block];
    const fb = v.built.fixture.blocks.find((b) => b.id === block)!;
    const head = `你现在看到的 ${formatTime(now)} 左右在讲**${note.title}**：${note.summary} ${cite(v, block)}`;
    return fb.kind === 'water' ? `${head}\n\n这段属于${fb.reason ? WATER_REASON_LABEL[fb.reason] : '注水'}，可以点播放器里的“跳过”。` : head;
  }
  const prepared = v.answers.find((a) => a.match.test(question));
  if (prepared) return prepared.answer.replace(/\{([a-z0-9-]+)\}/g, (_, block: string) => cite(v, block));
  const hits = bestLines(v, question);
  if (hits.length === 0) return '视频里没讲到这个。（演示模式没有接真实模型，只能按字面在字幕里找。）';
  return `（演示模式没有接真实模型，这里直接列出字幕里最相关的几句；真实模型会读完整个视频再回答。）\n\n${hits.map((i) => `- 「${v.built.lines[i].text}」[L${i}]`).join('\n')}`;
}

// ——— the library agent ———

type AgentReply = { toolCalls: Array<{ id: string; name: string; arguments: string }> } | { content: string };

function libraryStep(messages: Msg[]): AgentReply {
  const forced = messages[messages.length - 1]?.content?.startsWith('请根据已经查到的内容');
  let qi = messages.length - 1;
  while (qi > 0 && (messages[qi].role !== 'user' || messages[qi].content?.startsWith('请根据已经查到的内容'))) qi -= 1;
  const question = messages[qi].content ?? '';
  const tools = messages.slice(qi + 1).filter((m) => m.role === 'tool');
  if (tools.length === 0 && !forced) {
    return { toolCalls: [{ id: 'call_search', name: 'search_library', arguments: JSON.stringify({ query: question.replace(/[？?。]/g, ''), k: 4 }) }] };
  }
  const hits = Array.from(String(tools[0]?.content ?? '').matchAll(/^\d+\. (BV[0-9A-Za-z]{10})《(.+?)》 L(\d+)-L(\d+)[^\n]*\n\s+(.+)$/gm)).slice(0, 3);
  if (hits.length === 0) return { content: '知识库里没有找到相关内容。' };
  return {
    content: `（演示模式没有接真实模型，这里直接列出检索到的片段；真实的 Agent 会读完这些再组织回答。）\n\n${hits.map((h) => `- 《${h[2]}》：「${h[5].slice(0, 46)}…」[${h[1]} L${h[3]}-L${h[4]}]`).join('\n')}`
  };
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

async function streamText(text: string, model: string, promptTokens: number, signal: AbortSignal | undefined, pieceMs: number, pieces: string[]): Promise<Response> {
  return sse(async (emit) => {
    for (const piece of pieces) {
      emit({ model, choices: [{ delta: { content: piece } }] });
      await sleep(pieceMs, signal);
    }
    emit({ model, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: promptTokens, completion_tokens: tokens(text), prompt_cache_hit_tokens: Math.floor(promptTokens * 0.8) } });
  }, signal);
}

export async function handleChatCompletion(body: { model?: string; messages: Msg[]; stream?: boolean }, signal?: AbortSignal): Promise<Response> {
  const messages = body.messages ?? [];
  const sys = messages[0]?.content ?? '';
  const user = messages.find((m) => m.role === 'user')?.content ?? '';
  const promptTokens = tokens(messages.map((m) => m.content ?? '').join(''));
  const model = body.model ?? 'demo-flash';
  const usage = { prompt_tokens: promptTokens, completion_tokens: 60 };

  if (sys.includes('切成首尾相接的片段')) {
    const v = videoByTitle(user) ?? DEMO_VIDEOS[0];
    const lines = analysisLines(v, user);
    await sleep(900, signal);
    // One segment roughly every 0.6s, so the progress bar visibly fills in.
    const text = lines.join('\n');
    return streamText(text, model, promptTokens, signal, 600, lines.map((l) => `${l}\n`));
  }

  if (sys.includes('BilibiliDry 的视频助手')) {
    const v = videoByTitle(sys) ?? DEMO_VIDEOS[0];
    const last = messages[messages.length - 1]?.content ?? '';
    const nowRaw = /用户现在播放到 (\d+:\d{2})/.exec(last)?.[1];
    // askVideo prefixes the playhead as a parenthesised first line; the question is what follows.
    const question = last.startsWith('（用户现在播放到') ? last.slice(last.indexOf('\n') + 1) : last;
    const text = answerVideo(v, question, nowRaw ? parseTime(nowRaw) ?? undefined : undefined);
    await sleep(500, signal);
    return streamText(text, model, promptTokens, signal, 28, text.match(/[\s\S]{1,3}/g) ?? []);
  }

  if (sys.includes('BilibiliDry 的知识库助手')) {
    await sleep(600, signal);
    const reply = libraryStep(messages);
    if ('toolCalls' in reply) {
      const tool_calls = reply.toolCalls.map((c, index) => ({ index, id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }));
      if (body.stream) return sse(async (emit) => emit({ model, choices: [{ delta: { tool_calls }, finish_reason: 'tool_calls' }] }), signal);
      return json({ model, choices: [{ message: { role: 'assistant', content: null, tool_calls: tool_calls.map(({ index: _i, ...c }) => c) }, finish_reason: 'tool_calls' }], usage });
    }
    if (body.stream) return streamText(reply.content, model, promptTokens, signal, 28, reply.content.match(/[\s\S]{1,3}/g) ?? []);
    return json({ model, choices: [{ message: { role: 'assistant', content: reply.content }, finish_reason: 'stop' }], usage });
  }

  await sleep(300, signal);
  return json({ model, choices: [{ message: { role: 'assistant', content: '你好，这是 BilibiliDry 演示用的模拟模型。' }, finish_reason: 'stop' }], usage });
}

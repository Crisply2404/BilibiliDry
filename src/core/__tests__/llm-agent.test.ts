import { describe, expect, it } from 'vitest';
import { runAgent, type AgentEvent } from '../agent/agent';
import { isCitationGrounded, parseCitations } from '../agent/citations';
import { createOpenAICompatClient, redact } from '../llm/openaiCompat';
import { chatJson } from '../llm/json';
import type { ChatRequest, ChatResult, LlmClient } from '../llm/types';
import { LlmError } from '../llm/types';
import { buildPassages, cleanCaptions } from '../transcript/captions';
import { HybridRetriever } from '../retrieval/hybrid';
import { Tracer, tracedClient, traceTotals } from '../trace/tracer';

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const okChat = (content: string) => jsonResponse({ model: 'm', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 } });

describe('openai-compatible client', () => {
  it('retries 429 and 5xx with backoff, then succeeds', async () => {
    const statuses = [429, 503];
    const waits: number[] = [];
    const client = createOpenAICompatClient({
      baseUrl: 'https://x/v1/',
      apiKey: 'sk-test',
      model: 'm',
      sleep: async (ms) => void waits.push(ms),
      fetchImpl: async (url) => {
        expect(String(url)).toBe('https://x/v1/chat/completions');
        const s = statuses.shift();
        return s ? jsonResponse({ error: 'busy' }, s, s === 429 ? { 'retry-after': '2' } : {}) : okChat('hi');
      }
    });
    const out = await client.chat({ messages: [{ role: 'user', content: 'q' }] });
    expect(out.content).toBe('hi');
    expect(out.usage).toEqual({ promptTokens: 5, completionTokens: 3, estimated: false });
    expect(waits[0]).toBe(2000);
    expect(waits).toHaveLength(2);
  });

  it('does not retry 401 and redacts keys in errors', async () => {
    let calls = 0;
    const client = createOpenAICompatClient({
      baseUrl: 'https://x/v1',
      model: 'm',
      sleep: async () => {},
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ error: 'invalid key sk-abcdefghijklmnop' }, 401);
      }
    });
    await expect(client.chat({ messages: [] })).rejects.toThrow(/401.*sk-\*\*\*/);
    expect(calls).toBe(1);
  });

  it('falls back when response_format is rejected', async () => {
    const bodies: any[] = [];
    const client = createOpenAICompatClient({
      baseUrl: 'https://x/v1',
      model: 'm',
      fetchImpl: async (_u, init) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        return body.response_format ? jsonResponse({ error: 'response_format not supported' }, 400) : okChat('{"ok":true}');
      }
    });
    const out = await client.chat({ messages: [], json: true });
    expect(out.content).toBe('{"ok":true}');
    expect(bodies[1].response_format).toBeUndefined();
  });

  it('parses SSE streams including tool-call deltas', async () => {
    const events = [
      { choices: [{ delta: { content: '好' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'search_', arguments: '{"que' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'transcript', arguments: 'ry":"x"}' } }] }, finish_reason: 'tool_calls' }] }
    ];
    const sse = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
    const client = createOpenAICompatClient({
      baseUrl: 'https://x/v1',
      model: 'm',
      fetchImpl: async () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } })
    });
    const deltas: string[] = [];
    const out = await client.chat({ messages: [] }, (t) => deltas.push(t));
    expect(deltas.join('')).toBe('好');
    expect(out.toolCalls[0].function).toEqual({ name: 'search_transcript', arguments: '{"query":"x"}' });
    expect(out.usage.estimated).toBe(true);
  });

  it('redacts common key formats', () => {
    expect(redact('Bearer abcdefghijkl and sk-1234567890abc')).toBe('Bearer *** and sk-***');
  });
});

describe('chatJson', () => {
  it('repairs once with the validation error', async () => {
    const replies = ['oops', '{"n":2}'];
    const client: LlmClient = {
      model: 'm',
      async chat(req: ChatRequest): Promise<ChatResult> {
        return { content: replies.shift()!, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0, estimated: true }, model: 'm', latencyMs: 0, finishReason: req.purpose ?? '' };
      }
    };
    const out = await chatJson(client, { messages: [], purpose: 't' }, (raw) => (raw as { n: number }).n);
    expect(out).toMatchObject({ value: 2, repaired: true });
  });
});

describe('citations', () => {
  it('parses current-video and cross-video citations', () => {
    const c = parseCitations('先说结论 [3:25]，另见 [BV1xx411c7mD 1:02:03]。');
    expect(c.map((x) => [x.bvid, x.time])).toEqual([
      [undefined, 205],
      ['BV1xx411c7mD', 3723]
    ]);
  });
  it('only accepts timestamps inside retrieved spans', () => {
    const [c] = parseCitations('[5:00]');
    expect(isCitationGrounded(c, [{ start: 290, end: 320 }], 'BVa')).toBe(true);
    expect(isCitationGrounded(c, [{ start: 0, end: 60 }], 'BVa')).toBe(false);
  });
});

const lines = cleanCaptions([
  { from: 0, to: 4, content: '大家好欢迎来到频道' },
  { from: 100, to: 104, content: '炒糖色要用冰糖小火慢炒' },
  { from: 104, to: 108, content: '炒到枣红色冒小泡就下肉' }
]);
const env = {
  video: { videoId: 'v', bvid: 'BVaaaaaaaaaa', aid: 1, cid: 1, page: 1, title: '红烧肉', durationSec: 200 },
  lines,
  segments: [],
  digest: null,
  searchVideo: async (q: string, k: number) => new HybridRetriever(buildPassages('v', lines)).search(q, null, { k })
};

function scripted(responses: Array<Partial<ChatResult> | Error>): LlmClient {
  return {
    model: 'm',
    async chat(): Promise<ChatResult> {
      const r = responses.shift()!;
      if (r instanceof Error) throw r;
      return { content: '', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, estimated: false }, model: 'm', latencyMs: 1, finishReason: 'stop', ...r };
    }
  };
}

describe('agent', () => {
  it('calls tools, then answers with grounded citations', async () => {
    const events: AgentEvent[] = [];
    const tracer = new Tracer({ kind: 'chat', videoId: 'v', title: 'q' });
    const llm = tracedClient(
      scripted([
        { toolCalls: [{ id: 'c1', type: 'function', function: { name: 'search_transcript', arguments: '{"query":"糖色"}' } }] },
        { content: '用冰糖小火慢炒，炒到枣红色就下肉 [1:40]。开头寒暄见 [0:02]。' }
      ]),
      tracer
    );
    const out = await runAgent({ llm, env, question: '糖色怎么炒', tracer, onEvent: (e) => events.push(e) });
    expect(out.mode).toBe('agent');
    expect(out.steps).toBe(2);
    expect(out.citations.find((c) => c.time === 100)?.grounded).toBe(true);
    expect(out.citations.find((c) => c.time === 2)?.grounded).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['tool_call', 'tool_result', 'final']);
    expect(traceTotals(tracer.finish()).llmCalls).toBe(2);
  });

  it('falls back to single-pass RAG when the provider rejects tools', async () => {
    const llm = scripted([new LlmError('HTTP 400: tools is not supported', 400), { content: '冰糖小火 [1:40]' }]);
    const out = await runAgent({ llm, env, question: '糖色怎么炒' });
    expect(out.mode).toBe('rag');
    expect(out.citations[0].grounded).toBe(true);
  });
});

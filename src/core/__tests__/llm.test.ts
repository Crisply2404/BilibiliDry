import { describe, expect, it } from 'vitest';
import { createOpenAICompatClient, redact, stripControlTokens } from '../llm/openaiCompat';
import { callCost, isDeepSeekPeak } from '../llm/pricing';
import { chatJson } from '../llm/json';
import type { ChatRequest, ChatResult, LlmClient } from '../llm/types';
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
        return { content: replies.shift()!, reasoning: '', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0, estimated: true }, model: 'm', latencyMs: 0, finishReason: req.purpose ?? '' };
      }
    };
    const out = await chatJson(client, { messages: [], purpose: 't' }, (raw) => (raw as { n: number }).n);
    expect(out).toMatchObject({ value: 2, repaired: true });
  });
});

describe('deepseek thinking and usage', () => {
  it('sends thinking controls only to providers that understand them', async () => {
    const bodies: any[] = [];
    const make = (style: 'deepseek' | 'none') =>
      createOpenAICompatClient({
        baseUrl: 'https://x',
        model: 'm',
        reasoning: 'off',
        reasoningStyle: style,
        fetchImpl: async (_u, init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return okChat('ok');
        }
      });
    await make('deepseek').chat({ messages: [] });
    await make('deepseek').chat({ messages: [], reasoning: 'low' });
    await make('none').chat({ messages: [], reasoning: 'low' });
    expect(bodies[0].thinking).toEqual({ type: 'disabled' });
    expect(bodies[1]).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'low' });
    expect(bodies[2].thinking).toBeUndefined();
    expect(bodies[2].reasoning_effort).toBeUndefined();
  });

  it('sends reasoning_content back only on assistant turns that made tool calls', async () => {
    let sent: any;
    const client = createOpenAICompatClient({
      baseUrl: 'https://x',
      model: 'm',
      fetchImpl: async (_u, init) => {
        sent = JSON.parse(String(init?.body));
        return okChat('ok');
      }
    });
    await client.chat({
      messages: [
        { role: 'assistant', content: 'plain', reasoning_content: 'drop me' },
        { role: 'assistant', content: null, reasoning_content: 'keep me', tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: '{}' } }] }
      ]
    });
    expect(sent.messages[0].reasoning_content).toBeUndefined();
    expect(sent.messages[1].reasoning_content).toBe('keep me');
  });

  it('strips leaked control tokens and reads cache and reasoning usage', async () => {
    expect(stripControlTokens('{"ok":<|endoftext|>true}')).toBe('{"ok":true}');
    const client = createOpenAICompatClient({
      baseUrl: 'https://x',
      model: 'deepseek-flash',
      fetchImpl: async () =>
        jsonResponse({
          model: 'deepseek-flash',
          choices: [{ message: { content: '{"a":<|endoftext|>1}', reasoning_content: '想一想' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_cache_hit_tokens: 800, completion_tokens_details: { reasoning_tokens: 50 } }
        })
    });
    const out = await client.chat({ messages: [] });
    expect(out.content).toBe('{"a":1}');
    expect(out.reasoning).toBe('想一想');
    expect(out.usage).toMatchObject({ promptTokens: 1000, cachedTokens: 800, reasoningTokens: 50, estimated: false });
  });

  it('prices calls with cache hits and peak hours, and totals them in traces', async () => {
    const usage = { promptTokens: 1_000_000, completionTokens: 1_000_000, cachedTokens: 500_000, estimated: false };
    const offPeak = new Date('2026-11-28T12:00:00Z'); // Saturday
    const peak = new Date('2026-11-26T02:00:00Z'); // Thursday 02:00 UTC
    expect(isDeepSeekPeak(offPeak)).toBe(false);
    expect(isDeepSeekPeak(peak)).toBe(true);
    expect(callCost('deepseek-flash', usage, offPeak)).toBeCloseTo(0.5 * 0.15 + 0.5 * 0.003 + 0.6, 6);
    expect(callCost('deepseek-flash', usage, peak)).toBeCloseTo(2 * (0.5 * 0.15 + 0.5 * 0.003 + 0.6), 6);
    expect(callCost('unknown-model', usage)).toBeUndefined();

    const tracer = new Tracer({ kind: 'chat', videoId: 'v', title: 't' });
    const llm = tracedClient(
      { model: 'deepseek-flash', chat: async () => ({ content: 'x', reasoning: '', toolCalls: [], usage: { promptTokens: 100, completionTokens: 10, cachedTokens: 60, estimated: false }, model: 'deepseek-flash', latencyMs: 1, finishReason: 'stop' }) },
      tracer
    );
    await llm.chat({ messages: [] });
    await llm.chat({ messages: [] });
    const t = traceTotals(tracer.finish());
    expect(t).toMatchObject({ llmCalls: 2, promptTokens: 200, cachedTokens: 120, completionTokens: 20 });
    expect(t.costUsd).toBeGreaterThan(0);
  });
});

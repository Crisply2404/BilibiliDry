import { LlmError, type ChatRequest, type ChatResult, type LlmClient, type ToolCall, type Usage } from './types';

/** How a provider expects to be told how much to think. */
export type ReasoningStyle = 'deepseek' | 'none';

export interface OpenAICompatConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  embeddingModel?: string;
  /** Default thinking level when a request does not set one. */
  reasoning?: ChatRequest['reasoning'];
  reasoningStyle?: ReasoningStyle;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  /** Injected for tests so retries do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Mask anything that looks like a credential before it reaches logs, traces or the UI. */
export function redact(text: string): string {
  return text
    .replace(/(sk|ak|key)-[A-Za-z0-9_\-.]{8,}/gi, '$1-***')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, 'AIza***');
}

/**
 * Strip chat-template control tokens such as `<|endoftext|>`. DeepSeek occasionally leaks
 * one into otherwise valid output (seen inside a JSON object), which breaks parsing.
 */
export function stripControlTokens(text: string): string {
  return text.replace(/<\|[a-z_]{2,40}\|>/gi, '');
}

function estimateTokens(chars: number): number {
  // Mixed Chinese/English averages roughly 1.6 characters per token across common tokenizers.
  return Math.ceil(chars / 1.6);
}

function linkSignals(user: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new LlmError(`请求超时（${Math.round(timeoutMs / 1000)}s）`, undefined, true)), timeoutMs);
  const onAbort = () => ctrl.abort(user?.reason ?? new DOMException('Aborted', 'AbortError'));
  if (user) {
    if (user.aborted) onAbort();
    else user.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cancel: () => {
      clearTimeout(timer);
      user?.removeEventListener('abort', onAbort);
    }
  };
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * One client for every OpenAI-compatible endpoint (OpenAI, DeepSeek, Qwen,
 * Kimi, GLM, SiliconFlow, OpenRouter, Gemini's compat endpoint, Ollama...).
 *
 * Resilience lives here so every caller gets it: per-request timeout,
 * exponential backoff with jitter on 429/5xx/network errors (honouring
 * Retry-After), and automatic fallback when a provider rejects
 * `response_format` or streaming.
 */
export function createOpenAICompatClient(config: OpenAICompatConfig): LlmClient {
  const fetchImpl = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = config.sleep ?? defaultSleep;
  const timeoutMs = config.timeoutMs ?? 90_000;
  const maxRetries = config.maxRetries ?? 3;
  let jsonModeSupported = true;
  let streamSupported = true;

  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
  });

  async function request(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    let attempt = 0;
    for (;;) {
      const linked = linkSignals(signal, timeoutMs);
      try {
        const res = await fetchImpl(joinUrl(config.baseUrl, path), {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(body),
          signal: linked.signal
        });
        if (res.ok) {
          // Keep the timeout armed while a streamed body is consumed; the caller cancels via the reader.
          if (!res.body || !String(res.headers.get('content-type') ?? '').includes('event-stream')) linked.cancel();
          return res;
        }
        linked.cancel();
        const text = redact((await res.text().catch(() => '')).slice(0, 400));
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < maxRetries) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** attempt + Math.random() * 400;
          attempt += 1;
          await sleep(Math.min(wait, 20_000));
          continue;
        }
        throw new LlmError(`HTTP ${res.status}: ${text || res.statusText}`, res.status, retryable);
      } catch (err) {
        linked.cancel();
        if (err instanceof LlmError && !err.retryable) throw err;
        if (signal?.aborted || (isAbort(err) && !(linked.signal.reason instanceof LlmError))) throw err;
        if (attempt >= maxRetries) {
          if (err instanceof LlmError) throw err;
          const reason = linked.signal.reason instanceof LlmError ? linked.signal.reason.message : String((err as Error)?.message ?? err);
          throw new LlmError(`网络错误：${redact(reason)}`, undefined, true);
        }
        attempt += 1;
        await sleep(800 * 2 ** (attempt - 1) + Math.random() * 400);
      }
    }
  }

  function reasoningParams(req: ChatRequest): Record<string, unknown> {
    const level = req.reasoning ?? config.reasoning;
    if (config.reasoningStyle !== 'deepseek' || !level) return {};
    return level === 'off' ? { thinking: { type: 'disabled' } } : { thinking: { type: 'enabled' }, reasoning_effort: level };
  }

  function buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
    // Messages carry reasoning_content only where the provider asked for it back (assistant turns with tool calls).
    const messages = req.messages.map((m) => (m.reasoning_content && !(m.role === 'assistant' && m.tool_calls?.length) ? { ...m, reasoning_content: undefined } : m));
    return {
      model: req.model ?? config.model,
      messages,
      temperature: req.temperature ?? 0.2,
      ...reasoningParams(req),
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(req.tools?.length ? { tools: req.tools, tool_choice: 'auto' } : {}),
      ...(req.json && jsonModeSupported && !req.tools?.length ? { response_format: { type: 'json_object' } } : {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {})
    };
  }

  function usageFrom(raw: any, promptChars: number, completionChars: number): Usage {
    const p = Number(raw?.prompt_tokens);
    const c = Number(raw?.completion_tokens);
    if (Number.isFinite(p) && Number.isFinite(c)) {
      const cached = Number(raw?.prompt_cache_hit_tokens ?? raw?.prompt_tokens_details?.cached_tokens);
      const reasoning = Number(raw?.completion_tokens_details?.reasoning_tokens);
      return {
        promptTokens: p,
        completionTokens: c,
        ...(Number.isFinite(cached) ? { cachedTokens: cached } : {}),
        ...(Number.isFinite(reasoning) ? { reasoningTokens: reasoning } : {}),
        estimated: false
      };
    }
    return { promptTokens: estimateTokens(promptChars), completionTokens: estimateTokens(completionChars), estimated: true };
  }

  async function readStream(res: Response, onDelta: (t: string) => void): Promise<{ content: string; reasoning: string; toolCalls: ToolCall[]; usage: any; finishReason: string; model: string }> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoning = '';
    let usage: any = null;
    let finishReason = '';
    let model = '';
    const calls = new Map<number, ToolCall>();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        let json: any;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.usage) usage = json.usage;
        if (json.model) model = json.model;
        const choice = json.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta ?? {};
        if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
        if (typeof delta.content === 'string' && delta.content) {
          const piece = stripControlTokens(delta.content);
          content += piece;
          if (piece) onDelta(piece);
        }
        for (const tc of delta.tool_calls ?? []) {
          const idx = Number(tc.index ?? 0);
          const prev = calls.get(idx) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
          if (tc.id) prev.id = tc.id;
          if (tc.function?.name) prev.function.name += tc.function.name;
          if (tc.function?.arguments) prev.function.arguments += tc.function.arguments;
          calls.set(idx, prev);
        }
      }
    }
    const toolCalls = Array.from(calls.values()).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
    return { content, reasoning, toolCalls, usage, finishReason, model };
  }

  async function chat(req: ChatRequest, onDelta?: (text: string) => void): Promise<ChatResult> {
    const started = Date.now();
    const promptChars = JSON.stringify(req.messages).length + (req.tools ? JSON.stringify(req.tools).length : 0);
    const stream = Boolean(onDelta) && streamSupported;
    let res: Response;
    try {
      res = await request('chat/completions', buildBody(req, stream), req.signal);
    } catch (err) {
      if (err instanceof LlmError && err.status === 400) {
        const msg = err.message.toLowerCase();
        if (req.json && jsonModeSupported && msg.includes('response_format')) {
          jsonModeSupported = false;
          return chat(req, onDelta);
        }
        if (stream && msg.includes('stream')) {
          streamSupported = false;
          return chat(req, onDelta);
        }
      }
      throw err;
    }

    if (stream && res.body && String(res.headers.get('content-type') ?? '').includes('event-stream')) {
      const out = await readStream(res, onDelta!);
      return {
        content: out.content,
        reasoning: out.reasoning,
        toolCalls: out.toolCalls,
        usage: usageFrom(out.usage, promptChars, out.content.length + JSON.stringify(out.toolCalls).length),
        model: out.model || req.model || config.model,
        latencyMs: Date.now() - started,
        finishReason: out.finishReason || (out.toolCalls.length ? 'tool_calls' : 'stop')
      };
    }

    const json: any = await res.json();
    const choice = json?.choices?.[0];
    if (!choice) throw new LlmError(`模型返回为空：${redact(JSON.stringify(json).slice(0, 200))}`);
    const content = typeof choice.message?.content === 'string' ? stripControlTokens(choice.message.content) : '';
    const reasoning = typeof choice.message?.reasoning_content === 'string' ? choice.message.reasoning_content : '';
    const toolCalls: ToolCall[] = (choice.message?.tool_calls ?? []).map((c: any, i: number) => ({
      id: String(c.id ?? `call_${i}`),
      type: 'function',
      function: { name: String(c.function?.name ?? ''), arguments: String(c.function?.arguments ?? '{}') }
    }));
    if (onDelta && content) onDelta(content);
    return {
      content,
      reasoning,
      toolCalls,
      usage: usageFrom(json.usage, promptChars, content.length),
      model: String(json.model ?? req.model ?? config.model),
      latencyMs: Date.now() - started,
      finishReason: String(choice.finish_reason ?? 'stop')
    };
  }

  async function embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!config.embeddingModel) throw new LlmError('未配置 Embedding 模型');
    if (texts.length === 0) return [];
    const res = await request('embeddings', { model: config.embeddingModel, input: texts }, signal);
    const json: any = await res.json();
    const rows: any[] = Array.isArray(json?.data) ? json.data : [];
    const out: number[][] = new Array(texts.length).fill(null).map(() => []);
    rows.forEach((row, i) => {
      const idx = Number.isInteger(row?.index) ? row.index : i;
      if (Array.isArray(row?.embedding)) out[idx] = row.embedding.map(Number);
    });
    return out;
  }

  return {
    model: config.model,
    embeddingModel: config.embeddingModel,
    chat,
    ...(config.embeddingModel ? { embed } : {})
  };
}

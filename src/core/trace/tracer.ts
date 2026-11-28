import type { ChatRequest, ChatResult, LlmClient } from '../llm/types';
import { redact } from '../llm/openaiCompat';
import { callCost } from '../llm/pricing';

export type SpanKind = 'stage' | 'llm' | 'tool' | 'retrieval' | 'embed';

export interface Span {
  id: string;
  parentId?: string;
  name: string;
  kind: SpanKind;
  start: number;
  end?: number;
  status: 'running' | 'ok' | 'error';
  error?: string;
  attrs: Record<string, string | number | boolean>;
}

export interface Trace {
  id: string;
  kind: 'analysis' | 'chat' | 'search';
  videoId: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  spans: Span[];
}

export interface TraceTotals {
  llmCalls: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  /** USD, summed over calls whose model price is known. */
  costUsd: number;
  llmMs: number;
  errors: number;
  wallMs: number;
}

let seq = 0;
const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Minimal span tracer (think OpenTelemetry without the SDK). Every LLM call,
 * tool call and pipeline stage becomes a span with latency and token counts,
 * so a slow or expensive run can be explained after the fact instead of
 * guessed at. `onChange` lets the service worker persist and stream traces.
 */
export class Tracer {
  readonly trace: Trace;
  private readonly stack: string[] = [];

  constructor(
    init: Omit<Trace, 'id' | 'startedAt' | 'spans'> & { id?: string },
    private readonly onChange?: (t: Trace) => void
  ) {
    this.trace = { ...init, id: init.id ?? newId(), startedAt: Date.now(), spans: [] };
  }

  start(name: string, kind: SpanKind, attrs: Span['attrs'] = {}): Span {
    const span: Span = { id: newId(), parentId: this.stack[this.stack.length - 1], name, kind, start: Date.now(), status: 'running', attrs };
    this.trace.spans.push(span);
    this.onChange?.(this.trace);
    return span;
  }

  end(span: Span, attrs: Span['attrs'] = {}, error?: unknown): void {
    span.end = Date.now();
    Object.assign(span.attrs, attrs);
    if (error !== undefined) {
      span.status = 'error';
      span.error = redact(String((error as Error)?.message ?? error)).slice(0, 300);
    } else span.status = 'ok';
    this.onChange?.(this.trace);
  }

  async run<T>(name: string, kind: SpanKind, fn: (span: Span) => Promise<T>, attrs: Span['attrs'] = {}): Promise<T> {
    const span = this.start(name, kind, attrs);
    this.stack.push(span.id);
    try {
      const out = await fn(span);
      this.end(span);
      return out;
    } catch (err) {
      this.end(span, {}, err);
      throw err;
    } finally {
      this.stack.pop();
    }
  }

  finish(): Trace {
    this.trace.endedAt = Date.now();
    this.onChange?.(this.trace);
    return this.trace;
  }
}

/** Wrap a client so every chat/embed call is recorded as a span. */
export function tracedClient(client: LlmClient, tracer: Tracer): LlmClient {
  return {
    model: client.model,
    embeddingModel: client.embeddingModel,
    async chat(req: ChatRequest, onDelta?: (t: string) => void): Promise<ChatResult> {
      return tracer.run(
        req.purpose ?? 'chat',
        'llm',
        async (span) => {
          const out = await client.chat(req, onDelta);
          const cost = callCost(req.model ?? client.model, out.usage);
          Object.assign(span.attrs, {
            model: out.model,
            promptTokens: out.usage.promptTokens,
            cachedTokens: out.usage.cachedTokens ?? 0,
            completionTokens: out.usage.completionTokens,
            reasoningTokens: out.usage.reasoningTokens ?? 0,
            ...(cost !== undefined ? { costUsd: Number(cost.toFixed(6)) } : {}),
            estimated: out.usage.estimated,
            toolCalls: out.toolCalls.length,
            finish: out.finishReason
          });
          return out;
        },
        { model: req.model ?? client.model }
      );
    },
    ...(client.embed
      ? {
          embed: (texts: string[], signal?: AbortSignal) =>
            tracer.run('embed', 'embed', () => client.embed!(texts, signal), { count: texts.length, model: client.embeddingModel ?? '' })
        }
      : {})
  };
}

export function traceTotals(trace: Trace): TraceTotals {
  const llm = trace.spans.filter((s) => s.kind === 'llm');
  return {
    llmCalls: llm.length,
    promptTokens: llm.reduce((a, s) => a + Number(s.attrs.promptTokens ?? 0), 0),
    cachedTokens: llm.reduce((a, s) => a + Number(s.attrs.cachedTokens ?? 0), 0),
    completionTokens: llm.reduce((a, s) => a + Number(s.attrs.completionTokens ?? 0), 0),
    costUsd: llm.reduce((a, s) => a + Number(s.attrs.costUsd ?? 0), 0),
    llmMs: llm.reduce((a, s) => a + ((s.end ?? s.start) - s.start), 0),
    errors: trace.spans.filter((s) => s.status === 'error').length,
    wallMs: (trace.endedAt ?? Date.now()) - trace.startedAt
  };
}

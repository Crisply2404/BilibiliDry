export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface JsonSchema {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: JsonSchema };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object response (falls back to prompt-only JSON if the provider rejects it). */
  json?: boolean;
  /** Override the client's default model for this call (used by the cheap/strong cascade). */
  model?: string;
  signal?: AbortSignal;
  /** Free-form label recorded in traces, e.g. "map:chunk-3". */
  purpose?: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  /** True when the provider did not report usage and we estimated it from characters. */
  estimated: boolean;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage;
  model: string;
  latencyMs: number;
  finishReason: string;
}

export interface LlmClient {
  readonly model: string;
  readonly embeddingModel?: string;
  chat(req: ChatRequest, onDelta?: (text: string) => void): Promise<ChatResult>;
  embed?(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

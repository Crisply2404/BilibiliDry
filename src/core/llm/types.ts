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
  /** Thinking text of an assistant turn. DeepSeek requires it to be sent back on turns that made tool calls. */
  reasoning_content?: string;
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
  /** Free-form label recorded in traces, e.g. "analyze" or "qa:step-2". */
  purpose?: string;
  /**
   * How much the model should think before answering, for providers that support it
   * (DeepSeek: "off" disables thinking, the rest map to reasoning_effort). Ignored elsewhere.
   */
  reasoning?: ReasoningLevel;
}

export type ReasoningLevel = 'off' | 'low' | 'high' | 'max';

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  /** Prompt tokens served from the provider's prefix cache (billed at the cache-hit price). */
  cachedTokens?: number;
  /** Part of completionTokens spent on thinking. */
  reasoningTokens?: number;
  /** True when the provider did not report usage and we estimated it from characters. */
  estimated: boolean;
}

export interface ChatResult {
  content: string;
  /** Thinking text, if the provider returned any. */
  reasoning: string;
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

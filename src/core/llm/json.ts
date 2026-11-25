import type { ChatRequest, ChatResult, LlmClient } from './types';
import { LlmError } from './types';

/**
 * Pull a JSON value out of a model reply: tolerates ```json fences, prose
 * before/after the object, and trailing commas — the three ways models most
 * often break "return JSON only".
 */
export function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    // fall through
  }
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('回复中没有 JSON');
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        const slice = body.slice(start, i + 1).replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(slice);
      }
    }
  }
  throw new Error('JSON 不完整（可能被截断）');
}

export type Coerce<T> = (raw: unknown) => T;

/**
 * Chat call that must return JSON of a given shape. `coerce` validates and
 * normalises the raw object, throwing a readable message when it cannot. On
 * failure the model gets one repair turn with the error, which fixes most
 * format slips without paying for a full retry of the original prompt.
 */
export async function chatJson<T>(
  client: LlmClient,
  req: ChatRequest,
  coerce: Coerce<T>
): Promise<{ value: T; result: ChatResult; repaired: boolean }> {
  const first = await client.chat({ ...req, json: true });
  try {
    return { value: coerce(parseJsonLoose(first.content)), result: first, repaired: false };
  } catch (err) {
    const problem = String((err as Error)?.message ?? err).slice(0, 300);
    const second = await client.chat({
      ...req,
      json: true,
      purpose: `${req.purpose ?? 'json'}:repair`,
      messages: [
        ...req.messages,
        { role: 'assistant', content: first.content.slice(0, 6000) },
        { role: 'user', content: `上面的输出无法解析：${problem}。请只输出修正后的 JSON，不要任何解释。` }
      ]
    });
    try {
      return { value: coerce(parseJsonLoose(second.content)), result: second, repaired: true };
    } catch (err2) {
      throw new LlmError(`模型输出格式错误：${String((err2 as Error)?.message ?? err2).slice(0, 200)}`);
    }
  }
}

// Small coercion helpers so prompt schemas and validators stay next to each other.
export function asObject(v: unknown, what = '对象'): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`期望${what}`);
  return v as Record<string, unknown>;
}

export function asArray(v: unknown, what = '数组'): unknown[] {
  if (!Array.isArray(v)) throw new Error(`期望${what}`);
  return v;
}

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : fallback;
}

export function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function asStringArray(v: unknown, max = 10): string[] {
  return Array.isArray(v) ? v.map((x) => asString(x)).filter(Boolean).slice(0, max) : [];
}

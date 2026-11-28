import { createOpenAICompatClient } from '../core/llm/openaiCompat';
import { analysisCharBudget, findPreset, presetForUrl } from '../core/llm/presets';
import type { LlmClient } from '../core/llm/types';
import { isConfigured, type Settings } from '../shared/settings';

export class NotConfiguredError extends Error {
  constructor() {
    super('还没有配置模型：在设置里选一个服务商、填上 API Key，就能分析注水和提问');
    this.name = 'NotConfiguredError';
  }
}

function presetOf(s: Settings) {
  return presetForUrl(s.baseUrl) ?? findPreset(s.provider);
}

export function clientFor(s: Settings): LlmClient {
  if (!isConfigured(s)) throw new NotConfiguredError();
  return createOpenAICompatClient({
    baseUrl: s.baseUrl,
    apiKey: s.apiKey || undefined,
    model: s.model,
    embeddingModel: s.embeddingModel || undefined,
    reasoning: s.reasoning,
    reasoningStyle: presetOf(s)?.reasoningStyle ?? 'none',
    // A whole-video analysis streams for a while; give it room.
    timeoutMs: 240_000
  });
}

/** Transcript characters per analysis call for the configured provider. */
export function charBudget(s: Settings): number {
  return analysisCharBudget(presetOf(s));
}

export async function testConnection(s: Settings): Promise<{ model: string; latencyMs: number; embedding?: string }> {
  const client = clientFor(s);
  const res = await client.chat({ messages: [{ role: 'user', content: '只回复两个字：收到' }], maxTokens: 10, temperature: 0, reasoning: 'off', purpose: 'test' });
  let embedding: string | undefined;
  if (client.embed) {
    try {
      const v = await client.embed(['测试']);
      embedding = `${s.embeddingModel}（${v[0]?.length ?? 0} 维）`;
    } catch (err) {
      embedding = `失败：${(err as Error).message}`;
    }
  }
  return { model: res.model, latencyMs: res.latencyMs, embedding };
}

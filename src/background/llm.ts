import { createOpenAICompatClient } from '../core/llm/openaiCompat';
import type { LlmClient } from '../core/llm/types';
import { isConfigured, type Settings } from '../shared/settings';

export class NotConfiguredError extends Error {
  constructor() {
    super('还没有配置模型：请在扩展设置里选择服务商并填写 API Key');
    this.name = 'NotConfiguredError';
  }
}

export function clientFor(s: Settings, opts: { model?: string } = {}): LlmClient {
  if (!isConfigured(s)) throw new NotConfiguredError();
  return createOpenAICompatClient({
    baseUrl: s.baseUrl,
    apiKey: s.apiKey || undefined,
    model: opts.model ?? s.model,
    embeddingModel: s.embeddingModel || undefined
  });
}

export async function testConnection(s: Settings): Promise<{ model: string; latencyMs: number; embedding?: string }> {
  const client = clientFor(s);
  const res = await client.chat({ messages: [{ role: 'user', content: '只回复两个字：收到' }], maxTokens: 10, temperature: 0, purpose: 'test' });
  let embedding: string | undefined;
  if (client.embed) {
    try {
      const v = await client.embed(['测试']);
      embedding = `${s.embeddingModel}（${v[0]?.length ?? 0} 维）`;
    } catch (err) {
      embedding = `失败：${(err as Error).message}`;
    }
  }
  if (s.cheapModel && s.cheapModel !== s.model) {
    await client.chat({ model: s.cheapModel, messages: [{ role: 'user', content: '只回复两个字：收到' }], maxTokens: 10, temperature: 0 });
  }
  return { model: res.model, latencyMs: res.latencyMs, embedding };
}

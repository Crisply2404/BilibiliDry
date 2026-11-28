import type { ReasoningStyle } from './openaiCompat';

/**
 * Provider presets for the settings page. Every entry is an OpenAI-compatible
 * endpoint, so one client covers all of them. Model names are defaults only;
 * users can type any model their account has.
 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  /** Default model; users can type any model their account has. */
  model: string;
  /** Other models worth offering in the picker. */
  models?: string[];
  embeddingModel?: string;
  /** How to ask for less or more thinking; providers without it get no extra parameters. */
  reasoningStyle?: ReasoningStyle;
  /** Context window in tokens, used to decide whether a whole transcript fits in one call. */
  contextTokens?: number;
  keyUrl?: string;
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek（推荐）',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    reasoningStyle: 'deepseek',
    contextTokens: 1_000_000,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: 'deepseek-flash 便宜、快、中文好，1M 上下文；没有 Embedding 接口，知识库检索只用关键词'
  },
  {
    id: 'qwen',
    label: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    embeddingModel: 'text-embedding-v3',
    keyUrl: 'https://bailian.console.aliyun.com/'
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    embeddingModel: 'BAAI/bge-m3',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: 'bge-m3 Embedding 免费'
  },
  {
    id: 'moonshot',
    label: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2-turbo-preview',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys'
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.5-air',
    embeddingModel: 'embedding-3',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys'
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    embeddingModel: 'gemini-embedding-001',
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    embeddingModel: 'text-embedding-3-small',
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-chat-v3.1',
    keyUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'ollama',
    label: 'Ollama（本地模型）',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    embeddingModel: 'bge-m3',
    note: '完全离线；需先 `ollama pull`，并设置 OLLAMA_ORIGINS=chrome-extension://*'
  },
  { id: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' }
];

export function findPreset(id: string | undefined): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/** Origin pattern for chrome.permissions.request, e.g. "https://api.deepseek.com/*". */
export function originPattern(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

/** Transcript characters to send per analysis call for a provider/base URL. */
export function analysisCharBudget(preset: ProviderPreset | undefined): number {
  const tokens = preset?.contextTokens ?? 128_000;
  // ~1.3 characters per token for Chinese captions with line prefixes; leave half the window for output and prompt.
  return Math.min(300_000, Math.floor(tokens * 0.5 * 1.3));
}

export function presetForUrl(baseUrl: string): ProviderPreset | undefined {
  try {
    const host = new URL(baseUrl).host;
    return PROVIDER_PRESETS.find((p) => p.baseUrl && new URL(p.baseUrl).host === host);
  } catch {
    return undefined;
  }
}

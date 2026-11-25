/**
 * Provider presets for the settings page. Every entry is an OpenAI-compatible
 * endpoint, so one client covers all of them. Model names are defaults only;
 * users can type any model their account has.
 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  cheapModel?: string;
  embeddingModel?: string;
  keyUrl?: string;
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: '便宜、中文好；没有 Embedding 接口，检索只用 BM25'
  },
  {
    id: 'qwen',
    label: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    cheapModel: 'qwen-flash',
    embeddingModel: 'text-embedding-v3',
    keyUrl: 'https://bailian.console.aliyun.com/'
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    cheapModel: 'Qwen/Qwen2.5-7B-Instruct',
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
    cheapModel: 'glm-4.5-flash',
    embeddingModel: 'embedding-3',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys'
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    cheapModel: 'gemini-2.5-flash-lite',
    embeddingModel: 'gemini-embedding-001',
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    cheapModel: 'gpt-4.1-nano',
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

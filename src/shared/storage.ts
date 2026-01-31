export interface ExtensionConfig {
  llmProvider: 'gemini' | 'openai';

  // Gemini
  geminiApiKey?: string;

  // OpenAI-compatible
  openaiBaseUrl: string;
  openaiApiKey?: string;
  openaiModel: string;
  openaiEmbeddingModel: string;

  // Qiniu (reserved for future use)
  qiniuAccessKey?: string;
  qiniuSecretKey?: string;
  qiniuBucket?: string;
  qiniuDomain?: string;

  analysis: {
    chunkSec: number;
    concurrency: number;
    autoAnalyzeOnOpen: boolean;
    autoSkip: boolean;
  };
}

const DEFAULT_CONFIG: ExtensionConfig = {
  llmProvider: 'gemini',
  openaiBaseUrl: '',
  openaiModel: '',
  openaiEmbeddingModel: '',
  analysis: {
    chunkSec: 90,
    concurrency: 1,
    autoAnalyzeOnOpen: false,
    autoSkip: false
  }
};

const STORAGE_KEY = 'config';

function envString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

function getEnvDefaults(): Partial<ExtensionConfig> {
  // NOTE: Vite only exposes `VITE_*` variables to client bundles.
  // This is intended for local development / self-built extensions (BYOK).
  // Do NOT publish builds that contain your private keys.
  const env: any = (import.meta as any).env ?? {};
  const llmProvider = envString(env.VITE_LLM_PROVIDER);
  const geminiApiKey = envString(env.VITE_GEMINI_API_KEY);

  const openaiBaseUrl = envString(env.VITE_OPENAI_BASE_URL);
  const openaiApiKey = envString(env.VITE_OPENAI_API_KEY);
  const openaiModel = envString(env.VITE_OPENAI_MODEL);
  const openaiEmbeddingModel = envString(env.VITE_OPENAI_EMBEDDING_MODEL);

  const qiniuAccessKey = envString(env.VITE_QINIU_ACCESS_KEY);
  const qiniuSecretKey = envString(env.VITE_QINIU_SECRET_KEY);
  const qiniuBucket = envString(env.VITE_QINIU_BUCKET);
  const qiniuDomain = envString(env.VITE_QINIU_DOMAIN);

  const defaults: Partial<ExtensionConfig> = {};
  if (llmProvider === 'gemini' || llmProvider === 'openai') {
    defaults.llmProvider = llmProvider;
  } else {
    // DX: if user only sets OpenAI env vars, auto switch provider to OpenAI-compatible.
    // Stored config (settings page) still takes precedence over env defaults.
    if (openaiApiKey || openaiBaseUrl) defaults.llmProvider = 'openai';
    else if (geminiApiKey) defaults.llmProvider = 'gemini';
  }
  if (geminiApiKey) defaults.geminiApiKey = geminiApiKey;

  if (openaiBaseUrl) defaults.openaiBaseUrl = openaiBaseUrl;
  if (openaiApiKey) defaults.openaiApiKey = openaiApiKey;
  if (openaiModel) defaults.openaiModel = openaiModel;
  if (openaiEmbeddingModel) defaults.openaiEmbeddingModel = openaiEmbeddingModel;

  if (qiniuAccessKey) defaults.qiniuAccessKey = qiniuAccessKey;
  if (qiniuSecretKey) defaults.qiniuSecretKey = qiniuSecretKey;
  if (qiniuBucket) defaults.qiniuBucket = qiniuBucket;
  if (qiniuDomain) defaults.qiniuDomain = qiniuDomain;

  return defaults;
}

export async function getConfig(): Promise<ExtensionConfig> {
  const { [STORAGE_KEY]: config } = await chrome.storage.local.get(STORAGE_KEY);
  const envDefaults = getEnvDefaults();
  const merged: ExtensionConfig = {
    ...DEFAULT_CONFIG,
    ...envDefaults,
    ...(config ?? {}),
    analysis: {
      ...DEFAULT_CONFIG.analysis,
      ...(config?.analysis ?? {})
    }
  };

  // Backward compatibility: older config had only geminiApiKey.
  if (!merged.llmProvider) merged.llmProvider = 'gemini';

  return merged;
}

export async function setConfig(partial: Partial<ExtensionConfig>): Promise<void> {
  const current = await getConfig();
  const next: ExtensionConfig = {
    ...current,
    ...partial,
    analysis: {
      ...current.analysis,
      ...(partial.analysis ?? {})
    }
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

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
  openaiBaseUrl: 'https://api.qnaigc.com/v1',
  openaiModel: 'x-ai/grok-4.1-fast-reasoning',
  openaiEmbeddingModel: 'text-embedding-3-small',
  analysis: {
    chunkSec: 90,
    concurrency: 1,
    autoAnalyzeOnOpen: false,
    autoSkip: false
  }
};

const STORAGE_KEY = 'config';

export async function getConfig(): Promise<ExtensionConfig> {
  const { [STORAGE_KEY]: config } = await chrome.storage.local.get(STORAGE_KEY);
  const merged: ExtensionConfig = {
    ...DEFAULT_CONFIG,
    ...(config ?? {}),
    analysis: {
      ...DEFAULT_CONFIG.analysis,
      ...(config?.analysis ?? {})
    }
  };

  // Backward compatibility: older config had only geminiApiKey.
  if (!merged.llmProvider) merged.llmProvider = 'gemini';
  if (!merged.openaiBaseUrl) merged.openaiBaseUrl = DEFAULT_CONFIG.openaiBaseUrl;
  if (!merged.openaiModel) merged.openaiModel = DEFAULT_CONFIG.openaiModel;
  if (!merged.openaiEmbeddingModel) merged.openaiEmbeddingModel = DEFAULT_CONFIG.openaiEmbeddingModel;

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

export interface ExtensionConfig {
  geminiApiKey?: string;
  analysis: {
    chunkSec: number;
    concurrency: number;
    autoAnalyzeOnOpen: boolean;
    autoSkip: boolean;
  };
}

const DEFAULT_CONFIG: ExtensionConfig = {
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
  return {
    ...DEFAULT_CONFIG,
    ...(config ?? {}),
    analysis: {
      ...DEFAULT_CONFIG.analysis,
      ...(config?.analysis ?? {})
    }
  };
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


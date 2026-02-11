import type { WaterReasonType } from '../../types';

export interface ExtensionConfig {
  llmProvider: 'gemini' | 'openai';

  developerMode: boolean;

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

  cascade?: {
    enabled: boolean;
    cheapModel?: string;
    strongModel?: string;
    strongTopK: number;
  };

  waterFilter?: {
    enabledTypes: WaterReasonType[];
  };
}

const DEFAULT_CONFIG: ExtensionConfig = {
  llmProvider: 'gemini',
  developerMode: false,
  openaiBaseUrl: '',
  openaiModel: '',
  openaiEmbeddingModel: '',
  analysis: {
    chunkSec: 90,
    concurrency: 1,
    autoAnalyzeOnOpen: false,
    autoSkip: false
  },
  cascade: {
    enabled: false,
    strongTopK: 6
  },
  waterFilter: {
    enabledTypes: ['REPEAT', 'NO_NEW_INFO', 'AD', 'SMALLTALK', 'OFFTOPIC']
  }
};

const ALL_WATER_REASON_TYPES: WaterReasonType[] = ['REPEAT', 'NO_NEW_INFO', 'AD', 'SMALLTALK', 'OFFTOPIC'];
const LEGACY_DEFAULT_WATER_REASON_TYPES: WaterReasonType[] = ['REPEAT', 'NO_NEW_INFO', 'AD'];

const STORAGE_KEY = 'config';

function envString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

function envNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : undefined;
}

function envBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return true;
}

function uniqueWaterReasonTypes(input: unknown): WaterReasonType[] | null {
  if (!Array.isArray(input)) return null;
  const known = new Set<WaterReasonType>(ALL_WATER_REASON_TYPES);
  const out: WaterReasonType[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const t = item as WaterReasonType;
    if (!known.has(t)) continue;
    if (out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

function setKey(list: WaterReasonType[]): string {
  return list
    .slice()
    .sort()
    .join('|');
}

function getEnvDefaults(): Partial<ExtensionConfig> {
  // NOTE: Vite only exposes `VITE_*` variables to client bundles.
  // This is intended for local development / self-built extensions (BYOK).
  // Do NOT publish builds that contain your private keys.
  const env: any = (import.meta as any).env ?? {};
  const llmProvider = envString(env.VITE_LLM_PROVIDER);
  const developerMode = envBool(env.VITE_DEVELOPER_MODE ?? env.VITE_DEV_MODE);
  const geminiApiKey = envString(env.VITE_GEMINI_API_KEY);

  const openaiBaseUrl = envString(env.VITE_OPENAI_BASE_URL);
  const openaiApiKey = envString(env.VITE_OPENAI_API_KEY);
  const openaiModel = envString(env.VITE_OPENAI_MODEL);
  const openaiEmbeddingModel = envString(env.VITE_OPENAI_EMBEDDING_MODEL);
  const envCheapModel =
    envString(env.VITE_OPENAI_CHEAP_MODEL) ??
    envString(env.VITE_OPENAI_CHEAPMODEL) ??
    envString(env.VITE_CHEAP_MODEL) ??
    envString(env.VITE_CHEAPMODEL);
  const envStrongModel =
    envString(env.VITE_OPENAI_STRONG_MODEL) ?? envString(env.VITE_STRONG_MODEL) ?? openaiModel;
  const envCascadeTopKRaw = envNumber(env.VITE_OPENAI_CASCADE_TOPK) ?? envNumber(env.VITE_CASCADE_TOPK);
  const envCascadeTopK = Number.isFinite(envCascadeTopKRaw)
    ? Math.max(1, Math.min(8, Math.floor(Number(envCascadeTopKRaw))))
    : undefined;

  const qiniuAccessKey = envString(env.VITE_QINIU_ACCESS_KEY);
  const qiniuSecretKey = envString(env.VITE_QINIU_SECRET_KEY);
  const qiniuBucket = envString(env.VITE_QINIU_BUCKET);
  const qiniuDomain = envString(env.VITE_QINIU_DOMAIN);

  const defaults: Partial<ExtensionConfig> = {};
  if (typeof developerMode === 'boolean') defaults.developerMode = developerMode;
  if (llmProvider === 'gemini' || llmProvider === 'openai') {
    defaults.llmProvider = llmProvider;
  } else {
    // DX: if user only sets OpenAI env vars, auto switch provider to OpenAI-compatible.
    // Stored config (settings page) still takes precedence over env defaults.
    if (openaiApiKey || openaiBaseUrl || openaiModel || envCheapModel || envStrongModel) defaults.llmProvider = 'openai';
    else if (geminiApiKey) defaults.llmProvider = 'gemini';
  }
  if (geminiApiKey) defaults.geminiApiKey = geminiApiKey;

  if (openaiBaseUrl) defaults.openaiBaseUrl = openaiBaseUrl;
  if (openaiApiKey) defaults.openaiApiKey = openaiApiKey;
  if (openaiModel) defaults.openaiModel = openaiModel;
  if (openaiEmbeddingModel) defaults.openaiEmbeddingModel = openaiEmbeddingModel;

  // Env-driven cascade (only when both models can be resolved):
  // cheap model from VITE_OPENAI_CHEAP_MODEL, strong model from VITE_OPENAI_MODEL or VITE_OPENAI_STRONG_MODEL.
  if (envCheapModel && envStrongModel) {
    defaults.cascade = {
      enabled: true,
      cheapModel: envCheapModel,
      strongModel: envStrongModel,
      strongTopK: envCascadeTopK ?? DEFAULT_CONFIG.cascade!.strongTopK
    };
  }

  if (qiniuAccessKey) defaults.qiniuAccessKey = qiniuAccessKey;
  if (qiniuSecretKey) defaults.qiniuSecretKey = qiniuSecretKey;
  if (qiniuBucket) defaults.qiniuBucket = qiniuBucket;
  if (qiniuDomain) defaults.qiniuDomain = qiniuDomain;

  return defaults;
}

export async function getConfig(): Promise<ExtensionConfig> {
  const { [STORAGE_KEY]: config } = await chrome.storage.local.get(STORAGE_KEY);
  const envDefaults = getEnvDefaults();
  const envCascadeForced =
    envDefaults.cascade?.enabled === true &&
    typeof envDefaults.cascade.cheapModel === 'string' &&
    envDefaults.cascade.cheapModel.trim().length > 0 &&
    typeof envDefaults.cascade.strongModel === 'string' &&
    envDefaults.cascade.strongModel.trim().length > 0;

  const merged: ExtensionConfig = {
    ...DEFAULT_CONFIG,
    ...envDefaults,
    ...(config ?? {}),
    analysis: {
      ...DEFAULT_CONFIG.analysis,
      ...(config?.analysis ?? {})
    },
    cascade: {
      ...DEFAULT_CONFIG.cascade,
      ...(config?.cascade ?? {})
    },
    waterFilter: {
      ...DEFAULT_CONFIG.waterFilter,
      ...(config?.waterFilter ?? {})
    }
  };

  // Backward compatibility: older config had only geminiApiKey.
  if (!merged.llmProvider) merged.llmProvider = 'gemini';
  if (!merged.cascade) merged.cascade = { ...DEFAULT_CONFIG.cascade };
  if (!merged.waterFilter) merged.waterFilter = { ...DEFAULT_CONFIG.waterFilter };

  // Upgrade legacy default water filter (3 types) → new default (all types).
  // Only auto-upgrade when the stored config is exactly the legacy default, to avoid overriding user choices.
  const storedEnabledTypes = uniqueWaterReasonTypes(config?.waterFilter?.enabledTypes);
  if (
    storedEnabledTypes &&
    setKey(storedEnabledTypes) === setKey(LEGACY_DEFAULT_WATER_REASON_TYPES) &&
    Array.isArray(merged.waterFilter?.enabledTypes)
  ) {
    merged.waterFilter = { enabledTypes: ALL_WATER_REASON_TYPES.slice() };
  }

  // When env explicitly provides cheap+strong models, force cascade on this runtime config.
  // This lets local `.env.local` become a one-stop switch for development.
  if (envCascadeForced && envDefaults.cascade) {
    merged.llmProvider = 'openai';
    merged.cascade = {
      ...merged.cascade,
      ...envDefaults.cascade,
      enabled: true
    };
    if (typeof envDefaults.cascade.strongModel === 'string' && envDefaults.cascade.strongModel.trim()) {
      merged.openaiModel = envDefaults.cascade.strongModel;
    }
  }

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
    },
    cascade: {
      ...current.cascade,
      ...(partial.cascade ?? {})
    },
    waterFilter: {
      ...current.waterFilter,
      ...(partial.waterFilter ?? {})
    }
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

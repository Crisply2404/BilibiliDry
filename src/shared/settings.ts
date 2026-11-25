import { findPreset } from '../core/llm/presets';
import { WATER_REASONS, type WaterReason } from '../core/types';

export interface Settings {
  provider: string;
  baseUrl: string;
  apiKey: string;
  /** Strong model: chapters, verification, refining highlights, Q&A. */
  model: string;
  /** Cheap model for the many per-chunk calls; empty = use `model`. */
  cheapModel: string;
  /** Empty = no vector retrieval (BM25 only). */
  embeddingModel: string;
  autoAnalyze: boolean;
  autoSkip: boolean;
  skipReasons: WaterReason[];
  showStrip: boolean;
  concurrency: number;
  chunkSec: number;
  developerMode: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'deepseek',
  baseUrl: findPreset('deepseek')!.baseUrl,
  apiKey: '',
  model: findPreset('deepseek')!.model,
  cheapModel: '',
  embeddingModel: '',
  autoAnalyze: false,
  autoSkip: false,
  skipReasons: ['ad', 'smalltalk', 'repeat'],
  showStrip: true,
  concurrency: 3,
  chunkSec: 120,
  developerMode: false
};

const KEY = 'settings.v1';

/**
 * Local developer builds may prefill settings from `.env.local` (VITE_*).
 * Vite inlines these values into the bundle, so they must never be set for a
 * build that is published.
 */
function envDefaults(): Partial<Settings> {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const pick = (k: string) => (env[k] ?? '').trim();
  const out: Partial<Settings> = {};
  if (pick('VITE_OPENAI_BASE_URL')) Object.assign(out, { provider: 'custom', baseUrl: pick('VITE_OPENAI_BASE_URL') });
  if (pick('VITE_OPENAI_API_KEY')) out.apiKey = pick('VITE_OPENAI_API_KEY');
  if (pick('VITE_OPENAI_MODEL')) out.model = pick('VITE_OPENAI_MODEL');
  if (pick('VITE_OPENAI_CHEAP_MODEL')) out.cheapModel = pick('VITE_OPENAI_CHEAP_MODEL');
  if (pick('VITE_OPENAI_EMBEDDING_MODEL')) out.embeddingModel = pick('VITE_OPENAI_EMBEDDING_MODEL');
  if (pick('VITE_DEVELOPER_MODE') === '1') out.developerMode = true;
  return out;
}

export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...envDefaults(), ...(raw ?? {}) };
  return {
    ...merged,
    baseUrl: String(merged.baseUrl ?? '').trim().replace(/\/+$/, ''),
    apiKey: String(merged.apiKey ?? '').trim(),
    model: String(merged.model ?? '').trim(),
    cheapModel: String(merged.cheapModel ?? '').trim(),
    embeddingModel: String(merged.embeddingModel ?? '').trim(),
    skipReasons: (merged.skipReasons ?? []).filter((r): r is WaterReason => (WATER_REASONS as readonly string[]).includes(r)),
    concurrency: Math.max(1, Math.min(6, Math.round(Number(merged.concurrency) || 3))),
    chunkSec: Math.max(45, Math.min(300, Math.round(Number(merged.chunkSec) || 120)))
  };
}

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(KEY);
  return normalizeSettings(got[KEY] as Partial<Settings> | undefined);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[KEY]) cb(normalizeSettings(changes[KEY].newValue as Partial<Settings>));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export function isConfigured(s: Settings): boolean {
  return Boolean(s.baseUrl && s.model && (s.apiKey || /localhost|127\.0\.0\.1/.test(s.baseUrl)));
}

import { findPreset } from '../core/llm/presets';
import type { ReasoningLevel } from '../core/llm/types';
import { WATER_REASONS, type WaterReason } from '../core/types';

export interface Settings {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** How much the model thinks before answering (providers that support it, e.g. DeepSeek). */
  reasoning: ReasoningLevel;
  /** Empty = keyword search only in the library. */
  embeddingModel: string;
  autoAnalyze: boolean;
  autoSkip: boolean;
  skipReasons: WaterReason[];
  /** Draw dry/filler segments on Bilibili's progress bar. */
  showOnProgress: boolean;
  developerMode: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'deepseek',
  baseUrl: findPreset('deepseek')!.baseUrl,
  apiKey: '',
  model: findPreset('deepseek')!.model,
  reasoning: 'off',
  embeddingModel: '',
  autoAnalyze: false,
  autoSkip: false,
  skipReasons: ['ad', 'smalltalk', 'repeat'],
  showOnProgress: true,
  developerMode: false
};

const KEY = 'settings.v1';
const REASONING: ReasoningLevel[] = ['off', 'low', 'high', 'max'];

/**
 * Local developer builds may prefill settings from `.env.local` (VITE_LLM_*).
 * Vite inlines these values into the bundle, so they must never be set for a
 * build that is published (`npm run package` and the demo read an empty env dir).
 */
function envDefaults(): Partial<Settings> {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const pick = (k: string) => (env[k] ?? '').trim();
  const out: Partial<Settings> = {};
  const baseUrl = pick('VITE_LLM_BASE_URL');
  if (baseUrl) Object.assign(out, { provider: findPresetByUrl(baseUrl) ?? 'custom', baseUrl });
  if (pick('VITE_LLM_API_KEY')) out.apiKey = pick('VITE_LLM_API_KEY');
  if (pick('VITE_LLM_MODEL')) out.model = pick('VITE_LLM_MODEL');
  return out;
}

function findPresetByUrl(baseUrl: string): string | undefined {
  const host = (u: string) => {
    try {
      return new URL(u).host;
    } catch {
      return '';
    }
  };
  return ['deepseek', 'qwen', 'siliconflow', 'moonshot', 'zhipu', 'gemini', 'openai', 'openrouter'].find((id) => host(findPreset(id)?.baseUrl ?? '') === host(baseUrl));
}

export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...envDefaults(), ...(raw ?? {}) };
  return {
    provider: String(merged.provider || 'custom'),
    baseUrl: String(merged.baseUrl ?? '').trim().replace(/\/+$/, ''),
    apiKey: String(merged.apiKey ?? '').trim(),
    model: String(merged.model ?? '').trim(),
    reasoning: REASONING.includes(merged.reasoning) ? merged.reasoning : DEFAULT_SETTINGS.reasoning,
    embeddingModel: String(merged.embeddingModel ?? '').trim(),
    autoAnalyze: Boolean(merged.autoAnalyze),
    autoSkip: Boolean(merged.autoSkip),
    skipReasons: (merged.skipReasons ?? []).filter((r): r is WaterReason => (WATER_REASONS as readonly string[]).includes(r)),
    showOnProgress: merged.showOnProgress !== false,
    developerMode: Boolean(merged.developerMode)
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

/** A model is configured, so analysis and Q&A are available (the official summary works without one). */
export function isConfigured(s: Settings): boolean {
  return Boolean(s.baseUrl && s.model && (s.apiKey || /localhost|127\.0\.0\.1/.test(s.baseUrl)));
}

import type { Usage } from './types';

/**
 * Published prices in USD per 1M tokens, for models whose price we know. Used to show what an
 * analysis or an answer cost; unknown models simply show no cost.
 *
 * DeepSeek (api-docs.deepseek.com/quick_start/pricing, read 2026-11-28) charges double during
 * peak hours: 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday.
 */
interface Price {
  input: number;
  cachedInput: number;
  output: number;
  peakMultiplier?: number;
}

const PRICES: Record<string, Price> = {
  'deepseek-flash': { input: 0.15, cachedInput: 0.003, output: 0.6, peakMultiplier: 2 },
  'deepseek-v4-pro': { input: 0.66, cachedInput: 0.022, output: 1.98, peakMultiplier: 2 }
};

export function isDeepSeekPeak(at: Date): boolean {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = at.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

/** Cost of one call in USD, or undefined when the model's price is unknown. */
export function callCost(model: string, usage: Usage, at = new Date()): number | undefined {
  const price = PRICES[model];
  if (!price) return undefined;
  const cached = Math.min(usage.cachedTokens ?? 0, usage.promptTokens);
  const multiplier = price.peakMultiplier && isDeepSeekPeak(at) ? price.peakMultiplier : 1;
  return (((usage.promptTokens - cached) * price.input + cached * price.cachedInput + usage.completionTokens * price.output) / 1e6) * multiplier;
}

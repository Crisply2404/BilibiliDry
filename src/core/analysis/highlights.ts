import { mmr } from '../retrieval/fusion';
import type { Segment } from '../types';

/** Number of highlights scales with length: ~1 per 4 minutes, between 3 and 10. */
export function highlightBudget(durationSec: number): number {
  return Math.max(3, Math.min(10, Math.round(durationSec / 240)));
}

export function highlightScore(seg: Segment): number {
  if (seg.kind !== 'dry') return 0;
  const importance = Math.max(1, Math.min(5, seg.importance)) / 5;
  const lexical = seg.grounding?.lexical ?? 0.6;
  const verdict = seg.grounding?.verdict;
  const verdictFactor = verdict === 'unsupported' ? 0 : verdict === 'partial' ? 0.6 : 1;
  // Grounding is a multiplier, not a filter: a vital point paraphrased heavily still ranks, just lower.
  return importance * (0.5 + 0.5 * lexical) * verdictFactor;
}

/**
 * Pick the moments worth watching if you only have a few minutes.
 *
 * Replaces "sort by the model's self-reported confidence and take 6": the
 * model's confidence says nothing about value, a fixed 6 is wrong for both a
 * 5-minute and a 2-hour video, and top-N by score tends to pick five adjacent
 * segments from the same dense stretch. Here the score combines importance
 * with evidence grounding, the budget follows duration, and MMR penalises
 * picks that sit close in time to ones already chosen.
 */
export function selectHighlights(segments: Segment[], durationSec: number, budget = highlightBudget(durationSec)): Segment[] {
  const candidates = segments.filter((s) => s.kind === 'dry' && s.importance >= 3 && highlightScore(s) > 0);
  if (candidates.length === 0) return [];
  const spacing = Math.max(30, durationSec / Math.max(1, budget));
  const center = (s: Segment) => (s.start + s.end) / 2;
  const picked = mmr({
    candidates,
    relevance: highlightScore,
    similarity: (a, b) => Math.max(0, 1 - Math.abs(center(a) - center(b)) / spacing),
    k: budget,
    lambda: 0.7
  });
  return picked.sort((a, b) => a.start - b.start);
}

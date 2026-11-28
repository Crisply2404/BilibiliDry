import type { Segment, WaterReason } from './types';

export function segmentAt(segments: Segment[], t: number): Segment | undefined {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (t < s.start) hi = mid - 1;
    else if (t >= s.end) lo = mid + 1;
    else return s;
  }
  return undefined;
}

export function isSkippable(seg: Segment | undefined, reasons: ReadonlySet<WaterReason>): boolean {
  return Boolean(seg && seg.kind === 'water' && seg.waterReason && reasons.has(seg.waterReason));
}

/**
 * Where to jump if the viewer skips now: the end of the run of consecutive
 * skippable segments containing `t` (gaps under `gapSec` are bridged so two
 * adjacent filler segments are skipped in one jump, not two). Returns null
 * when `t` is not inside a skippable segment or the jump would be too short
 * to be worth it.
 */
export function skipTarget(segments: Segment[], t: number, reasons: ReadonlySet<WaterReason>, opts: { gapSec?: number; minSkipSec?: number } = {}): number | null {
  const gap = opts.gapSec ?? 1.5;
  const min = opts.minSkipSec ?? 3;
  const sorted = segments;
  let i = sorted.findIndex((s) => t >= s.start && t < s.end);
  if (i < 0 || !isSkippable(sorted[i], reasons)) return null;
  let end = sorted[i].end;
  while (i + 1 < sorted.length && isSkippable(sorted[i + 1], reasons) && sorted[i + 1].start - end <= gap) {
    i += 1;
    end = sorted[i].end;
  }
  return end - t >= min ? end : null;
}

/** Next highlight/dry segment start after `t`, for the "跳到下一段干货" button. */
export function nextDryStart(segments: Segment[], t: number): number | null {
  const next = segments.find((s) => s.kind === 'dry' && s.start > t + 1);
  return next ? next.start : null;
}

export interface HeatCell {
  start: number;
  end: number;
  /** 0 = filler, 1 = most important. */
  value: number;
  kind: 'dry' | 'water' | 'unknown';
}

export function heatmap(segments: Segment[], durationSec: number): HeatCell[] {
  const cells: HeatCell[] = [];
  let cursor = 0;
  for (const s of segments) {
    if (s.start > cursor + 0.5) cells.push({ start: cursor, end: s.start, value: 0, kind: 'unknown' });
    cells.push({ start: s.start, end: s.end, value: s.kind === 'water' ? 0 : s.importance / 5, kind: s.kind });
    cursor = Math.max(cursor, s.end);
  }
  if (durationSec > cursor + 0.5) cells.push({ start: cursor, end: durationSec, value: 0, kind: 'unknown' });
  return cells;
}

export interface SegmentStats {
  drySec: number;
  waterSec: number;
  /** Share of the analysed time that is not filler, 0..1; null before any analysis. */
  dryShare: number | null;
}

/**
 * The one definition of "干货 %" used everywhere (player, panel, library): the non-filler share of
 * the time the segments cover. The video's own duration is not used, because the transcript often
 * stops before the end credits and the share would then depend on how long they run.
 */
export function segmentStats(segments: Segment[]): SegmentStats {
  let drySec = 0;
  let waterSec = 0;
  for (const s of segments) {
    if (s.kind === 'water') waterSec += s.end - s.start;
    else drySec += s.end - s.start;
  }
  const total = drySec + waterSec;
  return { drySec, waterSec, dryShare: total > 0 ? drySec / total : null };
}

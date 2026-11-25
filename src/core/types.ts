/**
 * Domain types shared by the analysis pipeline, retrieval, the agent and the UI.
 * Everything in `src/core` is plain TypeScript with no browser-extension APIs,
 * so it runs in the service worker, in unit tests and in the offline eval harness.
 */

/** One subtitle line as delivered by Bilibili (times in seconds). */
export interface CaptionLine {
  /** Stable index into the cleaned caption array; used as the citation unit. */
  idx: number;
  from: number;
  to: number;
  text: string;
}

export type SegmentKind = 'dry' | 'water';

export type WaterReason = 'smalltalk' | 'repeat' | 'offtopic' | 'ad' | 'no_new_info';

export const WATER_REASONS: readonly WaterReason[] = ['smalltalk', 'repeat', 'offtopic', 'ad', 'no_new_info'];

export const WATER_REASON_LABEL: Record<WaterReason, string> = {
  smalltalk: '寒暄闲聊',
  repeat: '重复啰嗦',
  offtopic: '跑题',
  ad: '广告/恰饭',
  no_new_info: '无新信息'
};

export interface Grounding {
  /** 0..1, share of the summary's content words that appear in the cited caption lines. */
  lexical: number;
  /** Set when an LLM judge was asked to verify this segment. */
  verdict?: 'supported' | 'partial' | 'unsupported';
  reason?: string;
  /** Caption line indexes that support the summary (chosen by the judge, never rewritten). */
  evidence?: number[];
}

/**
 * A contiguous stretch of the video. Boundaries are expressed as caption line
 * indexes chosen by the model; times are derived from the captions, so the
 * model can never invent a timestamp.
 */
export interface Segment {
  id: string;
  fromLine: number;
  toLine: number;
  start: number;
  end: number;
  kind: SegmentKind;
  /** 1..5, how much a viewer would lose by skipping this stretch. */
  importance: number;
  title: string;
  summary: string;
  keyPoints: string[];
  waterReason?: WaterReason;
  grounding?: Grounding;
  /** Set when the strong model rewrote the summary of a highlight. */
  refined?: boolean;
}

export interface Chapter {
  title: string;
  start: number;
  end: number;
  summary: string;
}

export interface VideoDigest {
  tldr: string;
  takeaways: string[];
  chapters: Chapter[];
  highlightIds: string[];
}

export interface VideoInfo {
  /** `${bvid}_${cid}` so every part of a multi-part video is its own document. */
  videoId: string;
  bvid: string;
  aid: number;
  cid: number;
  page: number;
  title: string;
  partTitle?: string;
  owner?: string;
  durationSec: number;
  cover?: string;
}

/** A retrievable unit: a short window of raw captions, enriched with the segment summary. */
export interface Passage {
  id: string;
  videoId: string;
  fromLine: number;
  toLine: number;
  start: number;
  end: number;
  text: string;
  /** Summary/title of the segment the passage falls into, when analysis has run. */
  context?: string;
}

export interface Citation {
  videoId: string;
  start: number;
  end: number;
  label: string;
}

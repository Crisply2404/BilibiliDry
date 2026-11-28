import type { Trace } from '../core/trace/tracer';
import type { OfficialSummary, Segment, VideoDigest, VideoInfo } from '../core/types';
import type { Settings } from './settings';

export type JobStatus = 'queued' | 'fetching' | 'running' | 'done' | 'failed' | 'interrupted' | 'cancelled';

export interface JobState {
  videoId: string;
  status: JobStatus;
  /** Caption lines covered by finished segments, for the progress bar. */
  linesDone: number;
  linesTotal: number;
  message: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export interface VideoRecord extends VideoInfo {
  mid?: number;
  addedAt: number;
  analyzedAt?: number;
  captionCount: number;
  /** Where the transcript came from: Bilibili's AI-summary API or the player's subtitle track. */
  transcriptSource?: 'official' | 'player';
  /** Bilibili's own AI summary; null when the site has none for this video. */
  official?: OfficialSummary | null;
  officialCheckedAt?: number;
  /** Seconds marked as filler, for the library list. */
  waterSec?: number;
  /** `segmentStats().dryShare`, for the library list. */
  dryShare?: number;
  segmentCount?: number;
  tldr?: string;
}

export interface VideoBundle {
  video: VideoRecord | null;
  segments: Segment[];
  digest: VideoDigest | null;
  job: JobState | null;
}

export interface SearchResultItem {
  videoId: string;
  bvid: string;
  page: number;
  videoTitle: string;
  start: number;
  end: number;
  text: string;
  context?: string;
  score: number;
  via: string[];
}

export interface CitationRecord {
  raw: string;
  bvid?: string;
  fromLine: number;
  toLine: number;
  time?: number;
  supported?: boolean;
}

export interface ChatTurnRecord {
  role: 'user' | 'assistant';
  content: string;
  at: number;
  citations?: CitationRecord[];
  tools?: Array<{ name: string; summary: string; args?: Record<string, unknown> }>;
  error?: string;
}

/** Chat threads are kept per video, plus one for the whole library. */
export type ChatKey = string | 'library';

export type Request =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; patch: Partial<Settings> }
  | { type: 'TEST_CONNECTION'; settings?: Partial<Settings> }
  | { type: 'RESOLVE_VIDEO'; bvid: string; page: number }
  | { type: 'GET_VIDEO'; videoId: string }
  | { type: 'ANALYZE'; bvid: string; page: number; fresh?: boolean }
  | { type: 'CANCEL'; videoId: string }
  | { type: 'LIST_LIBRARY'; query?: string }
  | { type: 'DELETE_VIDEO'; videoId: string }
  | { type: 'SEARCH'; query: string; videoId?: string; k?: number }
  | { type: 'EXPORT_MARKDOWN'; videoId: string }
  | { type: 'GET_CAPTIONS'; videoId: string }
  | { type: 'GET_TRACES'; videoId?: string; limit?: number }
  | { type: 'GET_CHAT'; key: ChatKey }
  | { type: 'CLEAR_CHAT'; key: ChatKey }
  | { type: 'OPEN_DASHBOARD'; videoId?: string }
  | { type: 'OPEN_OPTIONS' }
  | { type: 'SEEK'; bvid: string; page: number; time: number }
  | { type: 'GET_STATS' }
  | { type: 'CLEAR_ALL' };

export type Response<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** Messages pushed to subscribed ports ("events" port). */
export type Push =
  | { type: 'JOB'; job: JobState }
  | { type: 'SEGMENTS'; videoId: string; segments: Segment[]; digest?: VideoDigest | null }
  | { type: 'VIDEO'; video: VideoRecord }
  | { type: 'TRACE'; trace: Trace }
  | { type: 'LIBRARY_CHANGED' };

/** Client → background over the "events" port. */
export type PortIn = { type: 'SUBSCRIBE'; videoId: string | '*' };

export type ChatEvent =
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; summary: string }
  | { type: 'delta'; text: string };

/** Client ↔ background over the "chat" port. */
export type ChatIn = { type: 'ASK'; key: ChatKey; question: string; currentTime?: number };
export type ChatOut = { type: 'EVENT'; event: ChatEvent } | { type: 'ERROR'; error: string } | { type: 'SAVED'; turns: ChatTurnRecord[] };

/** Background → content script (tabs.sendMessage). */
export type TabCommand = { type: 'SEEK_TO'; time: number } | { type: 'TOGGLE_PANEL' };

export async function send<T = unknown>(req: Request): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as Response<T> | undefined;
  if (!res) throw new Error('后台没有响应，请在 chrome://extensions 重新加载扩展');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

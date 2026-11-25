import type { AgentEvent } from '../core/agent/agent';
import type { AnalysisPhase } from '../core/analysis/pipeline';
import type { Trace } from '../core/trace/tracer';
import type { Citation, Segment, VideoDigest, VideoInfo } from '../core/types';
import type { Settings } from './settings';

export type JobStatus = 'queued' | 'fetching' | 'running' | 'done' | 'partial' | 'failed' | 'interrupted' | 'cancelled';

export interface JobState {
  videoId: string;
  status: JobStatus;
  phase: AnalysisPhase | 'captions';
  chunksDone: number;
  chunksTotal: number;
  failedChunks: number[];
  message: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export interface VideoRecord extends VideoInfo {
  addedAt: number;
  analyzedAt?: number;
  captionCount: number;
  captionLang?: string;
  /** Seconds marked as filler, for the library list. */
  waterSec?: number;
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

export interface ChatTurnRecord {
  role: 'user' | 'assistant';
  content: string;
  at: number;
  citations?: Array<{ raw: string; bvid?: string; time: number; grounded: boolean }>;
  tools?: Array<{ name: string; summary: string; args?: Record<string, unknown> }>;
  mode?: 'agent' | 'rag';
  error?: string;
}

export type Request =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; patch: Partial<Settings> }
  | { type: 'TEST_CONNECTION'; settings?: Partial<Settings> }
  | { type: 'RESOLVE_VIDEO'; bvid: string; page: number }
  | { type: 'GET_VIDEO'; videoId: string }
  | { type: 'ANALYZE'; bvid: string; page: number; priorityTime?: number; fresh?: boolean }
  | { type: 'CANCEL'; videoId: string }
  | { type: 'LIST_LIBRARY'; query?: string }
  | { type: 'DELETE_VIDEO'; videoId: string }
  | { type: 'SEARCH'; query: string; videoId?: string; k?: number }
  | { type: 'EXPORT_MARKDOWN'; videoId: string }
  | { type: 'GET_CAPTIONS'; videoId: string }
  | { type: 'GET_TRACES'; videoId?: string; limit?: number }
  | { type: 'GET_CHAT'; videoId: string }
  | { type: 'CLEAR_CHAT'; videoId: string }
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
  | { type: 'TRACE'; trace: Trace }
  | { type: 'LIBRARY_CHANGED' };

/** Client → background over the "events" port. */
export type PortIn = { type: 'SUBSCRIBE'; videoId: string | '*' };

/** Client ↔ background over the "chat" port. */
export type ChatIn = { type: 'ASK'; videoId: string; question: string; currentTime?: number };
export type ChatOut = { type: 'EVENT'; event: AgentEvent } | { type: 'ERROR'; error: string } | { type: 'SAVED'; turns: ChatTurnRecord[] };

/** Background → content script (tabs.sendMessage). */
export type TabCommand = { type: 'SEEK_TO'; time: number };

export async function send<T = unknown>(req: Request): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as Response<T> | undefined;
  if (!res) throw new Error('后台没有响应，请在 chrome://extensions 重新加载扩展');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export type { Citation };

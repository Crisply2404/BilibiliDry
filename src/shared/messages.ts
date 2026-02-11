import type { AnalysisResult, Segment } from '../../types';

export interface CaptionLine {
  from: number;
  to: number;
  content: string;
}

export interface VideoMeta {
  videoId?: string;
  bvid: string;
  aid: number;
  cid: number;
  page?: number;
  partTitle?: string;
  title: string;
  durationSec: number;
}

export type BackgroundRequest =
  | { type: 'PING' }
  | { type: 'GET_CONFIG' }
  | { type: 'SET_CONFIG'; config: Record<string, unknown> }
  | { type: 'TEST_LLM_CONNECTION' }
  | { type: 'CLEAR_LOCAL_DATA' }
  | { type: 'GET_VIDEO_CONTEXT'; bvid: string }
  | { type: 'GET_VIDEO_STATE'; videoId: string }
  | { type: 'GET_ANALYSIS_RUNS'; videoId: string }
  | { type: 'START_INCREMENTAL_ANALYSIS'; videoId: string; bvid: string; currentTimeSec?: number; video?: VideoMeta; captions?: CaptionLine[] }
  | { type: 'CANCEL_ANALYSIS'; videoId: string }
  | { type: 'EXPORT_MARKDOWN'; videoId: string }
  | { type: 'OPEN_DASHBOARD'; videoId: string }
  | { type: 'SEARCH_IN_VIDEO'; videoId: string; query: string; topK: number }
  // Player sync (content-script -> background -> dashboard)
  | { type: 'PLAYER_TIME_UPDATE'; videoId: string; bvid: string; currentTimeSec: number; durationSec?: number; playing?: boolean; updatedAtMs?: number }
  // Dashboard -> background -> content-script
  | { type: 'SEEK_VIDEO'; videoId: string; timeSec: number };

export type BackgroundResponse =
  | { ok: true; data?: any }
  | { ok: false; error: string };

export type BackgroundPush =
  | { type: 'ANALYSIS_UPDATE'; videoId: string; progress: number; segments?: Segment[] }
  | { type: 'ANALYSIS_ERROR'; videoId: string; error: string }
  | { type: 'ANALYSIS_DONE'; videoId: string }
  | { type: 'REFLECTION_UPDATE'; videoId: string; progress: number; completed: number; total: number; segments?: Segment[] }
  | { type: 'SEEK_TO'; videoId: string; timeSec: number };

export interface VideoContext {
  videoId: string;
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  durationSec: number;
  hasCC: boolean;
}

export interface VideoState {
  videoId: string;
  title: string;
  durationSec: number;
  analysisResult?: AnalysisResult;
  segments: Segment[];
}

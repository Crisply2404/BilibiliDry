import type { AnalysisResult, Segment } from '../../types';

export interface CaptionLine {
  from: number;
  to: number;
  content: string;
}

export interface VideoMeta {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  durationSec: number;
}

export type BackgroundRequest =
  | { type: 'PING' }
  | { type: 'GET_CONFIG' }
  | { type: 'SET_CONFIG'; config: Record<string, unknown> }
  | { type: 'CLEAR_LOCAL_DATA' }
  | { type: 'GET_VIDEO_CONTEXT'; bvid: string }
  | { type: 'GET_VIDEO_STATE'; videoId: string }
  | { type: 'START_INCREMENTAL_ANALYSIS'; bvid: string; currentTimeSec?: number; video?: VideoMeta; captions?: CaptionLine[] }
  | { type: 'CANCEL_ANALYSIS'; videoId: string }
  | { type: 'EXPORT_MARKDOWN'; videoId: string }
  | { type: 'SEARCH_QUERY'; query: string; topK: number };

export type BackgroundResponse =
  | { ok: true; data?: any }
  | { ok: false; error: string };

export type BackgroundPush =
  | { type: 'ANALYSIS_UPDATE'; videoId: string; progress: number; segments?: Segment[] }
  | { type: 'ANALYSIS_ERROR'; videoId: string; error: string }
  | { type: 'ANALYSIS_DONE'; videoId: string };

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

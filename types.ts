export enum ContentType {
  DRY = 'DRY',   // High value content
  WATER = 'WATER' // Fluff/Filler
}

export enum LogicType {
  BACKGROUND = 'BACKGROUND',
  PROBLEM = 'PROBLEM',
  SOLUTION = 'SOLUTION',
  CASE = 'CASE'
}

export type WaterReasonType = 'SMALLTALK' | 'REPEAT' | 'OFFTOPIC' | 'AD' | 'NO_NEW_INFO';

export interface Segment {
  id: string;
  startTime: number; // in seconds
  endTime: number;
  type: ContentType;
  confidence: number; // 0 to 1
  summary: string;
  waterReasonType?: WaterReasonType;
  waterReasonText?: string;
  verification?: {
    verdict: 'pass' | 'weak' | 'fail';
    alignmentScore: number; // 0..1
    reason: string;
    evidence: string[];
    checkedAt: string; // ISO
    modelTag: string;
    repairedFrom?: { startTime: number; endTime: number };
    repairedAt?: string; // ISO
  };
}

export type LlmStage = 'cheap' | 'strong';

export interface LlmCallMetric {
  stage: LlmStage;
  kind: string; // e.g. chunk_analyze / dry_refine / verify / repair
  modelTag: string;
  startedAt: string; // ISO
  latencyMs: number;
  requestChars: number;
  responseChars: number;
  note?: string;
}

export interface AnalysisRun {
  runId: string;
  videoId: string;
  startedAt: string; // ISO
  finishedAt?: string; // ISO
  cascadeEnabled: boolean;
  provider: 'openai' | 'gemini';
  cheapModel?: string;
  strongModel?: string;
  strongTopK?: number;
  quality?: {
    total: number;
    pass: number;
    weak: number;
    fail: number;
    avgScore?: number; // 0..1
    repaired: number;
  };
  metrics: LlmCallMetric[];
}

export interface LogicBlock {
  id: string;
  type: LogicType;
  title: string;
  description: string;
  relatedSegments: string[]; // IDs of segments
  icon?: string;
}

export interface AnalysisResult {
  videoId: string;
  title: string;
  totalDuration: number;
  segments: Segment[];
  logicBlocks: LogicBlock[];
  overallSummary: string;
  processedAt: string;
}

export interface AppState {
  viewMode: 'PLUGIN' | 'DASHBOARD';
  isAnalyzing: boolean;
  currentVideoId: string | null;
  analysisResult: AnalysisResult | null;
  currentTime: number; // For simulating video player sync
}

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

export interface Segment {
  id: string;
  startTime: number; // in seconds
  endTime: number;
  type: ContentType;
  confidence: number; // 0 to 1
  summary: string;
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

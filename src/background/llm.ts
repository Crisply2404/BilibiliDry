import type { ContentType } from '../../types';
import type { WaterReasonType } from '../../types';
import type { ExtensionConfig } from '../shared/storage';
import { analyzeCaptionChunkWithGemini, embedTextWithGemini, repairSegmentsWithGemini, rerankCandidatesWithGemini, verifySegmentsWithGemini } from './gemini';
import { analyzeCaptionChunkWithOpenAI, embedTextWithOpenAI, repairSegmentsWithOpenAI, rerankCandidatesWithOpenAI, verifySegmentsWithOpenAI } from './openai';

export type LlmSource = 'gemini' | 'openai';

export interface LlmSegment {
  startTime: number;
  endTime: number;
  type: ContentType;
  confidence: number;
  summary: string;
  waterReasonType?: WaterReasonType;
  waterReasonText?: string;
}

export interface LlmChunkResult {
  overallSummary?: string;
  segments: LlmSegment[];
}

export interface LlmRerankItem {
  startTime: number;
  endTime: number;
  score: number;
  snippet: string;
  reason?: string;
}

export interface LlmReflectionItem {
  id: string;
  verdict: 'pass' | 'weak' | 'fail';
  alignmentScore: number;
  reason: string;
  evidenceIndexes: number[]; // 1-based indices into provided evidence lines
}

export interface LlmRepairItem extends LlmReflectionItem {
  suggestedStartTime: number; // absolute seconds
  suggestedEndTime: number; // absolute seconds
}

export function getActiveLlm(config: ExtensionConfig): {
  source: LlmSource;
  embeddingModelTag: string;
  modelTag: string;
  analyzeChunk: (args: {
    bvid: string;
    title: string;
    chunkStartSec: number;
    chunkEndSec: number;
    transcript: string;
    signal?: AbortSignal;
  }) => Promise<LlmChunkResult>;
  embedText: (args: { text: string; signal?: AbortSignal }) => Promise<number[]>;
  verifySegments: (args: {
    title: string;
    segments: Array<{ id: string; startTime: number; endTime: number; summary: string; evidence: string[] }>;
    signal?: AbortSignal;
  }) => Promise<{ items: LlmReflectionItem[] }>;
  repairSegments: (args: {
    title: string;
    segments: Array<{
      id: string;
      startTime: number;
      endTime: number;
      summary: string;
      evidence: string[];
      windowStartTime: number;
      windowEndTime: number;
    }>;
    signal?: AbortSignal;
  }) => Promise<{ items: LlmRepairItem[] }>;
  rerankCandidates: (args: {
    videoId: string;
    title: string;
    query: string;
    topK: number;
    candidates: Array<{ startTime: number; endTime: number; summary: string; rawText?: string }>;
    signal?: AbortSignal;
  }) => Promise<{ items: LlmRerankItem[] }>;
} {
  if (config.llmProvider === 'openai') {
    const baseUrl = config.openaiBaseUrl?.trim();
    const apiKey = config.openaiApiKey?.trim();
    const model = config.openaiModel?.trim();
    const embeddingModel = config.openaiEmbeddingModel?.trim() || 'text-embedding-3-small';
    if (!baseUrl) throw new Error('未配置 LLM Base URL（请在设置页填写）');
    if (!apiKey) throw new Error('未配置 API Key（请在设置页填写）');
    if (!model) throw new Error('未配置模型 ID（请在设置页填写）');
    return {
      source: 'openai',
      embeddingModelTag: `openai:${embeddingModel}`,
      modelTag: `openai:${model}`,
      analyzeChunk: async (args) =>
        analyzeCaptionChunkWithOpenAI({
          baseUrl,
          apiKey,
          model,
          bvid: args.bvid,
          title: args.title,
          chunkStartSec: args.chunkStartSec,
          chunkEndSec: args.chunkEndSec,
          transcript: args.transcript,
          signal: args.signal
        }),
      embedText: async (args) => embedTextWithOpenAI({ baseUrl, apiKey, model: embeddingModel, text: args.text, signal: args.signal }),
      verifySegments: async (args) =>
        verifySegmentsWithOpenAI({
          baseUrl,
          apiKey,
          model,
          title: args.title,
          segments: args.segments,
          signal: args.signal
        }),
      repairSegments: async (args) =>
        repairSegmentsWithOpenAI({
          baseUrl,
          apiKey,
          model,
          title: args.title,
          segments: args.segments,
          signal: args.signal
        }),
      rerankCandidates: async (args) =>
        rerankCandidatesWithOpenAI({
          baseUrl,
          apiKey,
          model,
          title: args.title,
          query: args.query,
          topK: args.topK,
          candidates: args.candidates.map((c) => ({ startTime: c.startTime, endTime: c.endTime, summary: c.summary })),
          signal: args.signal
        })
    };
  }

  const apiKey = config.geminiApiKey?.trim();
  if (!apiKey) throw new Error('未配置 API Key（请在设置页填写）');
  const model = 'gemini-3-flash-preview';
  return {
    source: 'gemini',
    embeddingModelTag: 'gemini:text-embedding-004',
    modelTag: `gemini:${model}`,
    analyzeChunk: async (args) =>
      analyzeCaptionChunkWithGemini({
        apiKey,
        bvid: args.bvid,
        title: args.title,
        chunkStartSec: args.chunkStartSec,
        chunkEndSec: args.chunkEndSec,
        transcript: args.transcript,
        model
      }),
    embedText: async (args) => embedTextWithGemini({ apiKey, text: args.text }),
    verifySegments: async (args) =>
      verifySegmentsWithGemini({
        apiKey,
        title: args.title,
        segments: args.segments,
        model
      }),
    repairSegments: async (args) =>
      repairSegmentsWithGemini({
        apiKey,
        title: args.title,
        segments: args.segments,
        model
      }),
    rerankCandidates: async (args) =>
      rerankCandidatesWithGemini({
        apiKey,
        title: args.title,
        query: args.query,
        topK: args.topK,
        candidates: args.candidates.map((c) => ({ startTime: c.startTime, endTime: c.endTime, summary: c.summary })),
        model
      })
  };
}

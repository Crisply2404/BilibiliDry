import type { ContentType } from '../../types';
import type { ExtensionConfig } from '../shared/storage';
import { analyzeCaptionChunkWithGemini, embedTextWithGemini, rerankCandidatesWithGemini } from './gemini';
import { analyzeCaptionChunkWithOpenAI, embedTextWithOpenAI, rerankCandidatesWithOpenAI } from './openai';

export type LlmSource = 'gemini' | 'openai';

export interface LlmSegment {
  startTime: number;
  endTime: number;
  type: ContentType;
  confidence: number;
  summary: string;
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

export function getActiveLlm(config: ExtensionConfig): {
  source: LlmSource;
  embeddingModelTag: string;
  analyzeChunk: (args: {
    bvid: string;
    title: string;
    chunkStartSec: number;
    chunkEndSec: number;
    transcript: string;
    signal?: AbortSignal;
  }) => Promise<LlmChunkResult>;
  embedText: (args: { text: string; signal?: AbortSignal }) => Promise<number[]>;
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
      embedText: async (args) => embedTextWithOpenAI({ baseUrl, apiKey, model: embeddingModel, text: args.text, signal: args.signal })
      ,
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
  return {
    source: 'gemini',
    embeddingModelTag: 'gemini:text-embedding-004',
    analyzeChunk: async (args) =>
      analyzeCaptionChunkWithGemini({
        apiKey,
        bvid: args.bvid,
        title: args.title,
        chunkStartSec: args.chunkStartSec,
        chunkEndSec: args.chunkEndSec,
        transcript: args.transcript
      }),
    embedText: async (args) => embedTextWithGemini({ apiKey, text: args.text })
    ,
    rerankCandidates: async (args) =>
      rerankCandidatesWithGemini({
        apiKey,
        title: args.title,
        query: args.query,
        topK: args.topK,
        candidates: args.candidates.map((c) => ({ startTime: c.startTime, endTime: c.endTime, summary: c.summary }))
      })
  };
}

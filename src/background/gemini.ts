import { GoogleGenAI, Type } from '@google/genai';
import type { ContentType } from '../../types';

export interface GeminiSegment {
  startTime: number;
  endTime: number;
  type: ContentType;
  confidence: number;
  summary: string;
}

export interface GeminiChunkResult {
  overallSummary?: string;
  segments: GeminiSegment[];
}

export interface GeminiRerankItem {
  startTime: number;
  endTime: number;
  score: number;
  snippet: string;
  reason?: string;
}

export async function analyzeCaptionChunkWithGemini(params: {
  apiKey: string;
  bvid: string;
  title: string;
  chunkStartSec: number;
  chunkEndSec: number;
  transcript: string;
  model?: string;
}): Promise<GeminiChunkResult> {
  const ai = new GoogleGenAI({ apiKey: params.apiKey });

  const systemInstruction = `
你是一个 B 站长视频“脱水”Agent。
目标：对给定的【字幕分块】做“注水/干货”时间分段，并给出每段的中文摘要。
要求：
1) startTime/endTime 必须是【视频开头起的绝对秒数】（不是分块内相对时间）。
2) 输出 segments 需要尽量覆盖 chunkStartSec~chunkEndSec。
3) type 仅允许 DRY/WATER；confidence 为 0~1。
4) summary 必须中文，尽量短（<= 20 字）。
5) 优先产出“可跳过”信息：宁可粗一点，也要保证 start/end 合理、不重叠、不越界。
`;

  const prompt = `
视频: ${params.title} (${params.bvid})
字幕分块范围(绝对秒): ${params.chunkStartSec} - ${params.chunkEndSec}

字幕文本(已截断):
${params.transcript.slice(0, 12000)}
`;

  const response = await ai.models.generateContent({
    model: params.model ?? 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          overallSummary: { type: Type.STRING },
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startTime: { type: Type.NUMBER },
                endTime: { type: Type.NUMBER },
                type: { type: Type.STRING, enum: ['DRY', 'WATER'] },
                confidence: { type: Type.NUMBER },
                summary: { type: Type.STRING }
              },
              required: ['startTime', 'endTime', 'type', 'confidence', 'summary']
            }
          }
        },
        required: ['segments']
      }
    }
  });

  const data = JSON.parse(response.text || '{}');
  const segments = Array.isArray(data.segments) ? data.segments : [];

  return {
    overallSummary: typeof data.overallSummary === 'string' ? data.overallSummary : undefined,
    segments: segments
      .map((s: any) => ({
        startTime: Number(s.startTime),
        endTime: Number(s.endTime),
        type: String(s.type) as ContentType,
        confidence: Math.max(0, Math.min(1, Number(s.confidence))),
        summary: String(s.summary ?? '').trim()
      }))
      .filter((s: GeminiSegment) => Number.isFinite(s.startTime) && Number.isFinite(s.endTime) && s.endTime > s.startTime && s.summary.length > 0)
      .sort((a: GeminiSegment, b: GeminiSegment) => a.startTime - b.startTime)
  };
}

export async function embedTextWithGemini(params: {
  apiKey: string;
  text: string;
  model?: string;
  outputDimensionality?: number;
}): Promise<number[]> {
  const ai = new GoogleGenAI({ apiKey: params.apiKey });
  const response = await ai.models.embedContent({
    model: params.model ?? 'text-embedding-004',
    contents: [params.text],
    config: params.outputDimensionality ? { outputDimensionality: params.outputDimensionality } : undefined
  } as any);

  const embedding = (response as any)?.embeddings?.[0]?.values;
  if (!Array.isArray(embedding)) throw new Error('Embedding 响应格式异常');
  return embedding.map((v: any) => Number(v));
}

export async function rerankCandidatesWithGemini(params: {
  apiKey: string;
  title: string;
  query: string;
  topK: number;
  candidates: Array<{ startTime: number; endTime: number; summary: string }>;
  model?: string;
}): Promise<{ items: GeminiRerankItem[] }> {
  const ai = new GoogleGenAI({ apiKey: params.apiKey });

  const systemInstruction = `
你是一个“视频内搜索”助手。
给定用户 query 与若干候选片段（带 startTime/endTime/summary），请选出最相关的 TopK。
要求：
1) items 按相关度从高到低排序。
2) score 为 0~1，越大越相关。
3) snippet 用中文，尽量短（可直接复用 summary 或做轻微改写）。
`;

  const candidatesText = params.candidates
    .slice(0, 20)
    .map((c, i) => `${i + 1}. [${c.startTime}-${c.endTime}] ${String(c.summary ?? '').slice(0, 80)}`)
    .join('\n');

  const prompt = `
视频: ${params.title}
query: ${params.query}
topK: ${Math.max(1, Math.min(10, params.topK))}

候选片段:
${candidatesText}
`;

  const response = await ai.models.generateContent({
    model: params.model ?? 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startTime: { type: Type.NUMBER },
                endTime: { type: Type.NUMBER },
                score: { type: Type.NUMBER },
                snippet: { type: Type.STRING },
                reason: { type: Type.STRING }
              },
              required: ['startTime', 'endTime', 'score', 'snippet']
            }
          }
        },
        required: ['items']
      }
    }
  });

  const data = JSON.parse(response.text || '{}');
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    items: items
      .map((x: any) => ({
        startTime: Number(x.startTime),
        endTime: Number(x.endTime),
        score: Math.max(0, Math.min(1, Number(x.score))),
        snippet: String(x.snippet ?? '').trim(),
        reason: typeof x.reason === 'string' ? x.reason.trim() : undefined
      }))
      .filter(
        (x: GeminiRerankItem) =>
          Number.isFinite(x.startTime) && Number.isFinite(x.endTime) && x.endTime > x.startTime && x.snippet.length > 0
      )
      .sort((a: GeminiRerankItem, b: GeminiRerankItem) => b.score - a.score)
  };
}

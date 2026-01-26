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


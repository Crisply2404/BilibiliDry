import type { ContentType } from '../../types';

export interface OpenAISegment {
  startTime: number;
  endTime: number;
  type: ContentType;
  confidence: number;
  summary: string;
}

export interface OpenAIChunkResult {
  overallSummary?: string;
  segments: OpenAISegment[];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

async function postJson<T>(url: string, apiKey: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI API 失败: ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

function tryParseJsonObject(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    // try to extract json object/array from mixed output
    const firstObj = text.indexOf('{');
    const lastObj = text.lastIndexOf('}');
    if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
      try {
        return JSON.parse(text.slice(firstObj, lastObj + 1));
      } catch {
        // ignore
      }
    }
    const firstArr = text.indexOf('[');
    const lastArr = text.lastIndexOf(']');
    if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
      try {
        return JSON.parse(text.slice(firstArr, lastArr + 1));
      } catch {
        // ignore
      }
    }
    return null;
  }
}

export async function analyzeCaptionChunkWithOpenAI(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  bvid: string;
  title: string;
  chunkStartSec: number;
  chunkEndSec: number;
  transcript: string;
  signal?: AbortSignal;
}): Promise<OpenAIChunkResult> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const url = `${baseUrl}/chat/completions`;

  const system = `
你是一个 B 站长视频“脱水”Agent。
目标：对给定的【字幕分块】做“注水/干货”时间分段，并给出每段的中文摘要。
要求：
1) startTime/endTime 必须是【视频开头起的绝对秒数】（不是分块内相对时间）。
2) 输出 segments 需要尽量覆盖 chunkStartSec~chunkEndSec。
3) type 仅允许 DRY/WATER；confidence 为 0~1。
4) summary 必须中文，尽量短（<= 20 字）。
5) 输出必须是严格 JSON（不要 Markdown）。
`;

  const user = `
视频: ${params.title} (${params.bvid})
字幕分块范围(绝对秒): ${params.chunkStartSec} - ${params.chunkEndSec}

字幕文本(已截断):
${params.transcript.slice(0, 12000)}

请输出 JSON：
{
  "overallSummary": "可选",
  "segments": [
    {"startTime": 0, "endTime": 10, "type":"WATER", "confidence": 0.2, "summary":"..."}
  ]
}
`;

  const bodyWithFormat = {
    model: params.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system.trim() },
      { role: 'user', content: user.trim() }
    ],
    response_format: { type: 'json_object' as const }
  };

  type ChatResp = { choices?: Array<{ message?: { content?: string } }> };

  let resp: ChatResp;
  try {
    resp = await postJson<ChatResp>(url, params.apiKey, bodyWithFormat, params.signal);
  } catch (err: any) {
    // Some OpenAI-compatible backends don't support response_format; retry without it.
    const bodyNoFormat = { ...bodyWithFormat };
    delete (bodyNoFormat as any).response_format;
    resp = await postJson<ChatResp>(url, params.apiKey, bodyNoFormat, params.signal);
  }

  const content = resp?.choices?.[0]?.message?.content ?? '';
  const data = tryParseJsonObject(content) ?? {};
  const segments = Array.isArray((data as any).segments) ? (data as any).segments : [];

  return {
    overallSummary: typeof (data as any).overallSummary === 'string' ? (data as any).overallSummary : undefined,
    segments: segments
      .map((s: any) => ({
        startTime: Number(s.startTime),
        endTime: Number(s.endTime),
        type: String(s.type) as ContentType,
        confidence: Math.max(0, Math.min(1, Number(s.confidence))),
        summary: String(s.summary ?? '').trim()
      }))
      .filter((s: OpenAISegment) => Number.isFinite(s.startTime) && Number.isFinite(s.endTime) && s.endTime > s.startTime && s.summary.length > 0)
      .sort((a: OpenAISegment, b: OpenAISegment) => a.startTime - b.startTime)
  };
}

export async function embedTextWithOpenAI(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  text: string;
  signal?: AbortSignal;
}): Promise<number[]> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const url = `${baseUrl}/embeddings`;
  type EmbedResp = { data?: Array<{ embedding?: number[] }> };
  const resp = await postJson<EmbedResp>(
    url,
    params.apiKey,
    {
      model: params.model,
      input: params.text
    },
    params.signal
  );
  const embedding = resp?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error('Embedding 响应格式异常');
  return embedding.map((v) => Number(v));
}


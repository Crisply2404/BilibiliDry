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

export interface OpenAIRerankItem {
  startTime: number;
  endTime: number;
  score: number;
  snippet: string;
  reason?: string;
}

export interface OpenAIReflectionItem {
  id: string;
  verdict: 'pass' | 'weak' | 'fail';
  alignmentScore: number; // 0..1
  reason: string;
  evidenceIndexes: number[]; // 1-based indices into provided evidence lines
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

export async function rerankCandidatesWithOpenAI(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  title: string;
  query: string;
  topK: number;
  candidates: Array<{ startTime: number; endTime: number; summary: string }>;
  signal?: AbortSignal;
}): Promise<{ items: OpenAIRerankItem[] }> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const url = `${baseUrl}/chat/completions`;

  const system = `
你是一个“视频内搜索”助手。
给定用户 query 与若干候选片段（带 startTime/endTime/summary），请选出最相关的 TopK。
要求：
1) 输出必须是严格 JSON（不要 Markdown）。
2) items 按相关度从高到低排序。
3) score 为 0~1，越大越相关。
4) snippet 用中文，尽量短（可直接复用 summary 或做轻微改写）。
`;

  const candidatesText = params.candidates
    .slice(0, 20)
    .map((c, i) => `${i + 1}. [${c.startTime}-${c.endTime}] ${String(c.summary ?? '').slice(0, 80)}`)
    .join('\n');

  const user = `
视频: ${params.title}
query: ${params.query}
topK: ${Math.max(1, Math.min(10, params.topK))}

候选片段:
${candidatesText}

请输出 JSON：
{
  "items": [
    {"startTime": 0, "endTime": 10, "score": 0.8, "snippet": "…", "reason": "可选"}
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
  } catch {
    const bodyNoFormat = { ...bodyWithFormat };
    delete (bodyNoFormat as any).response_format;
    resp = await postJson<ChatResp>(url, params.apiKey, bodyNoFormat, params.signal);
  }

  const content = resp?.choices?.[0]?.message?.content ?? '';
  const data = tryParseJsonObject(content) ?? {};
  const items = Array.isArray((data as any).items) ? (data as any).items : [];

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
        (x: OpenAIRerankItem) =>
          Number.isFinite(x.startTime) && Number.isFinite(x.endTime) && x.endTime > x.startTime && x.snippet.length > 0
      )
      .sort((a: OpenAIRerankItem, b: OpenAIRerankItem) => b.score - a.score)
  };
}

export async function reflectSegmentsWithOpenAI(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  title: string;
  segments: Array<{ id: string; startTime: number; endTime: number; summary: string; evidence: string[] }>;
  signal?: AbortSignal;
}): Promise<{ items: OpenAIReflectionItem[] }> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const url = `${baseUrl}/chat/completions`;

  const system = `
你是一个严格的“字幕证据对齐校验”审计器（Reflection Gate）。
目标：判断每个片段的 summary 是否被对应时间窗的字幕证据支持，并给出可解释的结论。
要求：
1) 输出必须是严格 JSON（不要 Markdown）。
2) verdict 仅允许 pass/weak/fail：
   - pass: 字幕明确支持 summary
   - weak: 字幕大致相关但表述不充分/可能过度推断
   - fail: 字幕不支持或明显不对齐
3) alignmentScore 为 0~1（越大越对齐）。
4) reason 必须中文，<= 30 字，说明判定原因。
5) evidenceIndexes 必须是【输入字幕证据】的行号（1-based），最多 1~3 个；不得输出证据文本，不得翻译/改写。
`;

  const segText = params.segments
    .slice(0, 8)
    .map((s, i) => {
      const evidence = (s.evidence ?? [])
        .slice(0, 12)
        .map((line, idx) => `${idx + 1}) ${line}`)
        .join('\n');
      return `${i + 1}. id=${s.id}\nstart=${s.startTime}\nend=${s.endTime}\nsummary=${s.summary}\n字幕证据(编号):\n${evidence}`;
    })
    .join('\n\n');

  const user = `
视频: ${params.title}

请对以下片段逐个校验，并输出 JSON：
{
  "items": [
    {"id":"...", "verdict":"pass", "alignmentScore": 0.9, "reason":"...", "evidenceIndexes":[1,3]}
  ]
}

片段列表：
${segText}
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
  } catch {
    const bodyNoFormat = { ...bodyWithFormat };
    delete (bodyNoFormat as any).response_format;
    resp = await postJson<ChatResp>(url, params.apiKey, bodyNoFormat, params.signal);
  }

  const content = resp?.choices?.[0]?.message?.content ?? '';
  const data = tryParseJsonObject(content) ?? {};
  const items = Array.isArray((data as any).items) ? (data as any).items : [];

  return {
    items: items
      .map((x: any) => ({
        id: String(x.id ?? '').trim(),
        verdict: (String(x.verdict ?? '').trim() as any) || 'weak',
        alignmentScore: Math.max(0, Math.min(1, Number(x.alignmentScore))),
        reason: String(x.reason ?? '').trim(),
        evidenceIndexes: Array.isArray(x.evidenceIndexes)
          ? x.evidenceIndexes.map((n: any) => Math.floor(Number(n))).filter((n: number) => Number.isFinite(n) && n > 0)
          : []
      }))
      .filter(
        (x: OpenAIReflectionItem) => x.id.length > 0 && x.reason.length > 0 && Number.isFinite(x.alignmentScore)
      )
  };
}

export async function testConnectionWithOpenAI(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  signal?: AbortSignal;
}): Promise<void> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const url = `${baseUrl}/chat/completions`;
  await postJson<any>(
    url,
    params.apiKey,
    {
      model: params.model,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are a connection test.' },
        { role: 'user', content: 'Reply with JSON: {"ok": true}' }
      ],
      response_format: { type: 'json_object' as const },
      max_tokens: 16
    },
    params.signal
  );
}

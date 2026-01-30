import { ContentType } from '../../types';
import { getVideo, listSegments, type SegmentRecord } from './db';

export interface InVideoSearchItem {
  startTime: number;
  endTime: number;
  score: number;
  snippet: string;
  reason?: string;
}

function normalize(text: string): string {
  return text.toLowerCase();
}

function isMostlyCjk(text: string): boolean {
  const s = text.replace(/\s+/g, '');
  if (s.length < 2) return false;
  let cjk = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) cjk += 1;
  }
  return cjk / s.length >= 0.6;
}

function cjkBigrams(text: string): string[] {
  const s = normalize(text).replace(/\s+/g, '');
  const grams: string[] = [];
  for (let i = 0; i < s.length - 1; i += 1) grams.push(s.slice(i, i + 2));
  return grams;
}

function keywordScore(query: string, text: string): number {
  if (!text) return 0;
  const q = normalize(query).trim();
  const t = normalize(text);
  if (!q) return 0;
  if (t.includes(q)) return 1;

  // Basic token overlap (best for English / spaced queries).
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const hit = tokens.filter((tok) => t.includes(tok)).length;
    return hit / tokens.length;
  }

  // Chinese/Japanese text often has no spaces; use bigram overlap for a tiny fuzzy score.
  if (isMostlyCjk(q) && q.length >= 2) {
    const grams = cjkBigrams(q);
    if (grams.length === 0) return 0;
    const hit = grams.filter((g) => t.includes(g)).length;
    return Math.min(0.99, hit / grams.length);
  }

  return 0;
}

function pickSearchSegments(segments: SegmentRecord[]): SegmentRecord[] {
  const dry = segments.filter((s) => s.type === ContentType.DRY);
  if (dry.length >= 3) return dry;
  return segments;
}

export async function searchInVideoKeyword(params: {
  videoId: string;
  query: string;
  topK: number;
}): Promise<InVideoSearchItem[]> {
  const [video, segments] = await Promise.all([getVideo(params.videoId), listSegments(params.videoId)]);
  const searchPool = pickSearchSegments(segments);

  const scored = searchPool
    .map((s) => {
      const score = Math.max(keywordScore(params.query, s.summary), keywordScore(params.query, s.rawText ?? ''));
      return { seg: s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(50, params.topK)));

  // Note: video is currently unused, but kept for future (e.g. show title) and to validate video existence.
  void video;

  return scored.map(({ seg, score }) => ({
    startTime: seg.startTime,
    endTime: seg.endTime,
    score,
    snippet: seg.summary
  }));
}

export async function searchInVideoSemantic(params: {
  videoId: string;
  query: string;
  topK: number;
  rerank: (args: {
    videoId: string;
    title: string;
    query: string;
    topK: number;
    candidates: Array<{ startTime: number; endTime: number; summary: string; rawText?: string }>;
  }) => Promise<{ items: InVideoSearchItem[] }>;
}): Promise<{ items: InVideoSearchItem[]; mode: 'semantic' | 'keyword'; note?: string }> {
  const [video, segments] = await Promise.all([getVideo(params.videoId), listSegments(params.videoId)]);
  const title = video?.title ?? params.videoId;
  const searchPool = pickSearchSegments(segments);

  // Candidate recall: small topN based on keyword overlap, then let LLM rerank semantically.
  const recallTopN = 12;
  const recall = searchPool
    .map((s) => {
      const score = Math.max(keywordScore(params.query, s.summary), keywordScore(params.query, s.rawText ?? ''));
      return { seg: s, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(recallTopN, params.topK));

  const candidates = recall
    .filter((x) => x.seg.summary.trim().length > 0)
    .slice(0, recallTopN)
    .map(({ seg }) => ({
      startTime: seg.startTime,
      endTime: seg.endTime,
      summary: seg.summary,
      rawText: seg.rawText
    }));

  if (candidates.length === 0) {
    return { items: [], mode: 'keyword', note: '本视频暂无可搜索片段（请先分析生成段落）' };
  }

  try {
    const reranked = await params.rerank({
      videoId: params.videoId,
      title,
      query: params.query,
      topK: params.topK,
      candidates
    });
    const items = Array.isArray(reranked?.items) ? reranked.items : [];
    const normalized = items
      .filter((i) => Number.isFinite(i.startTime) && Number.isFinite(i.endTime) && i.endTime > i.startTime && i.snippet?.trim?.())
      .slice(0, Math.max(1, Math.min(50, params.topK)));
    if (normalized.length > 0) return { items: normalized, mode: 'semantic' };
  } catch (err: any) {
    // fall through to keyword
    const msg = String(err?.message ?? err);
    const keyword = await searchInVideoKeyword({ videoId: params.videoId, query: params.query, topK: params.topK });
    return { items: keyword, mode: 'keyword', note: msg || '语义搜索失败，已回退关键词搜索' };
  }

  const keyword = await searchInVideoKeyword({ videoId: params.videoId, query: params.query, topK: params.topK });
  return { items: keyword, mode: 'keyword', note: '语义搜索未命中，已回退关键词搜索' };
}


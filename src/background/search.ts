import { ContentType } from '../../types';
import { listAllEmbeddings, listAllSegments, listVideos, type EmbeddingRecord, type SegmentRecord } from './db';

export interface SearchResultItem {
  videoId: string;
  title: string;
  startTime: number;
  score: number;
  snippet: string;
}

function normalize(text: string): string {
  return text.toLowerCase();
}

function keywordScore(query: string, text: string): number {
  if (!text) return 0;
  const q = normalize(query).trim();
  const t = normalize(text);
  if (!q) return 0;
  if (t.includes(q)) return 1;
  // very small fuzzy: count shared tokens
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const hit = tokens.filter((tok) => t.includes(tok)).length;
  return hit / tokens.length;
}

export async function searchKeyword(params: { query: string; topK: number }): Promise<SearchResultItem[]> {
  const [segments, videos] = await Promise.all([listAllSegments(), listVideos()]);
  const titleMap = new Map(videos.map((v) => [v.videoId, v.title] as const));

  const scored = segments
    .filter((s) => s.type === ContentType.DRY)
    .map((s) => {
      const score = Math.max(keywordScore(params.query, s.summary), keywordScore(params.query, s.rawText ?? ''));
      return { seg: s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(50, params.topK)));

  return scored.map(({ seg, score }) => ({
    videoId: seg.videoId,
    title: titleMap.get(seg.videoId) ?? seg.videoId,
    startTime: seg.startTime,
    score,
    snippet: seg.summary
  }));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i += 1) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (!denom) return 0;
  return dot / denom;
}

export async function searchSemantic(params: {
  embeddingModelTag: string;
  embed: (text: string) => Promise<number[]>;
  query: string;
  topK: number;
}): Promise<SearchResultItem[]> {
  const queryVec = await params.embed(params.query);
  const [embeddings, segments, videos] = await Promise.all([listAllEmbeddings(), listAllSegments(), listVideos()]);
  const segMap = new Map<string, SegmentRecord>(segments.map((s) => [s.id, s]));
  const titleMap = new Map(videos.map((v) => [v.videoId, v.title] as const));

  const scored = embeddings
    .map((e: EmbeddingRecord) => {
      if (e.model !== params.embeddingModelTag) return null;
      const seg = segMap.get(e.id);
      if (!seg || seg.type !== ContentType.DRY) return null;
      const score = cosineSimilarity(queryVec, e.vector);
      return { seg, score };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(50, params.topK)));

  return (scored as any[]).map(({ seg, score }) => ({
    videoId: seg.videoId,
    title: titleMap.get(seg.videoId) ?? seg.videoId,
    startTime: seg.startTime,
    score,
    snippet: seg.summary
  }));
}

export function getNextDryStart(params: { segments: SegmentRecord[]; currentTime: number }): number | null {
  const sorted = [...params.segments].sort((a, b) => a.startTime - b.startTime);
  const idx = sorted.findIndex((s) => params.currentTime >= s.startTime && params.currentTime < s.endTime);
  if (idx === -1) {
    const next = sorted.find((s) => s.type === ContentType.DRY && s.startTime > params.currentTime);
    return next ? next.startTime : null;
  }
  const current = sorted[idx];
  if (current.type === ContentType.DRY) {
    const next = sorted.slice(idx + 1).find((s) => s.type === ContentType.DRY);
    return next ? next.startTime : null;
  }
  const next = sorted.slice(idx + 1).find((s) => s.type === ContentType.DRY);
  return next ? next.startTime : null;
}

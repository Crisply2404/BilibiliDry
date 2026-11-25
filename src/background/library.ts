import { attachContext, embedMissing, HybridRetriever, type SearchHit } from '../core/retrieval/hybrid';
import { buildPassages } from '../core/transcript/captions';
import type { Passage } from '../core/types';
import type { SearchResultItem, VideoRecord } from '../shared/protocol';
import type { Settings } from '../shared/settings';
import { getCaptions, getSegments, getVectors, getVideo, listVideos, putVectors } from './db';
import { clientFor } from './llm';

/**
 * Per-video and whole-library retrieval. Passages are derived from stored
 * captions + segments on demand and cached in memory; `invalidate` is called
 * whenever a video's analysis changes.
 */
const passageCache = new Map<string, Passage[]>();
let libraryCache: { key: string; retriever: HybridRetriever } | null = null;
let version = 0;

export function invalidate(videoId?: string): void {
  if (videoId) passageCache.delete(videoId);
  else passageCache.clear();
  libraryCache = null;
  version += 1;
}

export async function passagesFor(videoId: string): Promise<Passage[]> {
  const cached = passageCache.get(videoId);
  if (cached) return cached;
  const lines = await getCaptions(videoId);
  if (!lines) return [];
  const passages = attachContext(buildPassages(videoId, lines), await getSegments(videoId));
  passageCache.set(videoId, passages);
  return passages;
}

/** Build/refresh embeddings for a video's passages. Best effort: retrieval works without them. */
export async function ensureVectors(videoId: string, settings: Settings): Promise<number> {
  if (!settings.embeddingModel) return 0;
  const client = clientFor(settings);
  if (!client.embed) return 0;
  const passages = await passagesFor(videoId);
  const cache = await getVectors([videoId], settings.embeddingModel);
  return embedMissing({
    passages,
    cache,
    embed: (texts) => client.embed!(texts),
    onBatch: (rows) => putVectors(videoId, settings.embeddingModel, rows)
  });
}

async function queryVector(query: string, settings: Settings): Promise<number[] | null> {
  if (!settings.embeddingModel) return null;
  try {
    const client = clientFor(settings);
    return client.embed ? ((await client.embed([query]))[0] ?? null) : null;
  } catch {
    return null;
  }
}

export async function searchVideo(videoId: string, query: string, k: number, settings: Settings): Promise<SearchHit[]> {
  const passages = await passagesFor(videoId);
  const vectors = settings.embeddingModel ? await getVectors([videoId], settings.embeddingModel) : undefined;
  const retriever = new HybridRetriever(passages, vectors);
  const qv = retriever.hasVectors ? await queryVector(query, settings) : null;
  return retriever.search(query, qv, { k });
}

async function libraryRetriever(settings: Settings): Promise<{ retriever: HybridRetriever; videos: Map<string, VideoRecord> }> {
  const videos = await listVideos();
  const byId = new Map(videos.map((v) => [v.videoId, v]));
  const key = `${version}|${settings.embeddingModel}|${videos.length}`;
  if (!libraryCache || libraryCache.key !== key) {
    const all = (await Promise.all(videos.map((v) => passagesFor(v.videoId)))).flat();
    const vectors = settings.embeddingModel ? await getVectors(null, settings.embeddingModel) : undefined;
    libraryCache = { key, retriever: new HybridRetriever(all, vectors) };
  }
  return { retriever: libraryCache.retriever, videos: byId };
}

export async function searchLibrary(query: string, k: number, settings: Settings, excludeVideoId?: string) {
  const { retriever, videos } = await libraryRetriever(settings);
  const qv = retriever.hasVectors ? await queryVector(query, settings) : null;
  const ids = excludeVideoId ? Array.from(videos.keys()).filter((id) => id !== excludeVideoId) : undefined;
  return retriever.search(query, qv, { k, videoIds: ids }).map((h) => {
    const v = videos.get(h.passage.videoId);
    return { ...h, videoTitle: v?.title ?? h.passage.videoId, bvid: v?.bvid ?? '' };
  });
}

export async function toResultItems(hits: SearchHit[]): Promise<SearchResultItem[]> {
  const out: SearchResultItem[] = [];
  for (const h of hits) {
    const v = await getVideo(h.passage.videoId);
    out.push({
      videoId: h.passage.videoId,
      bvid: v?.bvid ?? '',
      page: v?.page ?? 1,
      videoTitle: v?.title ?? '',
      start: h.passage.start,
      end: h.passage.end,
      text: h.passage.text,
      context: h.passage.context,
      score: h.score,
      via: h.via
    });
  }
  return out;
}

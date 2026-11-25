import type { Passage } from '../types';
import { Bm25Index, type ScoredId } from './bm25';
import { cosine, mmr, rangeOverlap, reciprocalRankFusion } from './fusion';

export type Embedder = (texts: string[]) => Promise<number[][]>;

export interface SearchHit {
  passage: Passage;
  score: number;
  /** Which retrievers found it; useful for the trace view and for eval breakdowns. */
  via: Array<'bm25' | 'vector'>;
}

export interface SearchOptions {
  k?: number;
  /** How many candidates each retriever contributes before fusion. */
  recall?: number;
  videoIds?: string[];
  /** 1 = pure relevance, lower values trade relevance for diversity. */
  mmrLambda?: number;
}

/** Text that is indexed for a passage: the raw captions plus the segment summary when available. */
export function passageIndexText(p: Passage): string {
  return p.context ? `${p.context}\n${p.text}` : p.text;
}

/**
 * Hybrid retriever: BM25 for exact terms (names, numbers, jargon the speaker
 * actually said) plus optional dense vectors for paraphrases, fused with RRF
 * and de-duplicated with MMR so overlapping windows of the same moment do not
 * crowd out other parts of the video.
 *
 * Vectors are optional on purpose: many users' providers have no embedding
 * endpoint, and the retriever must still work (and be evaluated) without one.
 */
export class HybridRetriever {
  private readonly bm25 = new Bm25Index();
  private readonly byId = new Map<string, Passage>();
  private vectors = new Map<string, number[]>();

  constructor(passages: Passage[], vectors?: Map<string, number[]>) {
    for (const p of passages) {
      this.byId.set(p.id, p);
      this.bm25.add(p.id, passageIndexText(p));
    }
    if (vectors) this.vectors = vectors;
  }

  get size(): number {
    return this.byId.size;
  }

  get hasVectors(): boolean {
    return this.vectors.size > 0;
  }

  getPassage(id: string): Passage | undefined {
    return this.byId.get(id);
  }

  search(query: string, queryVector: number[] | null, options: SearchOptions = {}): SearchHit[] {
    const k = options.k ?? 6;
    const recall = options.recall ?? Math.max(30, k * 5);
    const allowed = options.videoIds ? new Set(options.videoIds) : null;
    const keep = (id: string) => !allowed || allowed.has(this.byId.get(id)?.videoId ?? '');

    const lexical = this.bm25.search(query, recall * 3).filter((x) => keep(x.id)).slice(0, recall);
    const lists: ScoredId[][] = [lexical];
    let dense: ScoredId[] = [];
    if (queryVector && this.vectors.size > 0) {
      dense = Array.from(this.vectors, ([id, v]) => ({ id, score: cosine(queryVector, v) }))
        .filter((x) => keep(x.id) && this.byId.has(x.id))
        .sort((a, b) => b.score - a.score)
        .slice(0, recall);
      lists.push(dense);
    }
    const fused = lists.length > 1 ? reciprocalRankFusion(lists) : lexical;
    const viaBm25 = new Set(lexical.map((x) => x.id));
    const viaVector = new Set(dense.map((x) => x.id));
    const candidates: SearchHit[] = fused
      .map((x) => ({
        passage: this.byId.get(x.id)!,
        score: x.score,
        via: [...(viaBm25.has(x.id) ? (['bm25'] as const) : []), ...(viaVector.has(x.id) ? (['vector'] as const) : [])]
      }))
      .filter((h) => h.passage);

    return mmr({
      candidates,
      relevance: (h) => h.score,
      similarity: (a, b) => (a.passage.videoId === b.passage.videoId ? rangeOverlap(a.passage, b.passage) : 0),
      k,
      lambda: options.mmrLambda ?? 0.75
    });
  }
}

/**
 * Attach the title/summary of the segment each passage falls in. Indexing
 * the summary next to the raw captions lets a paraphrased question match the
 * model's normalised wording even when it shares no words with the ASR text.
 */
export function attachContext(passages: Passage[], segments: Array<{ fromLine: number; toLine: number; title: string; summary: string }>): Passage[] {
  if (segments.length === 0) return passages;
  return passages.map((p) => {
    const mid = Math.floor((p.fromLine + p.toLine) / 2);
    const seg = segments.find((s) => mid >= s.fromLine && mid <= s.toLine);
    return seg ? { ...p, context: `${seg.title}：${seg.summary}` } : p;
  });
}

/** Embed passages that have no cached vector yet, in small batches. */
export async function embedMissing(params: {
  passages: Passage[];
  cache: Map<string, number[]>;
  embed: Embedder;
  batchSize?: number;
  onBatch?: (vectors: Array<{ id: string; vector: number[] }>) => Promise<void> | void;
}): Promise<number> {
  const missing = params.passages.filter((p) => !params.cache.has(p.id));
  const size = params.batchSize ?? 32;
  let built = 0;
  for (let i = 0; i < missing.length; i += size) {
    const batch = missing.slice(i, i + size);
    const vectors = await params.embed(batch.map(passageIndexText));
    const rows = batch.map((p, j) => ({ id: p.id, vector: vectors[j] ?? [] })).filter((r) => r.vector.length > 0);
    for (const r of rows) params.cache.set(r.id, r.vector);
    built += rows.length;
    await params.onBatch?.(rows);
  }
  return built;
}

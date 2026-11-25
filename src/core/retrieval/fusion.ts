import type { ScoredId } from './bm25';

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Reciprocal Rank Fusion. BM25 scores and cosine similarities live on
 * incomparable scales; RRF only uses ranks, so it needs no score
 * normalisation and is robust when one retriever is missing or noisy.
 */
export function reciprocalRankFusion(lists: ScoredId[][], k = 60, weights?: number[]): ScoredId[] {
  const fused = new Map<string, number>();
  lists.forEach((list, li) => {
    const w = weights?.[li] ?? 1;
    list.forEach((item, rank) => {
      fused.set(item.id, (fused.get(item.id) ?? 0) + w / (k + rank + 1));
    });
  });
  return Array.from(fused, ([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

/**
 * Maximal Marginal Relevance: greedily pick items that are relevant but not
 * redundant with what is already picked. `similarity` is supplied by the
 * caller (overlap of caption lines for passages, cosine for embeddings).
 */
export function mmr<T>(params: {
  candidates: T[];
  relevance: (item: T) => number;
  similarity: (a: T, b: T) => number;
  k: number;
  lambda?: number;
}): T[] {
  const lambda = params.lambda ?? 0.7;
  const pool = params.candidates.slice();
  const picked: T[] = [];
  const rel = new Map(pool.map((c) => [c, params.relevance(c)] as const));
  const maxRel = Math.max(1e-9, ...Array.from(rel.values()));
  while (picked.length < params.k && pool.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const c = pool[i];
      const redundancy = picked.length ? Math.max(...picked.map((p) => params.similarity(c, p))) : 0;
      const score = lambda * ((rel.get(c) ?? 0) / maxRel) - (1 - lambda) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    picked.push(pool.splice(bestIdx, 1)[0]);
  }
  return picked;
}

/** Jaccard overlap of two line ranges; 1 when identical, 0 when disjoint. */
export function rangeOverlap(a: { fromLine: number; toLine: number }, b: { fromLine: number; toLine: number }): number {
  const inter = Math.min(a.toLine, b.toLine) - Math.max(a.fromLine, b.fromLine) + 1;
  if (inter <= 0) return 0;
  const union = Math.max(a.toLine, b.toLine) - Math.min(a.fromLine, b.fromLine) + 1;
  return inter / union;
}

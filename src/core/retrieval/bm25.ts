import { tokenize } from '../text/tokenize';

export interface Bm25Options {
  k1?: number;
  b?: number;
}

export interface ScoredId {
  id: string;
  score: number;
}

/**
 * Okapi BM25 over an in-memory inverted index. Passages are short (~40s of
 * speech) and a personal library holds at most tens of thousands of them, so
 * a plain Map-based index rebuilt on demand is fast enough and keeps the
 * extension free of a search dependency.
 */
export class Bm25Index {
  private readonly k1: number;
  private readonly b: number;
  private readonly postings = new Map<string, Map<number, number>>();
  private readonly docLen: number[] = [];
  private readonly ids: string[] = [];
  private totalLen = 0;

  constructor(options: Bm25Options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
  }

  get size(): number {
    return this.ids.length;
  }

  add(id: string, text: string): void {
    const doc = this.ids.length;
    this.ids.push(id);
    const tokens = tokenize(text);
    this.docLen.push(tokens.length);
    this.totalLen += tokens.length;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [term, count] of tf) {
      let list = this.postings.get(term);
      if (!list) {
        list = new Map();
        this.postings.set(term, list);
      }
      list.set(doc, count);
    }
  }

  search(query: string, k = 10): ScoredId[] {
    const n = this.ids.length;
    if (n === 0) return [];
    const avgLen = this.totalLen / n || 1;
    const scores = new Map<number, number>();
    const terms = Array.from(new Set(tokenize(query)));
    for (const term of terms) {
      const list = this.postings.get(term);
      if (!list) continue;
      const df = list.size;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (const [doc, tf] of list) {
        const norm = tf + this.k1 * (1 - this.b + (this.b * this.docLen[doc]) / avgLen);
        scores.set(doc, (scores.get(doc) ?? 0) + idf * ((tf * (this.k1 + 1)) / norm));
      }
    }
    return Array.from(scores, ([doc, score]) => ({ id: this.ids[doc], score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

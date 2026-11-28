/**
 * Offline retrieval evaluation (no API key; runs in CI):
 *
 *   npm run eval
 *
 * Library search is the one place BilibiliDry still retrieves: questions about a single video
 * put the whole transcript in context. This compares keyword-overlap matching with BM25 + MMR
 * on two original, labelled transcripts. Model-based evaluation on real videos is
 * `npm run eval:real` (eval/real).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HybridRetriever } from '../src/core/retrieval/hybrid';
import { buildPassages } from '../src/core/transcript/captions';
import type { Passage } from '../src/core/types';
import { buildFixture, FIXTURES, type BuiltFixture } from './fixtures/build';
import { legacyKeywordScore } from './legacy';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.5;

interface Scores {
  r1: number;
  r3: number;
  r5: number;
  mrr: number;
}

function score(rankings: Array<{ ranked: Passage[]; gold: Array<{ start: number; end: number }> }>): Scores {
  let r1 = 0;
  let r3 = 0;
  let r5 = 0;
  let mrr = 0;
  for (const { ranked, gold } of rankings) {
    const first = ranked.findIndex((p) => gold.some((g) => overlaps(p, g)));
    if (first === 0) r1 += 1;
    if (first >= 0 && first < 3) r3 += 1;
    if (first >= 0 && first < 5) r5 += 1;
    if (first >= 0) mrr += 1 / (first + 1);
  }
  const n = rankings.length || 1;
  return { r1: r1 / n, r3: r3 / n, r5: r5 / n, mrr: mrr / n };
}

type Ranker = (passages: Passage[], q: string) => Passage[];

function evaluate(builts: BuiltFixture[], ranker: Ranker) {
  const all: Array<{ ranked: Passage[]; gold: Array<{ start: number; end: number }>; style: string }> = [];
  for (const b of builts) {
    const passages = buildPassages(b.video.videoId, b.lines);
    for (const q of b.fixture.queries) all.push({ ranked: ranker(passages, q.q), gold: q.gold.map((id) => b.spans.get(id)!), style: q.style });
  }
  return { all: score(all), lexical: score(all.filter((x) => x.style === 'lexical')), paraphrase: score(all.filter((x) => x.style === 'paraphrase')) };
}

/** Counts overlapping words/bigrams between the query and a passage: the extension's first search. */
const keywordRanker: Ranker = (passages, q) =>
  passages
    .map((p) => ({ p, s: legacyKeywordScore(q, p.text) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);

const bm25Ranker: Ranker = (passages, q) => new HybridRetriever(passages).search(q, null, { k: 5 }).map((h) => h.passage);

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

function main() {
  const builts = FIXTURES.map(buildFixture);
  const rows: Array<[string, ReturnType<typeof evaluate>]> = [
    ['关键词重合计数', evaluate(builts, keywordRanker)],
    ['BM25 + MMR', evaluate(builts, bm25Ranker)]
  ];
  const n = builts.reduce((a, b) => a + b.fixture.queries.length, 0);
  const md = [
    '# 离线检索评测',
    '',
    `样例：${builts.map((b) => `${b.fixture.title}（${Math.round(b.video.durationSec / 60)} 分钟）`).join('；')}，共 ${n} 个问题。`,
    '',
    '| 检索方法 | Recall@1 | Recall@3 | Recall@5 | MRR | 原词提问 R@3 | 换说法提问 R@3 |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(([name, r]) => `| ${name} | ${pct(r.all.r1)} | ${pct(r.all.r3)} | ${pct(r.all.r5)} | ${r.all.mrr.toFixed(2)} | ${pct(r.lexical.r3)} | ${pct(r.paraphrase.r3)} |`)
  ].join('\n');
  mkdirSync(path.join(ROOT, 'eval/results'), { recursive: true });
  writeFileSync(path.join(ROOT, 'eval/results/offline-latest.md'), md);
  writeFileSync(path.join(ROOT, 'eval/results/offline-latest.json'), JSON.stringify(Object.fromEntries(rows), null, 2));
  console.log(md);
}

main();

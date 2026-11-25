/**
 * BilibiliDry evaluation harness.
 *
 *   npm run eval -- --offline   retrieval only, no API key needed (runs in CI)
 *   npm run eval                 + full analysis pipeline and agent against a real model
 *
 * Model config is read from OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL
 * (optional OPENAI_CHEAP_MODEL, OPENAI_EMBEDDING_MODEL), falling back to the
 * VITE_* names in .env.local. Results are printed as Markdown and written to
 * eval/results/latest.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runAgent } from '../src/core/agent/agent';
import { runAnalysis } from '../src/core/analysis/pipeline';
import { createOpenAICompatClient } from '../src/core/llm/openaiCompat';
import type { LlmClient } from '../src/core/llm/types';
import { attachContext, embedMissing, HybridRetriever } from '../src/core/retrieval/hybrid';
import { Tracer, tracedClient, traceTotals } from '../src/core/trace/tracer';
import { buildPassages } from '../src/core/transcript/captions';
import type { Passage, Segment } from '../src/core/types';
import { buildFixture, FIXTURES, type BuiltFixture } from './fixtures/build';
import { legacyKeywordScore } from './legacy';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const offline = process.argv.includes('--offline');

function loadEnvFile(): Record<string, string> {
  const file = path.join(ROOT, '.env.local');
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function modelConfig() {
  const f = loadEnvFile();
  const pick = (...keys: string[]) => keys.map((k) => process.env[k] ?? f[k]).find((v) => v && v.trim())?.trim();
  return {
    baseUrl: pick('OPENAI_BASE_URL', 'VITE_OPENAI_BASE_URL'),
    apiKey: pick('OPENAI_API_KEY', 'VITE_OPENAI_API_KEY'),
    model: pick('OPENAI_MODEL', 'VITE_OPENAI_MODEL'),
    cheapModel: pick('OPENAI_CHEAP_MODEL', 'VITE_OPENAI_CHEAP_MODEL'),
    embeddingModel: pick('OPENAI_EMBEDDING_MODEL', 'VITE_OPENAI_EMBEDDING_MODEL')
  };
}

// ---------- metrics ----------

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.5;
}

function isHit(p: Passage, gold: Array<{ start: number; end: number }>): boolean {
  return gold.some((g) => overlaps(p, g));
}

interface RetrievalScores {
  r1: number;
  r3: number;
  r5: number;
  mrr: number;
  n: number;
}

function scoreRanking(rankings: Array<{ ranked: Passage[]; gold: Array<{ start: number; end: number }> }>): RetrievalScores {
  let r1 = 0;
  let r3 = 0;
  let r5 = 0;
  let mrr = 0;
  for (const { ranked, gold } of rankings) {
    const first = ranked.findIndex((p) => isHit(p, gold));
    if (first === 0) r1 += 1;
    if (first >= 0 && first < 3) r3 += 1;
    if (first >= 0 && first < 5) r5 += 1;
    if (first >= 0) mrr += 1 / (first + 1);
  }
  const n = rankings.length || 1;
  return { r1: r1 / n, r3: r3 / n, r5: r5 / n, mrr: mrr / n, n: rankings.length };
}

function goldSpans(b: BuiltFixture, ids: string[]) {
  return ids.map((id) => b.spans.get(id)!).filter(Boolean);
}

type Ranker = (b: BuiltFixture, passages: Passage[], q: string) => Promise<Passage[]> | Passage[];

async function evalRetrieval(builts: BuiltFixture[], ranker: Ranker, passagesFor: (b: BuiltFixture) => Passage[]) {
  const all: Array<{ ranked: Passage[]; gold: Array<{ start: number; end: number }>; style: string }> = [];
  for (const b of builts) {
    const passages = passagesFor(b);
    for (const q of b.fixture.queries) {
      all.push({ ranked: await ranker(b, passages, q.q), gold: goldSpans(b, q.gold), style: q.style });
    }
  }
  return {
    all: scoreRanking(all),
    lexical: scoreRanking(all.filter((x) => x.style === 'lexical')),
    paraphrase: scoreRanking(all.filter((x) => x.style === 'paraphrase'))
  };
}

const legacyRanker: Ranker = (_b, passages, q) =>
  passages
    .map((p) => ({ p, s: Math.max(legacyKeywordScore(q, p.text), legacyKeywordScore(q, p.context ?? '')) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);

const bm25Ranker: Ranker = (_b, passages, q) => new HybridRetriever(passages).search(q, null, { k: 5 }).map((h) => h.passage);

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function retrievalTable(rows: Array<[string, Awaited<ReturnType<typeof evalRetrieval>>]>): string {
  const head = '| 检索方法 | Recall@1 | Recall@3 | Recall@5 | MRR | 原词提问 R@3 | 换说法提问 R@3 |\n|---|---|---|---|---|---|---|';
  const body = rows
    .map(([name, r]) => `| ${name} | ${pct(r.all.r1)} | ${pct(r.all.r3)} | ${pct(r.all.r5)} | ${r.all.mrr.toFixed(2)} | ${pct(r.lexical.r3)} | ${pct(r.paraphrase.r3)} |`)
    .join('\n');
  return `${head}\n${body}`;
}

// ---------- analysis metrics ----------

function waterF1(b: BuiltFixture, segs: Segment[]) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const goldWater = b.fixture.blocks.filter((x) => x.kind === 'water').map((x) => b.spans.get(x.id)!);
  for (let t = 0; t < b.video.durationSec; t += 1) {
    const g = goldWater.some((s) => t >= s.start && t < s.end);
    const p = segs.some((s) => s.kind === 'water' && t >= s.start && t < s.end);
    if (g && p) tp += 1;
    else if (p) fp += 1;
    else if (g) fn += 1;
  }
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  return { precision, recall, f1: (2 * precision * recall) / Math.max(1e-9, precision + recall) };
}

function highlightCoverage(b: BuiltFixture, highlights: Segment[]) {
  const keys = b.fixture.blocks.filter((x) => x.key).map((x) => b.spans.get(x.id)!);
  const covered = keys.filter((k) => highlights.some((h) => overlaps(h, k))).length;
  const water = b.fixture.blocks.filter((x) => x.kind === 'water').map((x) => b.spans.get(x.id)!);
  const inWater = highlights.filter((h) => water.some((w) => Math.min(h.end, w.end) - Math.max(h.start, w.start) > (h.end - h.start) / 2)).length;
  return { keyRecall: covered / Math.max(1, keys.length), inWater, count: highlights.length };
}

function legacyTopK(segs: Segment[], k = 6): Segment[] {
  // v0 behaviour: sort DRY by the model's score and take a fixed 6.
  return segs
    .filter((s) => s.kind === 'dry')
    .sort((a, b) => b.importance - a.importance)
    .slice(0, k);
}

async function main() {
  const builts = FIXTURES.map(buildFixture);
  const report: string[] = [];
  const json: Record<string, unknown> = { date: new Date().toISOString(), fixtures: builts.map((b) => b.fixture.id) };
  const totalQueries = builts.reduce((a, b) => a + b.fixture.queries.length, 0);
  report.push(`# BilibiliDry 评测报告`, '', `样例：${builts.map((b) => `${b.fixture.title}（${Math.round(b.video.durationSec / 60)} 分钟，${b.lines.length} 行字幕）`).join('；')}。问题 ${totalQueries} 条。`, '');

  const raw = (b: BuiltFixture) => buildPassages(b.video.videoId, b.lines);
  const offlineRows: Array<[string, Awaited<ReturnType<typeof evalRetrieval>>]> = [
    ['v0 关键词匹配（旧版）', await evalRetrieval(builts, legacyRanker, raw)],
    ['BM25 + MMR（新版，无 Key）', await evalRetrieval(builts, bm25Ranker, raw)]
  ];

  const cfg = modelConfig();
  const canUseModel = !offline && cfg.baseUrl && cfg.apiKey && cfg.model;
  if (!canUseModel) {
    report.push('## 检索（只用字幕原文）', '', retrievalTable(offlineRows), '');
    if (!offline) report.push('> 没有找到模型配置，跳过需要模型的评测。设置 OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL 后重跑。', '');
    json.retrieval = Object.fromEntries(offlineRows);
    finish(report, json);
    return;
  }

  const base: LlmClient = createOpenAICompatClient({ baseUrl: cfg.baseUrl!, apiKey: cfg.apiKey!, model: cfg.cheapModel || cfg.model!, embeddingModel: cfg.embeddingModel });
  const analysisRows: string[] = [];
  const agentRows: string[] = [];
  const segmentsBy = new Map<string, Segment[]>();
  const vectorsBy = new Map<string, Map<string, number[]>>();
  const analysisJson: unknown[] = [];
  const agentJson: unknown[] = [];

  for (const b of builts) {
    const tracer = new Tracer({ kind: 'analysis', videoId: b.video.videoId, title: b.video.title });
    const llm = tracedClient(base, tracer);
    const res = await runAnalysis(
      { video: b.video, lines: b.lines },
      { llm, tracer },
      { chunkSec: 90, concurrency: 3, cheapModel: cfg.cheapModel || cfg.model, strongModel: cfg.model }
    );
    tracer.finish();
    if (res.segments.length === 0) throw new Error(`${b.fixture.id} 全部分块失败：${res.lastError ?? '未知错误'}`);
    segmentsBy.set(b.fixture.id, res.segments);
    const wf = waterF1(b, res.segments);
    const highlights = res.segments.filter((s) => res.digest?.highlightIds.includes(s.id));
    const hc = highlightCoverage(b, highlights);
    const legacy = highlightCoverage(b, legacyTopK(res.segments));
    const tot = traceTotals(tracer.trace);
    const avgGround = res.segments.reduce((a, s) => a + (s.grounding?.lexical ?? 0), 0) / Math.max(1, res.segments.length);
    analysisRows.push(
      `| ${b.fixture.id} | ${pct(wf.precision)} / ${pct(wf.recall)} / ${pct(wf.f1)} | ${hc.count} 个，覆盖关键段 ${pct(hc.keyRecall)}，落在注水 ${hc.inWater} | ${legacy.count} 个，覆盖 ${pct(legacy.keyRecall)}，落在注水 ${legacy.inWater} | ${avgGround.toFixed(2)} | ${res.digest?.chapters.length ?? 0} | ${tot.llmCalls} 次 / ${(tot.promptTokens + tot.completionTokens).toLocaleString()} tok / ${(tot.wallMs / 1000).toFixed(1)}s |`
    );
    analysisJson.push({ fixture: b.fixture.id, water: wf, highlights: hc, legacyTopK: legacy, avgGrounding: avgGround, chapters: res.digest?.chapters.length ?? 0, failedChunks: res.failedChunks, totals: tot });

    if (base.embed) {
      const cache = new Map<string, number[]>();
      try {
        await embedMissing({ passages: attachContext(raw(b), res.segments), cache, embed: (t) => base.embed!(t) });
        vectorsBy.set(b.fixture.id, cache);
      } catch (err) {
        console.warn(`embedding 失败，跳过向量检索：${(err as Error).message}`);
      }
    }
  }

  const withContext = (b: BuiltFixture) => attachContext(raw(b), segmentsBy.get(b.fixture.id) ?? []);
  const rows: Array<[string, Awaited<ReturnType<typeof evalRetrieval>>]> = [...offlineRows, ['BM25 + 片段摘要上下文', await evalRetrieval(builts, bm25Ranker, withContext)]];
  if (vectorsBy.size > 0) {
    const hybrid: Ranker = async (b, passages, q) => {
      const qv = (await base.embed!([q]))[0];
      return new HybridRetriever(passages, vectorsBy.get(b.fixture.id)).search(q, qv, { k: 5 }).map((h) => h.passage);
    };
    rows.push(['混合检索（BM25 + 向量 + RRF + MMR）', await evalRetrieval(builts, hybrid, withContext)]);
  }

  let correct = 0;
  let cited = 0;
  let groundedCites = 0;
  let totalCites = 0;
  let steps = 0;
  let agentTokens = 0;
  for (const b of builts) {
    const passages = withContext(b);
    const retriever = new HybridRetriever(passages, vectorsBy.get(b.fixture.id));
    for (const q of b.fixture.queries) {
      const tracer = new Tracer({ kind: 'chat', videoId: b.video.videoId, title: q.q });
      const out = await runAgent({
        llm: tracedClient(createOpenAICompatClient({ baseUrl: cfg.baseUrl!, apiKey: cfg.apiKey!, model: cfg.model! }), tracer),
        tracer,
        question: q.q,
        env: {
          video: b.video,
          lines: b.lines,
          segments: segmentsBy.get(b.fixture.id) ?? [],
          digest: null,
          searchVideo: async (query, k) => retriever.search(query, null, { k })
        }
      });
      tracer.finish();
      const gold = goldSpans(b, q.gold);
      const goodCites = out.citations.filter((c) => c.grounded);
      const hit = out.citations.some((c) => gold.some((g) => c.time >= g.start - 8 && c.time <= g.end + 8));
      if (hit) correct += 1;
      if (out.citations.length) cited += 1;
      totalCites += out.citations.length;
      groundedCites += goodCites.length;
      steps += out.steps;
      const t = traceTotals(tracer.trace);
      agentTokens += t.promptTokens + t.completionTokens;
      agentJson.push({ fixture: b.fixture.id, q: q.q, hit, citations: out.citations, steps: out.steps, mode: out.mode, answer: out.answer.slice(0, 400) });
    }
  }
  agentRows.push(
    `| ${totalQueries} | ${pct(correct / totalQueries)} | ${pct(cited / totalQueries)} | ${pct(groundedCites / Math.max(1, totalCites))} | ${(steps / totalQueries).toFixed(1)} | ${Math.round(agentTokens / totalQueries).toLocaleString()} |`
  );

  report.push(`模型：分块 \`${cfg.cheapModel || cfg.model}\`，总结/校验/精修/问答 \`${cfg.model}\`${cfg.embeddingModel ? `，Embedding \`${cfg.embeddingModel}\`` : '（无 Embedding）'}。`, '');
  report.push('## 检索', '', retrievalTable(rows), '');
  report.push(
    '## 分析流水线',
    '',
    '| 样例 | 注水识别 P / R / F1（按秒） | 新版重点选择 | 旧版 TopK=6 | 平均落地分 | 章节数 | 开销 |',
    '|---|---|---|---|---|---|---|',
    ...analysisRows,
    ''
  );
  report.push(
    '## 问答 Agent',
    '',
    '| 问题数 | 引用命中正确时间段 | 带引用的回答 | 引用落在已检索证据内 | 平均步数 | 平均 token |',
    '|---|---|---|---|---|---|',
    ...agentRows,
    ''
  );
  json.retrieval = Object.fromEntries(rows);
  json.analysis = analysisJson;
  json.agent = agentJson;
  finish(report, json);
}

function finish(report: string[], json: Record<string, unknown>) {
  const text = report.join('\n');
  console.log(text);
  const dir = path.join(ROOT, 'eval', 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, offline ? 'offline.json' : 'latest.json'), JSON.stringify(json, null, 2));
  if (!offline) writeFileSync(path.join(dir, 'latest.md'), text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

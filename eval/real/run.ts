/**
 * Evaluation on real Bilibili videos.
 *
 *   npm run eval:real                       all methods
 *   npm run eval:real -- --only analysis    or: --only qa
 *   npm run eval:real -- --videos BV1xx,BV1yy
 *
 * Transcripts live in eval/real/data/videos.json (local only: third-party content, see README);
 * labels in eval/real/labels/*.json are ours and committed. Model config comes from
 * LLM_BASE_URL / LLM_API_KEY / LLM_MODEL or the VITE_LLM_* values in .env.local.
 *
 * Compared, on the same transcripts and the same model:
 * - analysis: chunked map-reduce (eval/baselines/chunked-analysis) vs one whole-video pass,
 *   with thinking off and at "low".
 * - Q&A: a retrieval agent over 40-second windows (eval/baselines/retrieval-qa) vs the whole
 *   transcript in context.
 * Answers are graded by a different, stronger model against our reference answers.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { analyzeVideo } from '../../src/core/analysis/analyze';
import { parseJsonLoose } from '../../src/core/llm/json';
import { createOpenAICompatClient } from '../../src/core/llm/openaiCompat';
import type { LlmClient, ReasoningLevel } from '../../src/core/llm/types';
import { askVideo } from '../../src/core/qa/videoQa';
import { attachContext, HybridRetriever } from '../../src/core/retrieval/hybrid';
import { Tracer, tracedClient, traceTotals, type TraceTotals } from '../../src/core/trace/tracer';
import { buildPassages, cleanCaptions } from '../../src/core/transcript/captions';
import type { CaptionLine, OfficialSummary, Segment, VideoDigest, VideoInfo } from '../../src/core/types';
import { runAnalysis } from '../baselines/chunked-analysis/pipeline';
import { runAgent } from '../baselines/retrieval-qa/agent';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

// ---------- data ----------

interface Span {
  start: number;
  end: number;
}
interface Labels {
  bvid: string;
  water: Array<Span & { reason: string }>;
  ambiguous: Span[];
  key: Span[];
  questions: Array<{ q: string; gold: Array<[number, number]>; answer: string; style: 'lexical' | 'paraphrase' | 'absent' }>;
}
interface RealVideo {
  info: VideoInfo;
  lines: CaptionLine[];
  official: OfficialSummary;
  labels: Labels;
}

function loadVideos(): RealVideo[] {
  const file = path.join(ROOT, 'eval/real/data/videos.json');
  if (!existsSync(file)) throw new Error('缺少 eval/real/data/videos.json，见 eval/real/README.md');
  const raw: any[] = JSON.parse(readFileSync(file, 'utf8'));
  const only = arg('videos')?.split(',');
  return readdirSync(path.join(ROOT, 'eval/real/labels'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(ROOT, 'eval/real/labels', f), 'utf8')) as Labels)
    .filter((l) => !only || only.includes(l.bvid))
    .map((labels) => {
      const v = raw.find((x) => x.bvid === labels.bvid);
      if (!v) throw new Error(`videos.json 里没有 ${labels.bvid}`);
      const lines = cleanCaptions(v.lines.map((l: [number, number, string]) => ({ from: l[0], to: l[1], content: l[2] })));
      return {
        info: { videoId: `${v.bvid}_${v.cid}`, bvid: v.bvid, aid: v.aid, cid: v.cid, page: 1, title: v.title, owner: v.owner, durationSec: v.duration },
        lines,
        official: { summary: v.summary, outline: v.outline.map((o: any) => ({ title: o.title, start: o.t, points: o.points.map((p: [number, string]) => ({ time: p[0], text: p[1] })) })) },
        labels
      };
    });
}

function config() {
  const env: Record<string, string> = {};
  const file = path.join(ROOT, '.env.local');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }
  const pick = (k: string) => process.env[`LLM_${k}`] ?? env[`VITE_LLM_${k}`];
  const baseUrl = pick('BASE_URL');
  const apiKey = pick('API_KEY');
  if (!baseUrl || !apiKey) throw new Error('需要 LLM_BASE_URL / LLM_API_KEY，或 .env.local 里的 VITE_LLM_*');
  return { baseUrl, apiKey, model: pick('MODEL') ?? 'deepseek-flash', judgeModel: process.env.JUDGE_MODEL ?? 'deepseek-v4-pro' };
}

function client(model: string, reasoning: ReasoningLevel): LlmClient {
  const c = config();
  return createOpenAICompatClient({ baseUrl: c.baseUrl, apiKey: c.apiKey, model, reasoning, reasoningStyle: 'deepseek', timeoutMs: 300_000 });
}

// ---------- metrics ----------

const overlap = (a: Span, b: Span) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const inAny = (t: number, spans: Span[]) => spans.some((s) => t >= s.start && t < s.end);

/** Second-level precision/recall of "this is filler", ignoring seconds labelled ambiguous. */
function waterScores(segments: Segment[], labels: Labels, duration: number) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let keyAsWater = 0;
  let keySec = 0;
  for (let t = 0; t < duration; t += 1) {
    const mid = t + 0.5;
    if (inAny(mid, labels.ambiguous)) continue;
    const gold = inAny(mid, labels.water);
    const seg = segments.find((s) => mid >= s.start && mid < s.end);
    const pred = seg?.kind === 'water';
    if (gold && pred) tp += 1;
    else if (!gold && pred) fp += 1;
    else if (gold && !pred) fn += 1;
    if (inAny(mid, labels.key)) {
      keySec += 1;
      if (pred) keyAsWater += 1;
    }
  }
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, keyAsWater: keySec ? keyAsWater / keySec : 0 };
}

/** Share of labelled key passages that at least one chosen highlight overlaps. */
function highlightCoverage(segments: Segment[], digest: VideoDigest | null, labels: Labels) {
  const hl = segments.filter((s) => digest?.highlightIds.includes(s.id));
  const covered = labels.key.filter((k) => hl.some((h) => overlap(h, k) > 3)).length;
  const onKey = hl.filter((h) => labels.key.some((k) => overlap(h, k) > 3)).length;
  return { coverage: labels.key.length ? covered / labels.key.length : 0, precision: hl.length ? onKey / hl.length : 0, count: hl.length };
}

async function judge(llm: LlmClient, q: string, reference: string, answer: string, absent: boolean): Promise<number> {
  const res = await llm.chat({
    purpose: 'judge',
    json: true,
    reasoning: 'low',
    messages: [
      {
        role: 'system',
        content:
          '你是阅卷老师。根据参考答案给学生回答打分，只输出 JSON：{"score":1|0.5|0,"reason":"不超过 30 字"}。1 = 参考答案的要点都对；0.5 = 部分对或有遗漏；0 = 答错、答非所问或编造。回答里多出的正确细节不扣分，引用标记（如 [L12]、[3:25]）忽略。' +
          (absent ? '这道题视频里没有答案：回答明确说视频没讲到才给 1，编造了答案给 0。' : '')
      },
      { role: 'user', content: `问题：${q}\n参考答案：${reference}\n学生回答：${answer}` }
    ]
  });
  const o = parseJsonLoose(res.content) as { score?: number };
  return [0, 0.5, 1].includes(Number(o.score)) ? Number(o.score) : 0;
}

const totalsRow = (t: TraceTotals) => ({ calls: t.llmCalls, prompt: t.promptTokens, cached: t.cachedTokens, completion: t.completionTokens, costUsd: t.costUsd, wallSec: t.wallMs / 1000 });

// ---------- runs ----------

async function analysisRun(method: string, v: RealVideo) {
  const model = config().model;
  const tracer = new Tracer({ kind: 'analysis', videoId: v.info.videoId, title: method });
  let segments: Segment[];
  let digest: VideoDigest | null;
  if (method === 'chunked') {
    const llm = tracedClient(client(model, 'off'), tracer);
    const out = await runAnalysis({ video: v.info, lines: v.lines }, { llm, tracer }, { chunkSec: 120, concurrency: 3, cheapModel: model, strongModel: model });
    segments = out.segments;
    digest = out.digest;
  } else {
    const reasoning: ReasoningLevel = method === 'whole-low' ? 'low' : 'off';
    const llm = tracedClient(client(model, reasoning), tracer);
    const out = await analyzeVideo({ video: v.info, lines: v.lines, official: v.official }, { llm });
    segments = out.segments;
    digest = out.digest;
  }
  tracer.finish();
  return { method, bvid: v.info.bvid, segments, digest, water: waterScores(segments, v.labels, v.info.durationSec), highlights: highlightCoverage(segments, digest, v.labels), totals: totalsRow(traceTotals(tracer.trace)) };
}

async function qaRun(method: string, v: RealVideo, segments: Segment[], digest: VideoDigest | null, judgeLlm: LlmClient) {
  const model = config().model;
  const rows = [];
  for (const q of v.labels.questions) {
    const tracer = new Tracer({ kind: 'chat', videoId: v.info.videoId, title: q.q });
    const llm = tracedClient(client(model, 'off'), tracer);
    let answer = '';
    let times: Array<{ time: number; supported?: boolean }> = [];
    try {
      if (method === 'retrieval') {
        const passages = attachContext(buildPassages(v.info.videoId, v.lines), segments);
        const retriever = new HybridRetriever(passages);
        const out = await runAgent({ llm, tracer, question: q.q, env: { video: v.info, lines: v.lines, segments, digest, searchVideo: async (query, k) => retriever.search(query, null, { k }) } });
        answer = out.answer;
        times = out.citations.map((c) => ({ time: c.time, supported: c.grounded }));
      } else {
        const out = await askVideo({ video: v.info, lines: v.lines, segments, official: v.official, question: q.q }, { llm });
        answer = out.answer;
        times = out.citations.filter((c) => c.time !== undefined).map((c) => ({ time: c.time!, supported: c.supported }));
      }
    } catch (err) {
      answer = `（出错：${(err as Error).message}）`;
    }
    tracer.finish();
    const gold = q.gold.map(([start, end]) => ({ start: start - 10, end: end + 10 }));
    const absent = q.style === 'absent';
    rows.push({
      method,
      bvid: v.info.bvid,
      q: q.q,
      style: q.style,
      score: await judge(judgeLlm, q.q, q.answer, answer, absent && q.gold.length === 0),
      cited: times.length,
      citationInGold: times.length ? times.filter((t) => inAny(t.time, gold)).length / times.length : null,
      anyCitationHit: gold.length ? times.some((t) => inAny(t.time, gold)) : null,
      checkerAgreement: times.map((t) => ({ supported: Boolean(t.supported), inGold: inAny(t.time, gold) })),
      totals: totalsRow(traceTotals(tracer.trace)),
      answer
    });
  }
  return rows;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : '–');

async function main() {
  const videos = loadVideos();
  const only = arg('only');
  const c = config();
  console.log(`${videos.length} 个视频，模型 ${c.model}，阅卷 ${c.judgeModel}`);
  const out: Record<string, unknown> = { model: c.model, judge: c.judgeModel, at: new Date().toISOString(), videos: videos.map((v) => v.info.bvid) };
  const md: string[] = [`# 真实视频评测（${new Date().toISOString().slice(0, 16)}）`, '', `${videos.length} 个视频，模型 \`${c.model}\`，阅卷 \`${c.judgeModel}\`。`, ''];

  let wholeResults: Awaited<ReturnType<typeof analysisRun>>[] = [];
  if (only !== 'qa') {
    const methods = (arg('analysis') ?? 'chunked,whole,whole-low').split(',');
    const results = [];
    for (const m of methods) {
      const rs = await pool(videos, 4, (v) => analysisRun(m, v).catch((err) => ({ method: m, bvid: v.info.bvid, error: String(err) }) as any));
      results.push(...rs);
      if (m === 'whole') wholeResults = rs.filter((r: any) => !r.error);
      console.log(`analysis ${m} done`);
    }
    out.analysis = results.map(({ segments: _s, digest: _d, ...r }: any) => r);
    md.push('## 分析', '', '| 方法 | 注水 P | 注水 R | 注水 F1 | 干货被判注水 | 重点覆盖 | 重点命中 | 调用 | 输入 token | 缓存 | 输出 token | 成本（$） | 耗时（s） |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const m of methods) {
      const rs = results.filter((r: any) => r.method === m && !r.error) as any[];
      const errors = results.filter((r: any) => r.method === m && r.error).length;
      md.push(
        `| ${m}${errors ? `（${errors} 个失败）` : ''} | ${pct(mean(rs.map((r) => r.water.precision)))} | ${pct(mean(rs.map((r) => r.water.recall)))} | ${pct(mean(rs.map((r) => r.water.f1)))} | ${pct(mean(rs.map((r) => r.water.keyAsWater)))} | ${pct(mean(rs.map((r) => r.highlights.coverage)))} | ${pct(mean(rs.map((r) => r.highlights.precision)))} | ${mean(rs.map((r) => r.totals.calls)).toFixed(1)} | ${Math.round(mean(rs.map((r) => r.totals.prompt)))} | ${Math.round(mean(rs.map((r) => r.totals.cached)))} | ${Math.round(mean(rs.map((r) => r.totals.completion)))} | ${mean(rs.map((r) => r.totals.costUsd)).toFixed(4)} | ${mean(rs.map((r) => r.totals.wallSec)).toFixed(1)} |`
      );
    }
    md.push('', '每视频平均。注水按秒算，模糊段不计分；重点覆盖 = 人工标的关键段落里有多少被选中的重点覆盖到。', '');
  }

  if (only !== 'analysis') {
    if (wholeResults.length === 0) {
      wholeResults = await pool(videos, 4, (v) => analysisRun('whole', v));
      console.log('analysis whole (for Q&A context) done');
    }
    const judgeLlm = client(c.judgeModel, 'low');
    const rows: any[] = [];
    for (const m of (arg('qa') ?? 'retrieval,full').split(',')) {
      const rs = await pool(videos, 4, (v) => {
        const a = wholeResults.find((r) => r.bvid === v.info.bvid)!;
        return qaRun(m, v, a.segments, a.digest, judgeLlm);
      });
      rows.push(...rs.flat());
      console.log(`qa ${m} done`);
    }
    out.qa = rows;
    md.push('## 问答', '', '| 方法 | 得分（全部） | 原词提问 | 换说法提问 | 视频没讲的 | 引用落在正确段 | 有引用命中 | 每问调用 | 每问输入 token | 每问成本（$） | 每问耗时（s） |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const m of [...new Set(rows.map((r) => r.method))]) {
      const rs = rows.filter((r) => r.method === m);
      const by = (s: string) => mean(rs.filter((r) => r.style === s).map((r) => r.score));
      const withGold = rs.filter((r) => r.anyCitationHit !== null);
      md.push(
        `| ${m} | ${pct(mean(rs.map((r) => r.score)))} | ${pct(by('lexical'))} | ${pct(by('paraphrase'))} | ${pct(by('absent'))} | ${pct(mean(rs.filter((r) => r.citationInGold !== null).map((r) => r.citationInGold)))} | ${pct(mean(withGold.map((r) => (r.anyCitationHit ? 1 : 0))))} | ${mean(rs.map((r) => r.totals.calls)).toFixed(1)} | ${Math.round(mean(rs.map((r) => r.totals.prompt)))} | ${mean(rs.map((r) => r.totals.costUsd)).toFixed(4)} | ${mean(rs.map((r) => r.totals.wallSec)).toFixed(1)} |`
      );
    }
    const agree = rows.filter((r) => r.method === 'full').flatMap((r) => r.checkerAgreement);
    if (agree.length) {
      const tp = agree.filter((a: any) => a.supported && a.inGold).length;
      const flagged = agree.filter((a: any) => !a.supported);
      md.push('', `引用核对（全文问答）：${agree.length} 处引用，${pct(agree.filter((a: any) => a.supported).length / agree.length)} 被判为有支撑；被判有支撑的引用里 ${pct(tp / Math.max(1, agree.filter((a: any) => a.supported).length))} 落在人工标的正确段；被判没支撑的 ${flagged.length} 处里 ${pct(flagged.filter((a: any) => !a.inGold).length / Math.max(1, flagged.length))} 确实不在正确段。`);
    }
    md.push('', '得分由阅卷模型按参考答案打（1 / 0.5 / 0）；“引用落在正确段”= 引用时间在人工标注的答案区间 ±10 秒内的比例。', '');
  }

  mkdirSync(path.join(ROOT, 'eval/results'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  writeFileSync(path.join(ROOT, `eval/results/real-${stamp}.json`), JSON.stringify(out, null, 2));
  writeFileSync(path.join(ROOT, 'eval/results/real-latest.md'), md.join('\n'));
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

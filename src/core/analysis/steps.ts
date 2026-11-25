import { asArray, asNumber, asObject, asString, asStringArray, chatJson } from '../llm/json';
import type { LlmClient } from '../llm/types';
import { formatTime, renderLines, type Chunk } from '../transcript/captions';
import { WATER_REASONS, type CaptionLine, type Chapter, type Segment, type VideoDigest, type WaterReason } from '../types';
import { segmentSource } from './grounding';

const MAP_SYSTEM = `你是视频内容编辑。你会拿到一段 B 站视频的字幕，每行格式为 [行号|时间] 文本。
把这段字幕切成若干连续片段，判断每段是“干货”(dry) 还是“注水”(water)，并只输出 JSON。

规则：
1. 片段按行号顺序首尾相接，覆盖给出的全部行，不重叠、不遗漏。每段通常 15~90 秒。
2. dry：有新信息、观点、步骤、数据、例子。water：寒暄闲聊(smalltalk)、重复啰嗦(repeat)、跑题(offtopic)、广告恰饭(ad)、无新信息(no_new_info)。
3. importance 取 1~5：跳过这段损失多大。water 段一般为 1。
4. title 不超过 16 个字；summary 1~2 句；keyPoints 0~3 条。全部只能使用字幕里出现过的信息，不要补充常识，不要翻译。
5. 字幕是自动识别的，可能有错别字，按上下文理解即可。

输出格式：
{"segments":[{"from":起始行号,"to":结束行号,"kind":"dry"|"water","importance":1-5,"title":"...","summary":"...","keyPoints":["..."],"waterReason":"smalltalk|repeat|offtopic|ad|no_new_info"}]}`;

function normalizeWaterReason(v: unknown): WaterReason {
  const s = asString(v).toLowerCase();
  return (WATER_REASONS as readonly string[]).includes(s) ? (s as WaterReason) : 'no_new_info';
}

/**
 * Turn the model's segments into a gap-free, non-overlapping cover of
 * [chunk.fromLine, chunk.toLine]. Models routinely skip a line, overlap by
 * one, or stop early; boundaries are snapped rather than rejected so a
 * near-miss still yields a usable heatmap.
 */
export function normalizeSegments(raw: unknown, chunk: Chunk, lines: CaptionLine[], videoId: string): Segment[] {
  const list = asArray(asObject(raw).segments, 'segments 数组')
    .map((x) => {
      const o = asObject(x, '片段对象');
      return {
        from: Math.round(asNumber(o.from, NaN)),
        to: Math.round(asNumber(o.to, NaN)),
        kind: asString(o.kind) === 'water' ? ('water' as const) : ('dry' as const),
        importance: Math.max(1, Math.min(5, Math.round(asNumber(o.importance, 3)))),
        title: asString(o.title).slice(0, 40),
        summary: asString(o.summary).slice(0, 400),
        keyPoints: asStringArray(o.keyPoints, 3).map((k) => k.slice(0, 160)),
        waterReason: normalizeWaterReason(o.waterReason)
      };
    })
    .filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to))
    .map((s) => ({ ...s, from: Math.max(chunk.fromLine, Math.min(chunk.toLine, s.from)), to: Math.max(chunk.fromLine, Math.min(chunk.toLine, s.to)) }))
    .filter((s) => s.to >= s.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  if (list.length === 0) throw new Error('没有有效片段');

  const out: Segment[] = [];
  let cursor = chunk.fromLine;
  for (const s of list) {
    if (s.to < cursor) continue; // fully covered by previous
    const from = cursor;
    const to = s.to;
    cursor = to + 1;
    out.push({
      id: `${videoId}@${from}`,
      fromLine: from,
      toLine: to,
      start: lines[from].from,
      end: lines[to].to,
      kind: s.kind,
      importance: s.kind === 'water' ? Math.min(s.importance, 2) : s.importance,
      title: s.title || (s.kind === 'water' ? '注水' : '片段'),
      summary: s.summary,
      keyPoints: s.keyPoints,
      ...(s.kind === 'water' ? { waterReason: s.waterReason } : {})
    });
    if (cursor > chunk.toLine) break;
  }
  if (cursor <= chunk.toLine) {
    const last = out[out.length - 1];
    last.toLine = chunk.toLine;
    last.end = lines[chunk.toLine].to;
  }
  return out;
}

export async function analyzeChunk(params: {
  llm: LlmClient;
  title: string;
  videoId: string;
  chunk: Chunk;
  lines: CaptionLine[];
  model?: string;
  signal?: AbortSignal;
}): Promise<Segment[]> {
  const { chunk, lines } = params;
  const body = renderLines(lines.slice(chunk.fromLine, chunk.toLine + 1));
  const user = `视频标题：${params.title}\n本段时间：${formatTime(chunk.start)}–${formatTime(chunk.end)}，行号 ${chunk.fromLine}–${chunk.toLine}\n\n${body}`;
  const { value } = await chatJson(
    params.llm,
    {
      purpose: `map:chunk-${chunk.index}`,
      model: params.model,
      signal: params.signal,
      temperature: 0.1,
      messages: [
        { role: 'system', content: MAP_SYSTEM },
        { role: 'user', content: user }
      ]
    },
    (raw) => normalizeSegments(raw, chunk, lines, params.videoId)
  );
  return value;
}

const DIGEST_SYSTEM = `你是视频内容编辑。你会拿到一个视频按时间顺序排列的片段摘要，格式为 #序号 [开始时间] 类型/重要度 标题：摘要。
请只输出 JSON：
{"tldr":"一句话说清这个视频讲了什么（不超过 60 字）","takeaways":["最值得记住的要点，3~6 条"],"chapters":[{"startSegment":序号,"title":"章节标题（不超过 14 字）","summary":"一句话"}]}
要求：章节按时间顺序、从 #0 开始；章节数大约是视频分钟数的 1/3，最少 2 个、最多 12 个；只用片段里出现的信息。`;

export async function buildDigest(params: {
  llm: LlmClient;
  title: string;
  segments: Segment[];
  durationSec: number;
  model?: string;
  signal?: AbortSignal;
}): Promise<Omit<VideoDigest, 'highlightIds'>> {
  const segs = params.segments;
  const perSeg = Math.max(40, Math.floor(16000 / Math.max(1, segs.length)));
  const listing = segs
    .map((s, i) => `#${i} [${formatTime(s.start)}] ${s.kind === 'dry' ? `干货/${s.importance}` : '注水'} ${s.title}：${s.summary}`.slice(0, perSeg))
    .join('\n');
  const { value } = await chatJson(
    params.llm,
    {
      purpose: 'reduce:digest',
      model: params.model,
      signal: params.signal,
      temperature: 0.2,
      messages: [
        { role: 'system', content: DIGEST_SYSTEM },
        { role: 'user', content: `视频标题：${params.title}\n时长：${formatTime(params.durationSec)}\n\n${listing}` }
      ]
    },
    (raw) => {
      const o = asObject(raw);
      const chaptersRaw = asArray(o.chapters, 'chapters 数组')
        .map((c) => asObject(c))
        .map((c) => ({ seg: Math.round(asNumber(c.startSegment, -1)), title: asString(c.title).slice(0, 30), summary: asString(c.summary).slice(0, 200) }))
        .filter((c) => c.seg >= 0 && c.seg < segs.length && c.title)
        .sort((a, b) => a.seg - b.seg)
        .filter((c, i, arr) => i === 0 || c.seg !== arr[i - 1].seg);
      if (chaptersRaw.length === 0) throw new Error('没有有效章节');
      chaptersRaw[0].seg = 0;
      const chapters: Chapter[] = chaptersRaw.map((c, i) => ({
        title: c.title,
        summary: c.summary,
        start: segs[c.seg].start,
        end: i + 1 < chaptersRaw.length ? segs[chaptersRaw[i + 1].seg].start : segs[segs.length - 1].end
      }));
      return { tldr: asString(o.tldr).slice(0, 200), takeaways: asStringArray(o.takeaways, 6), chapters };
    }
  );
  return value;
}

const VERIFY_SYSTEM = `你是事实核查员。给你一段字幕（[行号|时间] 文本）和一段对它的摘要，判断摘要是否被字幕支持。
只输出 JSON：{"verdict":"supported"|"partial"|"unsupported","reason":"不超过 30 字","evidence":[最能支撑摘要的行号，最多 3 个]}
supported：摘要的每个关键信息都能在字幕里找到；partial：部分能找到，或有轻微夸大；unsupported：主要信息字幕里没有。`;

export async function verifySegment(params: {
  llm: LlmClient;
  segment: Segment;
  lines: CaptionLine[];
  model?: string;
  signal?: AbortSignal;
}): Promise<{ verdict: 'supported' | 'partial' | 'unsupported'; reason: string; evidence: number[] }> {
  const s = params.segment;
  // Widen the window a little: speakers often state the point right before or after the boundary.
  const from = Math.max(0, s.fromLine - 3);
  const to = Math.min(params.lines.length - 1, s.toLine + 3);
  const { value } = await chatJson(
    params.llm,
    {
      purpose: 'verify',
      model: params.model,
      signal: params.signal,
      temperature: 0,
      messages: [
        { role: 'system', content: VERIFY_SYSTEM },
        { role: 'user', content: `字幕：\n${renderLines(params.lines.slice(from, to + 1), 5000)}\n\n摘要：${s.summary}\n要点：${s.keyPoints.join('；')}` }
      ]
    },
    (raw) => {
      const o = asObject(raw);
      const v = asString(o.verdict);
      const verdict = v === 'supported' || v === 'partial' || v === 'unsupported' ? v : 'partial';
      const evidence = Array.isArray(o.evidence)
        ? o.evidence.map((x) => Math.round(asNumber(x, -1))).filter((x) => x >= from && x <= to).slice(0, 3)
        : [];
      return { verdict, reason: asString(o.reason).slice(0, 80), evidence } as const;
    }
  );
  return value;
}

const REFINE_SYSTEM = `你是资深内容编辑。给你一段字幕和初稿摘要，请把它改写得更准确、信息更密，只用字幕里的信息。
只输出 JSON：{"title":"不超过 16 字","summary":"2~3 句","keyPoints":["2~4 条，每条一句"]}`;

export async function refineSegment(params: {
  llm: LlmClient;
  segment: Segment;
  lines: CaptionLine[];
  model?: string;
  signal?: AbortSignal;
}): Promise<Pick<Segment, 'title' | 'summary' | 'keyPoints'>> {
  const s = params.segment;
  const { value } = await chatJson(
    params.llm,
    {
      purpose: 'refine',
      model: params.model,
      signal: params.signal,
      temperature: 0.2,
      messages: [
        { role: 'system', content: REFINE_SYSTEM },
        { role: 'user', content: `字幕：\n${renderLines(params.lines.slice(s.fromLine, s.toLine + 1), 6000)}\n\n初稿：${s.title}｜${s.summary}｜${s.keyPoints.join('；')}` }
      ]
    },
    (raw) => {
      const o = asObject(raw);
      const summary = asString(o.summary);
      if (!summary) throw new Error('summary 为空');
      return { title: asString(o.title).slice(0, 40) || s.title, summary: summary.slice(0, 500), keyPoints: asStringArray(o.keyPoints, 4) };
    }
  );
  return value;
}

export { segmentSource };

import { asArray, asNumber, asObject, asString, asStringArray, parseJsonLoose } from '../llm/json';
import type { LlmClient, ReasoningLevel } from '../llm/types';
import { formatTime, renderLines } from '../transcript/captions';
import { WATER_REASONS, type CaptionLine, type Chapter, type OfficialSummary, type Segment, type VideoDigest, type VideoInfo, type WaterReason } from '../types';
import { scoreGrounding } from './grounding';

/**
 * Whole-video analysis in one streamed call.
 *
 * The model reads the entire transcript and writes one JSON object per line:
 * segments in order, then a digest. Reading everything at once is what makes
 * "repeat" detectable at all (a chunk cannot know it repeats an earlier one),
 * keeps importance on one scale across the video, and lets the model pick
 * highlights with the whole video in view. Streaming JSON Lines keeps the
 * heatmap filling in while the model writes.
 *
 * Transcripts longer than `maxChars` are analysed in consecutive windows, each
 * told what came before; the same path resumes an interrupted run.
 */

export interface AnalyzeOptions {
  model?: string;
  reasoning?: ReasoningLevel;
  /** Transcript characters per call. Bilibili videos under ~4 hours fit in one call on 1M-context models. */
  maxChars?: number;
  signal?: AbortSignal;
}

export interface AnalyzeHooks {
  /** Called whenever the set of finished segments grows (segments cover lines 0..last). */
  onSegments?: (segments: Segment[]) => void | Promise<void>;
}

export interface AnalyzeInput {
  video: Pick<VideoInfo, 'videoId' | 'title' | 'durationSec' | 'owner'>;
  lines: CaptionLine[];
  official?: OfficialSummary | null;
  /** Segments from an interrupted run; analysis continues after the last one. */
  resumeFrom?: Segment[];
}

export interface AnalyzeResult {
  segments: Segment[];
  digest: VideoDigest;
  calls: number;
}

const SEGMENT_SYSTEM = `你是视频内容编辑。你会拿到一个 B 站视频的完整字幕，每行格式为 [行号|时间] 文本。字幕是语音识别的，可能有同音错字。

任务：从头到尾把字幕切成首尾相接的片段，判断每段是干货还是注水，最后给出整片总结。

切分规则：
1. 片段按行号顺序首尾相接，覆盖全部字幕，不重叠、不遗漏。每段通常 20~120 秒，话题变了就切。
2. kind 取 "dry"（有新信息、观点、步骤、数据、例子）或 "water"（注水）。注水的 reason 取：smalltalk（开场寒暄、结尾求三连、闲聊）、ad（广告、恰饭、带货、推广自家课程或产品）、repeat（重复前面已经讲过的内容）、offtopic（跑题、与标题无关的个人经历）、no_new_info（空话、过渡、没有信息量）。
3. importance 取 1~5，表示跳过这段的损失，全片用同一把尺子：5 = 全片核心，3 = 有用的细节，1 = 跳过无损。注水段一般为 1。
4. title 不超过 16 个字；summary 一两句，只写字幕里出现过的信息，不补充常识，不评价。

输出 JSON Lines：每行一个 JSON 对象，不要代码块，不要其他文字。
每个片段一行：
{"t":"seg","from":起始行号,"to":结束行号,"kind":"dry","importance":4,"title":"…","summary":"…"}
{"t":"seg","from":起始行号,"to":结束行号,"kind":"water","reason":"ad","importance":1,"title":"…","summary":"…"}
全部片段之后，最后一行输出总结：
{"t":"digest","tldr":"一句话说清视频讲了什么（不超过 60 字）","takeaways":["最值得记住的要点，3~6 条"],"chapters":[{"from":起始行号,"title":"章节标题（不超过 14 字）"}],"highlights":[最值得看的干货片段的起始行号]}
章节按时间顺序、第一个从 0 行开始，数量约为视频分钟数的 1/3（2~12 个）。highlights 按价值从高到低，最多 {budget} 个，彼此不要挤在一起。`;

const CONTINUE_NOTE = `这是长视频的后半部分。前面的字幕已经分析过，片段标题如下（判断“重复”时参考）：
{previous}
请从行号 {from} 开始继续切分，规则不变。`;

/** How many highlights to ask for: about one per four minutes, 3–10. */
export function highlightBudget(durationSec: number): number {
  return Math.max(3, Math.min(10, Math.round(durationSec / 240)));
}

function officialBlock(official: OfficialSummary | null | undefined): string {
  if (!official || (!official.summary && official.outline.length === 0)) return '';
  const outline = official.outline.map((s) => `- [${formatTime(s.start)}] ${s.title}${s.points.length ? `：${s.points.map((p) => p.text).join('；')}` : ''}`).join('\n');
  return `\nB 站官方 AI 总结（可能不完整，仅供参考，以字幕为准）：\n${official.summary}${outline ? `\n${outline}` : ''}\n`;
}

function normalizeReason(v: unknown): WaterReason {
  const s = asString(v).toLowerCase();
  return (WATER_REASONS as readonly string[]).includes(s) ? (s as WaterReason) : 'no_new_info';
}

/**
 * Turns streamed segment objects into a gap-free, ordered cover of the lines.
 * Models occasionally skip a line, overlap by one, or restart numbering; the
 * cursor snaps every segment to start right after the previous one.
 */
export class SegmentAssembler {
  readonly segments: Segment[] = [];
  private cursor: number;

  constructor(
    private readonly videoId: string,
    private readonly lines: CaptionLine[],
    startLine = 0,
    private readonly lastLine = lines.length - 1
  ) {
    this.cursor = startLine;
  }

  get nextLine(): number {
    return this.cursor;
  }

  /** Returns true when the object was accepted as a segment. */
  push(raw: unknown): boolean {
    const o = asObject(raw);
    const to = Math.min(this.lastLine, Math.round(asNumber(o.to, NaN)));
    if (!Number.isFinite(to) || to < this.cursor) return false;
    const from = this.cursor;
    const kind = asString(o.kind) === 'water' ? 'water' : 'dry';
    const seg: Segment = {
      id: `${this.videoId}@${from}`,
      fromLine: from,
      toLine: to,
      start: this.lines[from].from,
      end: this.lines[to].to,
      kind,
      importance: Math.max(1, Math.min(5, Math.round(asNumber(o.importance, kind === 'water' ? 1 : 3)))),
      title: asString(o.title).slice(0, 40) || (kind === 'water' ? '注水' : '片段'),
      summary: asString(o.summary).slice(0, 400),
      keyPoints: asStringArray(o.keyPoints, 3),
      ...(kind === 'water' ? { waterReason: normalizeReason(o.reason ?? o.waterReason) } : {})
    };
    if (kind === 'water') seg.importance = Math.min(seg.importance, 2);
    seg.grounding = { lexical: scoreGrounding(seg, this.lines) };
    this.segments.push(seg);
    this.cursor = to + 1;
    return true;
  }

  /** Stretch the last segment over any lines the model left uncovered. */
  close(): void {
    const last = this.segments[this.segments.length - 1];
    if (last && this.cursor <= this.lastLine) {
      last.toLine = this.lastLine;
      last.end = this.lines[this.lastLine].to;
      this.cursor = this.lastLine + 1;
    }
  }
}

/** Splits streamed text into complete lines and yields the JSON objects found on them. */
export class JsonLinesReader {
  private buffer = '';
  push(text: string): unknown[] {
    this.buffer += text;
    const parts = this.buffer.split('\n');
    this.buffer = parts.pop() ?? '';
    return parts.flatMap((p) => JsonLinesReader.parse(p));
  }
  flush(): unknown[] {
    const rest = this.buffer;
    this.buffer = '';
    return JsonLinesReader.parse(rest);
  }
  private static parse(line: string): unknown[] {
    const t = line.trim().replace(/^```(json|jsonl)?/i, '').replace(/```$/, '').trim();
    if (!t.startsWith('{')) return [];
    try {
      return [parseJsonLoose(t)];
    } catch {
      return [];
    }
  }
}

interface RawDigest {
  tldr: string;
  takeaways: string[];
  chapters: Array<{ from: number; title: string }>;
  highlights: number[];
}

function readDigest(o: Record<string, unknown>): RawDigest {
  return {
    tldr: asString(o.tldr).slice(0, 200),
    takeaways: asStringArray(o.takeaways, 6),
    chapters: asArray(o.chapters ?? [], 'chapters')
      .map((c) => asObject(c))
      .map((c) => ({ from: Math.round(asNumber(c.from, -1)), title: asString(c.title).slice(0, 30) }))
      .filter((c) => c.from >= 0 && c.title),
    highlights: (Array.isArray(o.highlights) ? o.highlights : []).map((x) => Math.round(asNumber(x, -1))).filter((x) => x >= 0)
  };
}

function segmentAtLine(segments: Segment[], line: number): Segment | undefined {
  return segments.find((s) => s.fromLine <= line && line <= s.toLine);
}

/** Map the model's line-number digest onto real segments and times; drop anything invalid. */
export function buildDigest(raw: RawDigest | null, segments: Segment[], durationSec: number): VideoDigest {
  const budget = highlightBudget(durationSec);
  const highlightIds: string[] = [];
  for (const line of raw?.highlights ?? []) {
    const seg = segmentAtLine(segments, line);
    if (seg && seg.kind === 'dry' && !highlightIds.includes(seg.id)) highlightIds.push(seg.id);
    if (highlightIds.length >= budget) break;
  }
  const starts = (raw?.chapters ?? [])
    .map((c) => ({ seg: segmentAtLine(segments, c.from), title: c.title }))
    .filter((c): c is { seg: Segment; title: string } => Boolean(c.seg))
    .sort((a, b) => a.seg.start - b.seg.start)
    .filter((c, i, arr) => i === 0 || c.seg.id !== arr[i - 1].seg.id);
  if (starts.length) starts[0] = { ...starts[0], seg: segments[0] };
  const chapters: Chapter[] = starts.map((c, i) => ({
    title: c.title,
    summary: '',
    start: c.seg.start,
    end: i + 1 < starts.length ? starts[i + 1].seg.start : segments[segments.length - 1].end
  }));
  return { tldr: raw?.tldr ?? '', takeaways: raw?.takeaways ?? [], chapters, highlightIds };
}

/** Find where to cut long transcripts: windows of at most `maxChars`, on line boundaries. */
export function planWindows(lines: CaptionLine[], startLine: number, maxChars: number): Array<[number, number]> {
  const windows: Array<[number, number]> = [];
  let from = startLine;
  let chars = 0;
  for (let i = startLine; i < lines.length; i += 1) {
    chars += lines[i].text.length + 12;
    if (chars > maxChars && i > from) {
      windows.push([from, i - 1]);
      from = i;
      chars = lines[i].text.length + 12;
    }
  }
  if (from < lines.length) windows.push([from, lines.length - 1]);
  return windows;
}

export async function analyzeVideo(input: AnalyzeInput, deps: { llm: LlmClient }, options: AnalyzeOptions = {}, hooks: AnalyzeHooks = {}): Promise<AnalyzeResult> {
  const { video, lines } = input;
  if (lines.length === 0) throw new Error('没有字幕');
  const done = (input.resumeFrom ?? []).slice().sort((a, b) => a.fromLine - b.fromLine);
  const startLine = done.length ? done[done.length - 1].toLine + 1 : 0;
  const maxChars = options.maxChars ?? 300_000;
  const windows = startLine < lines.length ? planWindows(lines, startLine, maxChars) : [];
  const budget = highlightBudget(video.durationSec);
  const all: Segment[] = done.slice();
  let digestRaw: RawDigest | null = null;
  let calls = 0;

  for (const [from, to] of windows) {
    const assembler = new SegmentAssembler(video.videoId, lines, from, to);
    const reader = new JsonLinesReader();
    const continuing = from > 0;
    const header = `视频标题：${video.title}\n时长：${formatTime(video.durationSec)}${video.owner ? `\nUP 主：${video.owner}` : ''}\n${officialBlock(input.official)}`;
    const note = continuing
      ? `\n${CONTINUE_NOTE.replace('{previous}', all.map((s) => `- [${formatTime(s.start)}] ${s.title}`).join('\n').slice(-6000)).replace('{from}', String(from))}\n`
      : '';
    let published = 0;
    const take = (objs: unknown[]) => {
      for (const o of objs) {
        const rec = (o ?? {}) as Record<string, unknown>;
        if (rec.t === 'digest' || 'tldr' in rec) digestRaw = readDigest(rec);
        else assembler.push(o);
      }
      if (assembler.segments.length > published) {
        published = assembler.segments.length;
        void hooks.onSegments?.([...all, ...assembler.segments]);
      }
    };
    calls += 1;
    let streamed = false;
    const res = await deps.llm.chat(
      {
        purpose: windows.length > 1 ? `analyze:${from}-${to}` : 'analyze',
        model: options.model,
        reasoning: options.reasoning,
        signal: options.signal,
        temperature: 0.2,
        maxTokens: 32_000,
        messages: [
          { role: 'system', content: SEGMENT_SYSTEM.replace('{budget}', String(budget)) },
          { role: 'user', content: `${header}${note}\n字幕（行号 ${from}–${to}）：\n${renderLines(lines.slice(from, to + 1))}` }
        ]
      },
      (delta) => {
        streamed = true;
        take(reader.push(delta));
      }
    );
    // A provider that does not stream delivers everything at the end; parse it the same way.
    if (!streamed && res.content) take(reader.push(res.content));
    take(reader.flush());
    if (assembler.segments.length === 0) throw new Error('模型没有返回任何片段');
    assembler.close();
    all.push(...assembler.segments);
    await hooks.onSegments?.(all.slice());
  }

  const segments = all.slice();
  if (windows.length !== 1 || done.length > 0) {
    // The last window only saw part of the video; summarise from the full segment list instead.
    calls += 1;
    digestRaw = await digestFromSegments(deps.llm, video, segments, options).catch(() => digestRaw);
  }
  return { segments, digest: buildDigest(digestRaw, segments, video.durationSec), calls };
}

const DIGEST_SYSTEM = `你是视频内容编辑。你会拿到一个视频按时间顺序排列的片段列表，格式为 [起始行号|时间] 类型/重要度 标题：摘要。
只输出一个 JSON 对象：{"tldr":"一句话说清视频讲了什么（不超过 60 字）","takeaways":["最值得记住的要点，3~6 条"],"chapters":[{"from":起始行号,"title":"章节标题（不超过 14 字）"}],"highlights":[最值得看的干货片段的起始行号]}
章节按时间顺序、第一个从 0 行开始，数量约为视频分钟数的 1/3（2~12 个）。highlights 按价值从高到低，最多 {budget} 个，彼此不要挤在一起。只用列表里的信息。`;

async function digestFromSegments(llm: LlmClient, video: AnalyzeInput['video'], segments: Segment[], options: AnalyzeOptions): Promise<RawDigest> {
  const listing = segments
    .map((s) => `[${s.fromLine}|${formatTime(s.start)}] ${s.kind === 'dry' ? `干货/${s.importance}` : `注水/${s.waterReason}`} ${s.title}：${s.summary}`)
    .join('\n');
  const res = await llm.chat({
    purpose: 'digest',
    model: options.model,
    reasoning: options.reasoning,
    signal: options.signal,
    json: true,
    messages: [
      { role: 'system', content: DIGEST_SYSTEM.replace('{budget}', String(highlightBudget(video.durationSec))) },
      { role: 'user', content: `视频标题：${video.title}\n时长：${formatTime(video.durationSec)}\n\n${listing}` }
    ]
  });
  return readDigest(asObject(parseJsonLoose(res.content)));
}

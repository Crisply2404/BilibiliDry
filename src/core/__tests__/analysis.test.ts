import { describe, expect, it } from 'vitest';
import { analyzeVideo, buildDigest, highlightBudget, JsonLinesReader, planWindows, SegmentAssembler } from '../analysis/analyze';
import { lexicalGrounding } from '../analysis/grounding';
import { toMarkdown } from '../export/markdown';
import { parseJsonLoose } from '../llm/json';
import type { ChatRequest, ChatResult, LlmClient } from '../llm/types';
import { heatmap, nextDryStart, skipTarget } from '../playback';
import { cleanCaptions } from '../transcript/captions';
import type { Segment, VideoInfo } from '../types';

const lines = cleanCaptions(
  Array.from({ length: 40 }, (_, i) => ({ from: i * 5, to: i * 5 + 4.5, content: i < 5 ? `大家好欢迎来到频道${i}` : i >= 36 ? `记得一键三连${i}` : `注意力机制第${i}点：查询向量和键向量做点积` }))
);
const video: VideoInfo = { videoId: 'v_1', bvid: 'BV1xx411c7mD', aid: 1, cid: 1, page: 1, title: '注意力机制', durationSec: 200 };

function seg(p: Partial<Segment> & { start: number; end: number }): Segment {
  return { id: `s${p.start}`, fromLine: 0, toLine: 0, kind: 'dry', importance: 3, title: 't', summary: 's', keyPoints: [], ...p };
}

const base = { reasoning: '', toolCalls: [], usage: { promptTokens: 10, completionTokens: 10, estimated: false }, latencyMs: 1, finishReason: 'stop' };

/** Model that streams JSON Lines for whatever line range the prompt asks about. */
function streamingLlm(opts: { chunked?: boolean } = {}): LlmClient & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    model: 'fake',
    calls,
    async chat(req: ChatRequest, onDelta?: (t: string) => void): Promise<ChatResult> {
      calls.push(req);
      if (req.purpose === 'digest') return { ...base, model: 'fake', content: JSON.stringify({ tldr: '讲注意力', takeaways: ['点积'], chapters: [{ from: 0, title: '全部' }], highlights: [10] }) };
      const m = /行号 (\d+)–(\d+)/.exec(req.messages[1].content ?? '')!;
      const a = Number(m[1]);
      const b = Number(m[2]);
      const out: string[] = [];
      if (a === 0) out.push(JSON.stringify({ t: 'seg', from: 0, to: 4, kind: 'water', reason: 'smalltalk', importance: 1, title: '开场', summary: '打招呼' }));
      // Deliberate slips: a one-line gap and an overlap, which the assembler must snap.
      const s = a === 0 ? 6 : a;
      out.push(JSON.stringify({ t: 'seg', from: s, to: Math.min(b, 20), kind: 'dry', importance: 5, title: '点积', summary: '注意力机制：查询向量和键向量做点积' }));
      if (b > 20) out.push(JSON.stringify({ t: 'seg', from: 20, to: Math.min(b, 35), kind: 'dry', importance: 3, title: '细节', summary: '查询向量和键向量' }));
      if (b >= 36) out.push(JSON.stringify({ t: 'seg', from: 36, to: b, kind: 'water', reason: 'smalltalk', importance: 1, title: '结尾', summary: '求三连' }));
      out.push(JSON.stringify({ t: 'digest', tldr: '讲注意力', takeaways: ['点积'], chapters: [{ from: 0, title: '开场' }, { from: 6, title: '正文' }], highlights: [8, 25, 1] }));
      const text = (opts.chunked ? '```jsonl\n' : '') + out.join('\n') + (opts.chunked ? '\n```' : '');
      // Stream in odd-sized pieces so objects are split across deltas.
      for (let i = 0; i < text.length; i += 7) onDelta?.(text.slice(i, i + 7));
      return { ...base, model: 'fake', content: text };
    }
  };
}

describe('json and streaming helpers', () => {
  it('handles fences, prose and trailing commas', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('好的，结果如下：{"a":[1,2,],} 希望有帮助')).toEqual({ a: [1, 2] });
    expect(() => parseJsonLoose('{"a":')).toThrow();
  });

  it('reassembles JSON Lines split across stream chunks and skips junk lines', () => {
    const r = new JsonLinesReader();
    expect(r.push('{"t":"seg","fr')).toEqual([]);
    expect(r.push('om":0}\n这是一句话\n{"t":"di')).toEqual([{ t: 'seg', from: 0 }]);
    expect(r.flush()).toEqual([]);
    const r2 = new JsonLinesReader();
    r2.push('```jsonl\n{"a":1}\n');
    expect(r2.flush()).toEqual([]);
  });
});

describe('segment assembly', () => {
  it('snaps gaps and overlaps into a contiguous cover and derives times from captions', () => {
    const a = new SegmentAssembler('v', lines);
    a.push({ from: 0, to: 4, kind: 'water', reason: 'smalltalk', title: '开场' });
    a.push({ from: 6, to: 20, kind: 'dry', importance: 5, title: '正文', summary: '注意力机制' }); // gap at line 5
    a.push({ from: 18, to: 30, kind: 'dry', title: '重叠' }); // overlaps 18–20
    a.push({ from: 25, to: 28, kind: 'dry', title: '已覆盖' }); // fully covered: dropped
    a.close();
    expect(a.segments.map((s) => [s.fromLine, s.toLine])).toEqual([
      [0, 4],
      [5, 20],
      [21, 39]
    ]);
    expect(a.segments[1].start).toBe(lines[5].from);
    expect(a.segments[2].end).toBe(lines[39].to);
    expect(a.segments[0]).toMatchObject({ kind: 'water', waterReason: 'smalltalk', importance: 1 });
  });

  it('maps digest line numbers onto segments, keeps only dry highlights, and respects the budget', () => {
    const segs = [seg({ id: 'a', start: 0, end: 50, fromLine: 0, toLine: 9, kind: 'water' }), seg({ id: 'b', start: 50, end: 100, fromLine: 10, toLine: 19 }), seg({ id: 'c', start: 100, end: 200, fromLine: 20, toLine: 39 })];
    const d = buildDigest({ tldr: 'x', takeaways: [], chapters: [{ from: 12, title: '二' }, { from: 3, title: '一' }, { from: 99, title: '越界' }], highlights: [2, 15, 25, 16] }, segs, 200);
    expect(d.highlightIds).toEqual(['b', 'c']);
    expect(d.chapters.map((c) => [c.title, c.start])).toEqual([
      ['一', 0],
      ['二', 50]
    ]);
    expect(highlightBudget(60)).toBe(3);
    expect(highlightBudget(3600)).toBe(10);
  });

  it('cuts long transcripts into windows on line boundaries', () => {
    const w = planWindows(lines, 0, 200);
    expect(w[0][0]).toBe(0);
    expect(w[w.length - 1][1]).toBe(39);
    for (let i = 1; i < w.length; i += 1) expect(w[i][0]).toBe(w[i - 1][1] + 1);
    expect(planWindows(lines, 0, 1e9)).toEqual([[0, 39]]);
  });

  it('scores summaries that reuse the speaker words higher', () => {
    const src = '注意力机制的核心就是查询向量和键向量做点积';
    expect(lexicalGrounding('查询向量和键向量做点积', src)).toBeGreaterThan(0.8);
    expect(lexicalGrounding('介绍了卷积神经网络的池化层', src)).toBeLessThan(0.3);
  });
});

describe('analyzeVideo', () => {
  it('analyses the whole video in one streamed call and publishes segments as they arrive', async () => {
    const llm = streamingLlm();
    const seen: number[] = [];
    const res = await analyzeVideo({ video, lines }, { llm }, {}, { onSegments: (s) => void seen.push(s.length) });
    expect(llm.calls).toHaveLength(1);
    expect(res.calls).toBe(1);
    expect(res.segments.map((s) => [s.fromLine, s.toLine, s.kind])).toEqual([
      [0, 4, 'water'],
      [5, 20, 'dry'],
      [21, 35, 'dry'],
      [36, 39, 'water']
    ]);
    expect(seen.slice(0, 3)).toEqual([1, 2, 3]); // grew segment by segment while streaming
    expect(res.digest.tldr).toBe('讲注意力');
    expect(res.digest.highlightIds).toEqual(['v_1@5', 'v_1@21']); // line 1 is filler, so dropped
    expect(res.digest.chapters[0].start).toBe(0);
  });

  it('includes Bilibili\'s official summary as a hint when there is one', async () => {
    const llm = streamingLlm();
    await analyzeVideo({ video, lines, official: { summary: '官方：讲注意力', outline: [{ title: '点积', start: 30, points: [] }] } }, { llm });
    expect(llm.calls[0].messages[1].content).toContain('官方：讲注意力');
  });

  it('parses output wrapped in a code fence', async () => {
    const res = await analyzeVideo({ video, lines }, { llm: streamingLlm({ chunked: true }) });
    expect(res.segments.length).toBe(4);
  });

  it('splits a long transcript into windows, tells later windows what came before, and summarises at the end', async () => {
    const llm = streamingLlm();
    const res = await analyzeVideo({ video, lines }, { llm }, { maxChars: 600 });
    const windows = llm.calls.filter((c) => c.purpose?.startsWith('analyze'));
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[1].messages[1].content).toContain('前面的字幕已经分析过');
    expect(llm.calls[llm.calls.length - 1].purpose).toBe('digest');
    expect(res.segments[0].fromLine).toBe(0);
    expect(res.segments[res.segments.length - 1].toLine).toBe(39);
    for (let i = 1; i < res.segments.length; i += 1) expect(res.segments[i].fromLine).toBe(res.segments[i - 1].toLine + 1);
  });

  it('resumes after the last finished segment of an interrupted run', async () => {
    const first = await analyzeVideo({ video, lines }, { llm: streamingLlm() });
    const llm = streamingLlm();
    const res = await analyzeVideo({ video, lines, resumeFrom: first.segments.slice(0, 2) }, { llm });
    expect(llm.calls[0].messages[1].content).toContain('行号 21–39');
    expect(res.segments.slice(0, 2)).toEqual(first.segments.slice(0, 2));
    expect(res.segments[res.segments.length - 1].toLine).toBe(39);
  });

  it('fails clearly when the model returns no segments', async () => {
    const llm: LlmClient = { model: 'x', chat: async () => ({ ...base, model: 'x', content: '抱歉，我无法完成' }) };
    await expect(analyzeVideo({ video, lines }, { llm })).rejects.toThrow('没有返回任何片段');
  });

  it('exports markdown with timestamp links', async () => {
    const res = await analyzeVideo({ video, lines }, { llm: streamingLlm() });
    const md = toMarkdown(video, res.segments, res.digest);
    expect(md).toContain('# 注意力机制');
    expect(md).toMatch(/\[\d+:\d{2}\]\(https:\/\/www\.bilibili\.com\/video\/BV1xx411c7mD\?t=\d+\)/);
  });
});

describe('playback', () => {
  const segs = [
    seg({ start: 0, end: 10, kind: 'water', waterReason: 'smalltalk' }),
    seg({ start: 10, end: 20, kind: 'water', waterReason: 'ad' }),
    seg({ start: 20, end: 60 }),
    seg({ start: 60, end: 62, kind: 'water', waterReason: 'repeat' })
  ];
  it('skips a whole run of enabled filler in one jump', () => {
    expect(skipTarget(segs, 2, new Set(['smalltalk', 'ad']))).toBe(20);
    expect(skipTarget(segs, 2, new Set(['smalltalk']))).toBe(10);
    expect(skipTarget(segs, 30, new Set(['smalltalk']))).toBeNull();
  });
  it('ignores jumps that are too short', () => {
    expect(skipTarget(segs, 60.5, new Set(['repeat']))).toBeNull();
  });
  it('finds the next dry segment and builds a gap-aware heatmap', () => {
    expect(nextDryStart(segs, 5)).toBe(20);
    const cells = heatmap(segs, 100);
    expect(cells[cells.length - 1]).toMatchObject({ start: 62, end: 100, kind: 'unknown' });
  });
});

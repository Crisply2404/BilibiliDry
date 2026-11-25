import { describe, expect, it } from 'vitest';
import { lexicalGrounding } from '../analysis/grounding';
import { highlightBudget, selectHighlights } from '../analysis/highlights';
import { runAnalysis } from '../analysis/pipeline';
import { normalizeSegments } from '../analysis/steps';
import { parseJsonLoose } from '../llm/json';
import type { ChatRequest, ChatResult, LlmClient } from '../llm/types';
import { heatmap, nextDryStart, skipTarget } from '../playback';
import { Tracer } from '../trace/tracer';
import { cleanCaptions } from '../transcript/captions';
import type { Segment, VideoInfo } from '../types';
import { toMarkdown } from '../export/markdown';

const lines = cleanCaptions(Array.from({ length: 40 }, (_, i) => ({ from: i * 5, to: i * 5 + 4.5, content: i < 5 ? `大家好欢迎来到频道${i}` : `注意力机制第${i}点：查询向量和键向量做点积` })));
const chunk = { index: 0, fromLine: 0, toLine: 39, start: 0, end: 200 };

function seg(p: Partial<Segment> & { start: number; end: number }): Segment {
  return { id: `s${p.start}`, fromLine: 0, toLine: 0, kind: 'dry', importance: 3, title: 't', summary: 's', keyPoints: [], ...p };
}

describe('normalizeSegments', () => {
  it('snaps gaps and overlaps into a contiguous cover and derives times from captions', () => {
    const out = normalizeSegments(
      {
        segments: [
          { from: 0, to: 4, kind: 'water', importance: 1, title: '开场', summary: '打招呼', waterReason: 'smalltalk' },
          { from: 6, to: 20, kind: 'dry', importance: 5, title: '点积', summary: '查询和键做点积' },
          { from: 18, to: 30, kind: 'dry', importance: 3, title: '续', summary: '...' }
        ]
      },
      chunk,
      lines,
      'v'
    );
    expect(out[0].fromLine).toBe(0);
    expect(out[1].fromLine).toBe(5);
    expect(out[2].fromLine).toBe(21);
    expect(out[out.length - 1].toLine).toBe(39);
    expect(out[1].start).toBe(lines[5].from);
    expect(out[0].waterReason).toBe('smalltalk');
  });

  it('rejects output with no usable segments so the caller can repair', () => {
    expect(() => normalizeSegments({ segments: [] }, chunk, lines, 'v')).toThrow();
  });
});

describe('grounding and highlights', () => {
  it('scores summaries that reuse the speaker words higher', () => {
    const src = '查询向量和键向量做点积，再除以根号 d 做缩放';
    expect(lexicalGrounding('查询向量和键向量做点积后缩放', src)).toBeGreaterThan(0.7);
    expect(lexicalGrounding('卷积神经网络依靠池化层降采样', src)).toBeLessThan(0.3);
  });

  it('budget scales with duration', () => {
    expect(highlightBudget(300)).toBe(3);
    expect(highlightBudget(3600)).toBe(10);
  });

  it('spreads highlights across the timeline instead of clustering', () => {
    const segs = [
      seg({ start: 0, end: 30, importance: 5 }),
      seg({ start: 30, end: 60, importance: 5 }),
      seg({ start: 60, end: 90, importance: 5 }),
      seg({ start: 1000, end: 1030, importance: 4 }),
      seg({ start: 1100, end: 1130, kind: 'water', importance: 1 })
    ];
    const picked = selectHighlights(segs, 1200, 2);
    expect(picked.map((s) => s.start)).toContain(1000);
    expect(picked.every((s) => s.kind === 'dry')).toBe(true);
  });

  it('drops segments a judge found unsupported', () => {
    const s = seg({ start: 0, end: 30, importance: 5, grounding: { lexical: 0.9, verdict: 'unsupported' } });
    expect(selectHighlights([s], 300)).toHaveLength(0);
  });
});

describe('json parsing', () => {
  it('handles fences, prose and trailing commas', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('好的，结果如下：{"a":[1,2,],} 希望有帮助')).toEqual({ a: [1, 2] });
    expect(() => parseJsonLoose('{"a":')).toThrow();
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

/** Scripted model: answers map prompts with two segments per chunk, digest with one chapter. */
function scriptedLlm(failChunk = -1): LlmClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    model: 'fake',
    calls,
    async chat(req: ChatRequest): Promise<ChatResult> {
      calls.push(req.purpose ?? '');
      const base = { toolCalls: [], usage: { promptTokens: 10, completionTokens: 10, estimated: false }, model: req.model ?? 'fake', latencyMs: 1, finishReason: 'stop' };
      if (req.purpose?.startsWith('map:')) {
        const idx = Number(/chunk-(\d+)/.exec(req.purpose)![1]);
        if (idx === failChunk) return { ...base, content: 'not json at all' };
        const m = /行号 (\d+)–(\d+)/.exec(req.messages[1].content ?? '')!;
        const a = Number(m[1]);
        const b = Number(m[2]);
        const mid = Math.floor((a + b) / 2);
        return {
          ...base,
          content: JSON.stringify({
            segments: [
              { from: a, to: mid, kind: a === 0 ? 'water' : 'dry', importance: a === 0 ? 1 : 4, title: '片段', summary: '查询向量和键向量做点积', waterReason: 'smalltalk' },
              { from: mid + 1, to: b, kind: 'dry', importance: 5, title: '点积', summary: '注意力机制：查询向量和键向量做点积' }
            ]
          })
        };
      }
      if (req.purpose === 'reduce:digest') return { ...base, content: JSON.stringify({ tldr: '讲注意力', takeaways: ['点积'], chapters: [{ startSegment: 0, title: '全部', summary: '注意力' }] }) };
      if (req.purpose === 'verify') return { ...base, content: '{"verdict":"supported","reason":"ok","evidence":[6]}' };
      if (req.purpose === 'refine') return { ...base, content: '{"title":"精修","summary":"查询向量和键向量做点积得到注意力分数","keyPoints":["点积"]}' };
      return { ...base, content: '{}' };
    }
  };
}

const video: VideoInfo = { videoId: 'v_1', bvid: 'BV1xx411c7mD', aid: 1, cid: 1, page: 1, title: '注意力机制', durationSec: 200 };

describe('runAnalysis', () => {
  it('produces segments, digest and highlights, and refines with the strong model', async () => {
    const llm = scriptedLlm();
    const tracer = new Tracer({ kind: 'analysis', videoId: 'v_1', title: 't' });
    const checkpoints: number[] = [];
    const res = await runAnalysis({ video, lines }, { llm, tracer }, { chunkSec: 60, cheapModel: 'cheap', strongModel: 'strong' }, { onChunk: (c) => void checkpoints.push(c.index) });
    expect(res.failedChunks).toEqual([]);
    expect(checkpoints.length).toBe(res.chunks.length);
    expect(res.segments[0].kind).toBe('water');
    expect(res.digest?.chapters[0].start).toBe(0);
    expect(res.digest?.highlightIds.length).toBeGreaterThan(0);
    expect(res.segments.some((s) => s.refined)).toBe(true);
    expect(tracer.trace.spans.some((s) => s.name === 'map')).toBe(true);
  });

  it('resumes from a checkpoint without re-running finished chunks', async () => {
    const first = await runAnalysis({ video, lines }, { llm: scriptedLlm(), tracer: new Tracer({ kind: 'analysis', videoId: 'v', title: '' }) }, { chunkSec: 60 });
    const doneChunks = new Map(first.chunks.slice(0, 2).map((c) => [c.index, first.segments.filter((s) => s.fromLine >= c.fromLine && s.toLine <= c.toLine)]));
    const llm = scriptedLlm();
    await runAnalysis({ video, lines, checkpoint: { doneChunks } }, { llm, tracer: new Tracer({ kind: 'analysis', videoId: 'v', title: '' }) }, { chunkSec: 60 });
    expect(llm.calls.filter((c) => c.startsWith('map:')).length).toBe(first.chunks.length - 2);
  });

  it('reports a chunk that keeps failing instead of failing the run', async () => {
    const res = await runAnalysis({ video, lines }, { llm: scriptedLlm(1), tracer: new Tracer({ kind: 'analysis', videoId: 'v', title: '' }) }, { chunkSec: 60 });
    expect(res.failedChunks).toEqual([1]);
    expect(res.segments.length).toBeGreaterThan(0);
  });

  it('exports markdown with timestamp links', async () => {
    const res = await runAnalysis({ video, lines }, { llm: scriptedLlm(), tracer: new Tracer({ kind: 'analysis', videoId: 'v', title: '' }) }, { chunkSec: 60 });
    const md = toMarkdown(video, res.segments, res.digest);
    expect(md).toContain('# 注意力机制');
    expect(md).toMatch(/\[\d+:\d{2}\]\(https:\/\/www\.bilibili\.com\/video\/BV1xx411c7mD\?t=\d+\)/);
  });
});

import { describe, expect, it } from 'vitest';
import { contentWords, tokenize } from '../text/tokenize';
import { buildPassages, chunkCaptions, cleanCaptions, formatTime, parseTime } from '../transcript/captions';
import { Bm25Index } from '../retrieval/bm25';
import { mmr, rangeOverlap, reciprocalRankFusion } from '../retrieval/fusion';
import { attachContext, HybridRetriever } from '../retrieval/hybrid';

const raw = (texts: string[], step = 4) => texts.map((content, i) => ({ from: i * step, to: i * step + step - 0.5, content }));

describe('tokenize', () => {
  it('segments Chinese into words and adds bigrams for long words', () => {
    const t = tokenize('自注意力机制是Transformer的核心');
    expect(t).toContain('transformer');
    expect(t.some((x) => x.includes('注意'))).toBe(true);
    expect(t).not.toContain('的');
  });

  it('extracts content words without stopwords', () => {
    expect(contentWords('我们今天讲一下 BM25 的原理')).toEqual(expect.arrayContaining(['bm25', '原理']));
  });
});

describe('captions', () => {
  it('drops empty lines and merges duplicated consecutive cues', () => {
    const lines = cleanCaptions([
      { from: 0, to: 2, content: '大家好' },
      { from: 2, to: 3, content: '大家好' },
      { from: 3, to: 4, content: '  ' },
      { from: 4, to: 6, content: '今天讲红烧肉' }
    ]);
    expect(lines.map((l) => l.text)).toEqual(['大家好', '今天讲红烧肉']);
    expect(lines[0].to).toBe(3);
    expect(lines.map((l) => l.idx)).toEqual([0, 1]);
  });

  it('chunks cover every line exactly once', () => {
    const lines = cleanCaptions(raw(Array.from({ length: 200 }, (_, i) => `第${i}句话。`)));
    const chunks = chunkCaptions(lines, 60);
    expect(chunks[0].fromLine).toBe(0);
    expect(chunks[chunks.length - 1].toLine).toBe(199);
    for (let i = 1; i < chunks.length; i += 1) expect(chunks[i].fromLine).toBe(chunks[i - 1].toLine + 1);
    for (const c of chunks) expect(c.end - c.start).toBeLessThanOrEqual(61);
  });

  it('builds overlapping passages that reach the end', () => {
    const lines = cleanCaptions(raw(Array.from({ length: 50 }, (_, i) => `句子${i}`)));
    const ps = buildPassages('v', lines, 40);
    expect(ps[ps.length - 1].toLine).toBe(49);
    expect(ps[1].fromLine).toBeLessThanOrEqual(ps[0].toLine);
  });

  it('formats and parses times', () => {
    expect(formatTime(75)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(parseTime('1:02:05')).toBe(3725);
    expect(parseTime('12:30')).toBe(750);
    expect(parseTime('abc')).toBeNull();
  });
});

describe('bm25 and fusion', () => {
  it('ranks the passage that contains rare query terms first', () => {
    const idx = new Bm25Index();
    idx.add('a', '红烧肉要先炒糖色，冰糖小火慢慢炒');
    idx.add('b', '今天天气不错，我们去公园散步');
    idx.add('c', '焯水的时候放姜片和料酒');
    expect(idx.search('糖色怎么炒')[0].id).toBe('a');
    expect(idx.search('料酒')[0].id).toBe('c');
  });

  it('RRF rewards items found by both retrievers', () => {
    const fused = reciprocalRankFusion([
      [{ id: 'x', score: 9 }, { id: 'y', score: 5 }],
      [{ id: 'y', score: 0.9 }, { id: 'z', score: 0.8 }]
    ]);
    expect(fused[0].id).toBe('y');
  });

  it('MMR avoids near-duplicate picks', () => {
    const items = [
      { id: 1, r: 1.0, pos: 0 },
      { id: 2, r: 0.95, pos: 0.1 },
      { id: 3, r: 0.6, pos: 10 }
    ];
    const picked = mmr({ candidates: items, relevance: (x) => x.r, similarity: (a, b) => (Math.abs(a.pos - b.pos) < 1 ? 1 : 0), k: 2, lambda: 0.5 });
    expect(picked.map((x) => x.id)).toEqual([1, 3]);
  });

  it('rangeOverlap is Jaccard on line ranges', () => {
    expect(rangeOverlap({ fromLine: 0, toLine: 9 }, { fromLine: 5, toLine: 14 })).toBeCloseTo(5 / 15);
    expect(rangeOverlap({ fromLine: 0, toLine: 3 }, { fromLine: 4, toLine: 5 })).toBe(0);
  });

  it('hybrid retriever filters by video and uses segment context', () => {
    const lines = cleanCaptions(raw(['先把肉切块', '冷水下锅', '加入料酒去腥', '水开撇去浮沫']));
    const ps = attachContext(buildPassages('v1', lines, 8), [{ fromLine: 0, toLine: 3, title: '焯水', summary: '用冷水焯水去除血沫' }]);
    const other = buildPassages('v2', cleanCaptions(raw(['焯水去血沫'])), 8);
    const r = new HybridRetriever([...ps, ...other]);
    const hits = r.search('焯水', null, { k: 3, videoIds: ['v1'] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.passage.videoId === 'v1')).toBe(true);
  });
});

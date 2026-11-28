import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createBilibiliClient, parseOfficial, subtitleMismatch } from '../bilibili/api';
import { readLocation } from '../../content/page';
import { md5, mixinKey, signQuery } from '../bilibili/wbi';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('wbi signing', () => {
  it('computes md5 like node:crypto', () => {
    for (const s of ['', 'abc', '中文 BilibiliDry', 'x'.repeat(64), '字'.repeat(300)]) expect(md5(s)).toBe(createHash('md5').update(s).digest('hex'));
  });

  it('signs like the public reference example', () => {
    // Example from the community API docs: fixed mixin key and wts.
    expect(signQuery({ foo: '114', bar: '514', zab: 1919810 }, 'ea1db124af3c7062474693fa704f4ff8', 1702204169000)).toBe('bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
    expect(mixinKey('https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png')).toHaveLength(32);
  });
});

describe('subtitle sanity check', () => {
  const track = (last: number) => [
    { from: 0, to: 5, content: 'a' },
    { from: last - 5, to: last, content: 'b' }
  ];
  it('rejects tracks far longer or far shorter than the video', () => {
    expect(subtitleMismatch(track(1346), 589)).toMatch(/1346/);
    expect(subtitleMismatch(track(9.5), 907)).toMatch(/只覆盖/);
    expect(subtitleMismatch(track(586), 589)).toBeNull();
    expect(subtitleMismatch([], 589)).toBe('字幕为空');
  });
});

describe('bilibili client', () => {
  const view = { code: 0, data: { bvid: 'BV1aaaaaaaaa', aid: 1, cid: 2, title: '视频', duration: 100, owner: { name: 'UP', mid: 3 }, pages: [{ cid: 2, page: 1, part: 'P1', duration: 100 }] } };
  const nav = { code: -101, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } };
  const conclusion = {
    code: 0,
    data: {
      code: 0,
      model_result: {
        summary: '官方总结',
        outline: [{ title: '第一部分', timestamp: 0, part_outline: [{ timestamp: 10, content: '要点' }] }],
        subtitle: [{ part_subtitle: [{ start_timestamp: 0, end_timestamp: 50, content: '前半' }, { start_timestamp: 50, end_timestamp: 99, content: '后半' }] }]
      }
    }
  };

  function client(routes: Record<string, () => Response>) {
    const seen: string[] = [];
    const c = createBilibiliClient({
      fetchImpl: async (input) => {
        const url = String(input);
        seen.push(url);
        const key = Object.keys(routes).find((k) => url.includes(k));
        return key ? routes[key]() : json({ code: -404 }, 404);
      }
    });
    return { c, seen };
  }

  it('prefers the AI-summary API: summary, outline and the subtitle bound to this video', async () => {
    const { c, seen } = client({ '/x/web-interface/view?': () => json(view), '/nav': () => json(nav), 'conclusion/get': () => json(conclusion) });
    const m = await c.materials('BV1aaaaaaaaa', 1);
    expect(m.official).toEqual(parseOfficial(conclusion.data.model_result));
    expect(m.official?.outline[0].points[0]).toEqual({ time: 10, text: '要点' });
    expect(m.transcript.source).toBe('official');
    expect(m.transcript.raw.map((l) => l.content)).toEqual(['前半', '后半']);
    expect(seen.find((u) => u.includes('conclusion'))).toMatch(/w_rid=[0-9a-f]{32}/);
    expect(seen.some((u) => u.includes('player'))).toBe(false);
  });

  it('falls back to the signed player subtitle when the summary API is rate limited', async () => {
    const { c, seen } = client({
      '/x/web-interface/view?': () => json(view),
      '/nav': () => json(nav),
      'conclusion/get': () => new Response('<!doctype html>', { status: 412 }),
      '/x/player/wbi/v2': () => json({ code: 0, data: { subtitle: { subtitles: [{ lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/x.json' }] } } }),
      'aisubtitle.hdslb.com': () => json({ body: [{ from: 0, to: 40, content: '一' }, { from: 40, to: 98, content: '二' }] })
    });
    const m = await c.materials('BV1aaaaaaaaa', 1);
    expect(m.official).toBeNull();
    expect(m.transcript.source).toBe('player');
    expect(seen.find((u) => u.includes('player/wbi/v2'))).toMatch(/w_rid=/);
  });

  it('refuses a player subtitle that cannot belong to this video', async () => {
    const { c } = client({
      '/x/web-interface/view?': () => json(view),
      '/nav': () => json(nav),
      'conclusion/get': () => json({ code: 0, data: { code: -1 } }),
      '/x/player/wbi/v2': () => json({ code: 0, data: { subtitle: { subtitles: [{ lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/x.json' }] } } }),
      'aisubtitle.hdslb.com': () => json({ body: [{ from: 0, to: 40, content: '一' }, { from: 900, to: 1300, content: '别的视频' }] })
    });
    await expect(c.materials('BV1aaaaaaaaa', 1)).rejects.toMatchObject({ code: 'mismatch' });
  });
});

describe('video page URLs', () => {
  it('reads the video and part, with or without a language prefix', () => {
    expect(readLocation('https://www.bilibili.com/video/BV1ZKxC6EE5k/?p=2')).toEqual({ bvid: 'BV1ZKxC6EE5k', page: 2 });
    expect(readLocation('https://www.bilibili.com/zh-Hans/video/BV1ZKxC6EE5k/')).toEqual({ bvid: 'BV1ZKxC6EE5k', page: 1 });
    expect(readLocation('https://www.bilibili.com/en/video/BV1ZKxC6EE5k/')).toEqual({ bvid: 'BV1ZKxC6EE5k', page: 1 });
    expect(readLocation('https://www.bilibili.com/')).toBeNull();
  });
});

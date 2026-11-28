/**
 * Answers the two kinds of network calls the extension makes, Bilibili's APIs and the model
 * API, from local data. Everything else goes to the real network untouched.
 */
import { handleChatCompletion } from './scriptedModel';
import { blockAt, videoByBvid, type DemoVideo } from './videos';

export const DEMO_MODEL_BASE = 'https://model.demo.invalid/v1';
const MODEL_HOST = new URL(DEMO_MODEL_BASE).host;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What Bilibili's AI-summary API would return: a summary, a timestamped outline, the subtitles. */
function conclusion(v: DemoVideo) {
  const outline = v.digest.chapters.map((c) => {
    const span = v.built.spans.get(c.block)!;
    const blocks = v.built.fixture.blocks.filter((b) => b.kind === 'dry' && blockAt(v, v.built.spans.get(b.id)!.start + 0.5) === b.id);
    const inChapter = blocks.filter((b) => {
      const s = v.built.spans.get(b.id)!;
      const next = v.digest.chapters[v.digest.chapters.indexOf(c) + 1];
      return s.start >= span.start && (!next || s.start < v.built.spans.get(next.block)!.start);
    });
    return { title: c.title, timestamp: Math.floor(span.start), part_outline: inChapter.slice(0, 3).map((b) => ({ timestamp: Math.floor(v.built.spans.get(b.id)!.start), content: v.notes[b.id].title })) };
  });
  return {
    code: 0,
    data: {
      code: 0,
      model_result: {
        summary: v.official,
        outline,
        subtitle: [{ part_subtitle: v.built.lines.map((l) => ({ start_timestamp: Math.floor(l.from), end_timestamp: Math.ceil(l.to), content: l.text })) }]
      }
    }
  };
}

async function bilibili(url: URL): Promise<Response> {
  await wait(200);
  const v = videoByBvid(url.searchParams.get('bvid') ?? '');
  if (url.pathname === '/x/web-interface/nav') {
    return json({ code: -101, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } });
  }
  if (!v) return json({ code: -404, message: '演示里只有两个视频' });
  const d = v.built.video.durationSec;
  if (url.pathname === '/x/web-interface/view') {
    return json({ code: 0, data: { bvid: v.bvid, aid: v.aid, cid: v.cid, title: v.built.video.title, duration: d, owner: { name: v.owner, mid: v.aid }, pages: [{ cid: v.cid, page: 1, part: 'P1', duration: d }] } });
  }
  if (url.pathname === '/x/web-interface/view/conclusion/get') return json(conclusion(v));
  if (url.pathname.startsWith('/x/player/')) {
    return json({ code: 0, data: { subtitle: { subtitles: [{ lan: 'ai-zh', subtitle_url: `//aisubtitle.hdslb.com/bfs/demo/${v.bvid}.json` }] } } });
  }
  return json({ code: -404, message: 'not in demo' });
}

async function subtitle(url: URL): Promise<Response> {
  await wait(150);
  const v = videoByBvid(/\/(BV[0-9A-Za-z]{10})\.json$/.exec(url.pathname)?.[1] ?? '');
  return json({ body: (v?.built.lines ?? []).map((l) => ({ from: l.from, to: l.to, content: l.text })) });
}

export function installFakeNetwork(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.host === 'api.bilibili.com') return bilibili(url);
    if (url.host === 'aisubtitle.hdslb.com') return subtitle(url);
    if (url.host === MODEL_HOST) {
      if (url.pathname.endsWith('/chat/completions')) return handleChatCompletion(JSON.parse(String(init?.body ?? '{}')), init?.signal ?? undefined);
      if (url.pathname.endsWith('/models')) return json({ data: [{ id: 'demo-flash' }] });
      return new Response('{"error":"not found"}', { status: 404 });
    }
    return realFetch(input, init);
  };
}

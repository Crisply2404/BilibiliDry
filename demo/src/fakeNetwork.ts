/**
 * Answers the two kinds of network calls the extension makes, Bilibili's
 * video/subtitle APIs and the model API, from local data. Everything else
 * goes to the real network untouched.
 */
import { handleChatCompletion } from './scriptedModel';
import { videoByBvid } from './videos';

export const DEMO_MODEL_BASE = 'https://model.demo.invalid/v1';
const MODEL_HOST = new URL(DEMO_MODEL_BASE).host;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bilibili(url: URL): Promise<Response> {
  await wait(250);
  const bvid = url.searchParams.get('bvid') ?? '';
  const v = videoByBvid(bvid);
  if (url.pathname === '/x/web-interface/view') {
    if (!v) return json({ code: -404, message: '演示里只有两个视频' });
    const d = v.built.video.durationSec;
    return json({
      code: 0,
      data: { bvid: v.bvid, aid: v.aid, cid: v.cid, title: v.built.video.title, duration: d, owner: { name: v.owner }, pages: [{ cid: v.cid, page: 1, part: 'P1', duration: d }] }
    });
  }
  if (url.pathname.startsWith('/x/player/')) {
    if (!v) return json({ code: -404, message: '没有这个视频' });
    return json({ code: 0, data: { subtitle: { subtitles: [{ lan: 'ai-zh', subtitle_url: `//aisubtitle.hdslb.com/bfs/demo/${v.bvid}.json` }] } } });
  }
  return json({ code: -404, message: 'not in demo' });
}

async function subtitle(url: URL): Promise<Response> {
  await wait(200);
  const bvid = /\/(BV[0-9A-Za-z]{10})\.json$/.exec(url.pathname)?.[1] ?? '';
  const v = videoByBvid(bvid);
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
      if (url.pathname.endsWith('/models')) return json({ data: [{ id: 'demo-strong' }, { id: 'demo-mini' }] });
      return new Response('{"error":"not found"}', { status: 404 });
    }
    return realFetch(input, init);
  };
}

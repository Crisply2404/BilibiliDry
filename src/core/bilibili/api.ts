import type { RawCaption } from '../transcript/captions';
import type { OfficialSummary, VideoInfo } from '../types';
import { mixinKey, signQuery } from './wbi';

/**
 * Everything BilibiliDry reads from Bilibili, behind one small client so the extension, the
 * eval scripts and the demo can share it (pass your own `fetchImpl`).
 *
 * Transcript sources, best first:
 * 1. The AI-summary API (`view/conclusion/get`, WBI-signed, needs login). It returns the
 *    summary, a timestamped outline and the subtitle track, all bound to this bvid + cid.
 * 2. The player API's subtitle list. Unsigned calls are known to hand back another video's
 *    subtitles; the signed call is used and the result is checked against the video's length.
 */

export class BilibiliError extends Error {
  constructor(
    message: string,
    readonly code: 'no_subtitle' | 'need_login' | 'network' | 'rate_limited' | 'mismatch'
  ) {
    super(message);
    this.name = 'BilibiliError';
  }
}

export interface Transcript {
  raw: RawCaption[];
  source: 'official' | 'player';
  lang?: string;
}

export interface VideoMaterials {
  info: VideoInfo;
  official: OfficialSummary | null;
  transcript: Transcript;
}

const API = 'https://api.bilibili.com';

export function createBilibiliClient(opts: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = opts.now ?? Date.now;
  let wbiKey: { key: string; at: number } | null = null;

  async function getJson(url: string, credentials: RequestCredentials = 'include'): Promise<any> {
    let res: Response;
    try {
      res = await fetchImpl(url, { credentials });
    } catch (err) {
      throw new BilibiliError(`无法连接 B 站：${(err as Error).message}`, 'network');
    }
    if (res.status === 412) throw new BilibiliError('B 站暂时限制了请求（412），稍后再试', 'rate_limited');
    if (!res.ok) throw new BilibiliError(`B 站接口 HTTP ${res.status}`, 'network');
    const text = await res.text();
    if (!text.startsWith('{')) throw new BilibiliError('B 站返回了网页而不是数据，可能触发了风控', 'rate_limited');
    return JSON.parse(text);
  }

  async function key(force = false): Promise<string> {
    if (!force && wbiKey && now() - wbiKey.at < 6 * 3600_000) return wbiKey.key;
    const nav = await getJson(`${API}/x/web-interface/nav`);
    const img = nav?.data?.wbi_img;
    if (!img?.img_url) throw new BilibiliError('拿不到 WBI 签名密钥', 'network');
    wbiKey = { key: mixinKey(img.img_url, img.sub_url), at: now() };
    return wbiKey.key;
  }

  async function signed(path: string, params: Record<string, string | number>): Promise<any> {
    const json = await getJson(`${API}${path}?${signQuery(params, await key(), now())}`);
    if (json?.code === -352 || json?.code === -403) {
      // Keys rotate; refresh once.
      return getJson(`${API}${path}?${signQuery(params, await key(true), now())}`);
    }
    return json;
  }

  async function videoInfo(bvid: string, page: number): Promise<VideoInfo & { mid?: number }> {
    const json = await getJson(`${API}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
    if (json?.code !== 0 || !json.data) throw new Error(`获取视频信息失败：${json?.message ?? '未知错误'}`);
    const d = json.data;
    const pages: any[] = Array.isArray(d.pages) ? d.pages : [];
    const part = pages.find((p) => Number(p.page) === page) ?? pages[0];
    const cid = Number(part?.cid ?? d.cid);
    return {
      videoId: `${d.bvid}_${cid}`,
      bvid: d.bvid,
      aid: Number(d.aid),
      cid,
      page: Number(part?.page ?? 1),
      title: String(d.title ?? bvid),
      partTitle: pages.length > 1 ? String(part?.part ?? '') : undefined,
      owner: d.owner?.name ? String(d.owner.name) : undefined,
      mid: d.owner?.mid ? Number(d.owner.mid) : undefined,
      durationSec: Number(part?.duration ?? d.duration ?? 0),
      cover: d.pic ? String(d.pic).replace(/^http:/, 'https:') : undefined
    };
  }

  /** Bilibili's own AI summary + its subtitle track. Null when the video has none. */
  async function official(info: { bvid: string; cid: number; mid?: number }): Promise<{ summary: OfficialSummary; raw: RawCaption[] } | null> {
    const json = await signed('/x/web-interface/view/conclusion/get', { bvid: info.bvid, cid: info.cid, up_mid: info.mid ?? 0 });
    if (json?.code === -101) throw new BilibiliError('需要登录 B 站', 'need_login');
    const m = json?.data?.model_result;
    if (json?.code !== 0 || json?.data?.code !== 0 || !m) return null;
    return { summary: parseOfficial(m), raw: parseOfficialSubtitle(m) };
  }

  async function playerSubtitle(info: { aid: number; cid: number; bvid: string; durationSec: number }): Promise<Transcript> {
    const json = await signed('/x/player/wbi/v2', { aid: info.aid, cid: info.cid, bvid: info.bvid });
    if (json?.code !== 0 || !json.data) throw new BilibiliError(`获取字幕列表失败：${json?.message ?? '未知错误'}`, 'network');
    const subs: any[] = json.data.subtitle?.subtitles ?? [];
    if (subs.length === 0) {
      if (json.data.need_login_subtitle) throw new BilibiliError('这个视频的字幕需要登录 B 站后才能获取', 'need_login');
      throw new BilibiliError('这个视频没有字幕（也没有 AI 字幕），暂时无法分析', 'no_subtitle');
    }
    const chosen = subs.slice().sort((a, b) => rankSubtitle(a) - rankSubtitle(b))[0];
    const url = String(chosen.subtitle_url ?? '');
    if (!url) throw new BilibiliError('字幕地址为空，请登录 B 站后重试', 'need_login');
    const body = await getJson(url.startsWith('//') ? `https:${url}` : url, 'omit');
    const raw: RawCaption[] = (body?.body ?? []).map((l: any) => ({ from: Number(l.from), to: Number(l.to), content: String(l.content ?? '') }));
    const problem = subtitleMismatch(raw, info.durationSec);
    if (problem) throw new BilibiliError(`B 站返回的字幕和这个视频对不上（${problem}），请登录后刷新重试`, 'mismatch');
    return { raw, source: 'player', lang: String(chosen.lan ?? '') };
  }

  /** Video info, the official summary when there is one, and the best transcript available. */
  async function materials(bvid: string, page: number): Promise<VideoMaterials> {
    const info = await videoInfo(bvid, page);
    let off: Awaited<ReturnType<typeof official>> = null;
    try {
      off = await official(info);
    } catch (err) {
      if (err instanceof BilibiliError && err.code === 'need_login') throw err;
      // Rate limits or API changes: fall back to the player's subtitles.
    }
    if (off && off.raw.length > 0 && !subtitleMismatch(off.raw, info.durationSec)) {
      return { info, official: off.summary, transcript: { raw: off.raw, source: 'official', lang: 'ai-zh' } };
    }
    return { info, official: off?.summary ?? null, transcript: await playerSubtitle(info) };
  }

  return { videoInfo, official, playerSubtitle, materials };
}

function rankSubtitle(s: any): number {
  const lan = String(s?.lan ?? '').toLowerCase();
  if (lan === 'zh-cn' || lan === 'zh-hans') return 0;
  if (lan.startsWith('zh')) return 1;
  if (lan === 'ai-zh') return 2;
  if (lan.startsWith('ai-')) return 4;
  return 3;
}

/**
 * Cheap sanity check that a subtitle track belongs to a video of this length. It catches most
 * of the player API's wrong-video answers (tracks far longer or far shorter than the video),
 * though not a wrong track of similar length.
 */
export function subtitleMismatch(raw: RawCaption[], durationSec: number): string | null {
  if (raw.length === 0) return '字幕为空';
  if (!durationSec) return null;
  const last = Math.max(...raw.map((l) => l.to));
  if (last > durationSec + 15) return `字幕到 ${Math.round(last)} 秒，视频只有 ${Math.round(durationSec)} 秒`;
  if (durationSec > 120 && last < durationSec * 0.3) return `字幕只覆盖到 ${Math.round(last)} 秒`;
  return null;
}

export function parseOfficial(m: any): OfficialSummary {
  const outline = (Array.isArray(m?.outline) ? m.outline : []).map((o: any) => ({
    title: String(o?.title ?? ''),
    start: Number(o?.timestamp ?? 0),
    points: (Array.isArray(o?.part_outline) ? o.part_outline : []).map((p: any) => ({ time: Number(p?.timestamp ?? 0), text: String(p?.content ?? '') }))
  }));
  return { summary: String(m?.summary ?? ''), outline };
}

export function parseOfficialSubtitle(m: any): RawCaption[] {
  return (Array.isArray(m?.subtitle) ? m.subtitle : [])
    .flatMap((s: any) => (Array.isArray(s?.part_subtitle) ? s.part_subtitle : []))
    .map((l: any) => ({ from: Number(l?.start_timestamp ?? 0), to: Number(l?.end_timestamp ?? 0), content: String(l?.content ?? '') }))
    .filter((l: RawCaption) => l.content.trim());
}

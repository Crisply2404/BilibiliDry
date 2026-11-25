import type { RawCaption } from '../core/transcript/captions';
import type { VideoInfo } from '../core/types';

export class CaptionError extends Error {
  constructor(
    message: string,
    readonly code: 'no_subtitle' | 'need_login' | 'network'
  ) {
    super(message);
    this.name = 'CaptionError';
  }
}

async function getJson(url: string, credentials: RequestCredentials = 'include'): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { credentials });
  } catch (err) {
    throw new CaptionError(`无法连接 B 站：${(err as Error).message}`, 'network');
  }
  if (!res.ok) throw new CaptionError(`B 站接口 HTTP ${res.status}`, 'network');
  return res.json();
}

/** Resolve a BV id + part number to the concrete part (cid) and its metadata. */
export async function fetchVideoInfo(bvid: string, page: number): Promise<VideoInfo> {
  const json = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
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
    durationSec: Number(part?.duration ?? d.duration ?? 0),
    cover: d.pic ? String(d.pic).replace(/^http:/, 'https:') : undefined
  };
}

function rankSubtitle(s: any): number {
  const lan = String(s?.lan ?? '').toLowerCase();
  // Human-made Chinese first, then AI Chinese, then anything else.
  if (lan === 'zh-cn' || lan === 'zh-hans') return 0;
  if (lan.startsWith('zh')) return 1;
  if (lan === 'ai-zh') return 2;
  if (lan.startsWith('ai-')) return 4;
  return 3;
}

/**
 * Fetch the subtitle track. The player API needs the user's Bilibili login
 * cookie for most AI subtitles, so it is called with credentials; the
 * subtitle JSON itself is a public CDN file and is fetched without cookies to
 * avoid credentialed-CORS failures.
 */
export async function fetchCaptions(video: Pick<VideoInfo, 'aid' | 'cid' | 'bvid'>): Promise<{ raw: RawCaption[]; lang: string }> {
  const qs = `aid=${video.aid}&cid=${video.cid}&bvid=${video.bvid}`;
  let json = await getJson(`https://api.bilibili.com/x/player/wbi/v2?${qs}`);
  if (json?.code !== 0) json = await getJson(`https://api.bilibili.com/x/player/v2?${qs}`);
  if (json?.code !== 0 || !json.data) throw new CaptionError(`获取字幕列表失败：${json?.message ?? '未知错误'}`, 'network');
  const subs: any[] = json.data.subtitle?.subtitles ?? [];
  if (subs.length === 0) {
    if (json.data.need_login_subtitle) throw new CaptionError('这个视频的字幕需要登录 B 站后才能获取', 'need_login');
    throw new CaptionError('这个视频没有字幕（也没有 AI 字幕），暂时无法分析', 'no_subtitle');
  }
  const chosen = subs.slice().sort((a, b) => rankSubtitle(a) - rankSubtitle(b))[0];
  const url = String(chosen.subtitle_url ?? '');
  if (!url) throw new CaptionError('字幕地址为空，请登录 B 站后重试', 'need_login');
  const body = await getJson(url.startsWith('//') ? `https:${url}` : url, 'omit');
  const raw: RawCaption[] = (body?.body ?? []).map((l: any) => ({ from: Number(l.from), to: Number(l.to), content: String(l.content ?? '') }));
  if (raw.length === 0) throw new CaptionError('字幕内容为空', 'no_subtitle');
  return { raw, lang: String(chosen.lan ?? '') };
}

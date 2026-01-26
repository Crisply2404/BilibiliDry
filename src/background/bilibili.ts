export interface BiliViewResponse {
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  durationSec: number;
}

export interface CaptionLine {
  from: number;
  to: number;
  content: string;
}

export class SubtitleLoginRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubtitleLoginRequiredError';
  }
}

function ensureHttps(url: string): string {
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

export async function fetchVideoView(bvid: string): Promise<BiliViewResponse> {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`B站 view 接口失败: ${res.status}`);
  const json = await res.json();
  if (json?.code !== 0 || !json?.data) throw new Error(`B站 view 接口返回异常: ${json?.message ?? 'unknown'}`);
  return {
    aid: json.data.aid,
    bvid: json.data.bvid,
    cid: json.data.cid,
    title: json.data.title,
    durationSec: json.data.duration
  };
}

export async function fetchSubtitleLines(aid: number, cid: number): Promise<CaptionLine[]> {
  // NOTE: Some videos require login cookies to access subtitles. Using credentials: 'include'
  // allows the request to carry the user's bilibili session.
  const url = `https://api.bilibili.com/x/player/wbi/v2?aid=${encodeURIComponent(String(aid))}&cid=${encodeURIComponent(String(cid))}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`B站 player 接口失败: ${res.status}`);
  const json = await res.json();
  if (json?.code !== 0 || !json?.data) throw new Error(`B站 player 接口返回异常: ${json?.message ?? 'unknown'}`);

  if (json?.data?.need_login_subtitle && Array.isArray(json?.data?.subtitle?.subtitles) && json.data.subtitle.subtitles.length === 0) {
    throw new SubtitleLoginRequiredError('该视频字幕需要登录后才能获取（请确认已登录 B站）');
  }

  const subtitles = json?.data?.subtitle?.subtitles;
  if (!Array.isArray(subtitles) || subtitles.length === 0) return [];

  // Prefer Chinese if present, otherwise first.
  const chosen =
    subtitles.find((s: any) => String(s?.lan).startsWith('zh')) ??
    subtitles.find((s: any) => String(s?.lan_doc).includes('中文')) ??
    subtitles[0];

  const subtitleUrl = chosen?.subtitle_url;
  if (!subtitleUrl) return [];

  const subtitleRes = await fetch(ensureHttps(subtitleUrl), { credentials: 'include' });
  if (!subtitleRes.ok) throw new Error(`字幕文件获取失败: ${subtitleRes.status}`);
  const subtitleJson = await subtitleRes.json();

  const body = subtitleJson?.body;
  if (!Array.isArray(body)) return [];

  return body
    .map((line: any) => ({
      from: Number(line?.from ?? 0),
      to: Number(line?.to ?? 0),
      content: String(line?.content ?? '').trim()
    }))
    .filter((l: CaptionLine) => l.content.length > 0 && Number.isFinite(l.from) && Number.isFinite(l.to))
    .sort((a, b) => a.from - b.from);
}

import { toMarkdown } from '../core/export/markdown';
import { redact } from '../core/llm/openaiCompat';
import type { Request, Response, TabCommand, VideoBundle } from '../shared/protocol';
import { loadSettings, normalizeSettings, saveSettings } from '../shared/settings';
import { attachChatPort } from './chat';
import * as store from './db';
import { attachEventsPort, publish } from './hub';
import { cancelJob, ensureVideo, recoverInterruptedJobs, startJob } from './jobs';
import { invalidate, searchLibrary, searchVideo, toResultItems } from './library';
import { testConnection } from './llm';

void recoverInterruptedJobs();

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'events') attachEventsPort(port);
  else if (port.name === 'chat') attachChatPort(port);
});

async function videoBundle(videoId: string): Promise<VideoBundle> {
  const [video, segments, digest, job] = await Promise.all([store.getVideo(videoId), store.getSegments(videoId), store.getDigest(videoId), store.getJob(videoId)]);
  if (job) {
    const { done: _d, configKey: _c, ...pub } = job;
    return { video: video ?? null, segments, digest, job: pub };
  }
  return { video: video ?? null, segments, digest, job: null };
}

async function seek(bvid: string, page: number, time: number): Promise<void> {
  const tabs = await chrome.tabs.query({ url: `https://www.bilibili.com/video/${bvid}*` });
  const tab = tabs.find((t) => (Number(new URL(t.url ?? 'https://x').searchParams.get('p') ?? '1') || 1) === page) ?? tabs[0];
  if (tab?.id !== undefined) {
    await chrome.tabs.sendMessage(tab.id, { type: 'SEEK_TO', time } satisfies TabCommand).catch(() => undefined);
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  const qs = new URLSearchParams({ t: String(Math.floor(time)) });
  if (page > 1) qs.set('p', String(page));
  await chrome.tabs.create({ url: `https://www.bilibili.com/video/${bvid}?${qs}` });
}

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'GET_SETTINGS':
      return loadSettings();
    case 'SAVE_SETTINGS': {
      const s = await saveSettings(req.patch);
      if ('embeddingModel' in req.patch) invalidate();
      return s;
    }
    case 'TEST_CONNECTION':
      return testConnection(normalizeSettings({ ...(await loadSettings()), ...(req.settings ?? {}) }));
    case 'RESOLVE_VIDEO': {
      const v = await ensureVideo(req.bvid, req.page);
      return videoBundle(v.videoId);
    }
    case 'GET_VIDEO':
      return videoBundle(req.videoId);
    case 'ANALYZE':
      return startJob(req);
    case 'CANCEL':
      return cancelJob(req.videoId);
    case 'LIST_LIBRARY': {
      const videos = await store.listVideos();
      const jobs = new Map((await store.listJobs()).map((j) => [j.videoId, j.status] as const));
      const q = req.query?.trim().toLowerCase();
      return videos
        .filter((v) => !q || v.title.toLowerCase().includes(q) || v.owner?.toLowerCase().includes(q) || v.tldr?.toLowerCase().includes(q))
        .map((v) => ({ ...v, jobStatus: jobs.get(v.videoId) ?? null }));
    }
    case 'DELETE_VIDEO':
      cancelJob(req.videoId);
      await store.deleteVideo(req.videoId);
      invalidate(req.videoId);
      publish({ type: 'LIBRARY_CHANGED' });
      return true;
    case 'SEARCH': {
      const settings = await loadSettings();
      const k = req.k ?? 8;
      const hits = req.videoId ? await searchVideo(req.videoId, req.query, k, settings) : await searchLibrary(req.query, k, settings);
      return toResultItems(hits);
    }
    case 'EXPORT_MARKDOWN': {
      const b = await videoBundle(req.videoId);
      if (!b.video) throw new Error('没有这个视频的记录');
      return toMarkdown(b.video, b.segments, b.digest);
    }
    case 'GET_CAPTIONS':
      return (await store.getCaptions(req.videoId)) ?? [];
    case 'GET_TRACES':
      return store.listTraces(req.videoId, req.limit);
    case 'GET_CHAT':
      return store.getChat(req.videoId);
    case 'CLEAR_CHAT':
      await store.putChat(req.videoId, []);
      return [];
    case 'OPEN_DASHBOARD':
      await chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${req.videoId ? `#/video/${encodeURIComponent(req.videoId)}` : ''}`) });
      return true;
    case 'OPEN_OPTIONS':
      await chrome.runtime.openOptionsPage();
      return true;
    case 'SEEK':
      await seek(req.bvid, req.page, req.time);
      return true;
    case 'GET_STATS':
      return store.stats();
    case 'CLEAR_ALL':
      await store.clearAll();
      invalidate();
      publish({ type: 'LIBRARY_CHANGED' });
      return true;
    default:
      throw new Error(`未知请求：${(req as { type: string }).type}`);
  }
}

chrome.runtime.onMessage.addListener((req: Request, _sender, sendResponse: (r: Response) => void) => {
  handle(req)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: redact(String((err as Error)?.message ?? err)) }));
  return true;
});

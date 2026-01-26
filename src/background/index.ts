import { getConfig, setConfig } from '../shared/storage';
import type { BackgroundRequest, BackgroundResponse, VideoContext } from '../shared/messages';
import { startIncrementalAnalysis, type AnalysisJob } from './analyze';
import { clearAllData, getVideo, listSegments } from './db';
import { fetchSubtitleLines, fetchVideoView } from './bilibili';
import { buildMarkdown } from './markdown';
import { searchKeyword, searchSemantic } from './search';

function respond(sendResponse: (response: BackgroundResponse) => void, response: BackgroundResponse) {
  try {
    sendResponse(response);
  } catch {
    // ignore
  }
}

chrome.runtime.onMessage.addListener((message: BackgroundRequest & { [k: string]: unknown }, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'PING': {
        respond(sendResponse, { ok: true, data: 'pong' });
        return;
      }
      case 'GET_CONFIG': {
        const config = await getConfig();
        respond(sendResponse, { ok: true, data: config });
        return;
      }
      case 'SET_CONFIG': {
        await setConfig(message.config ?? {});
        respond(sendResponse, { ok: true });
        return;
      }
      case 'GET_VIDEO_CONTEXT': {
        const view = await fetchVideoView(message.bvid);
        const lines = await fetchSubtitleLines(view.aid, view.cid);
        const ctx: VideoContext = {
          videoId: view.bvid,
          bvid: view.bvid,
          aid: view.aid,
          cid: view.cid,
          title: view.title,
          durationSec: view.durationSec,
          hasCC: lines.length > 0
        };
        respond(sendResponse, { ok: true, data: ctx });
        return;
      }
      case 'CLEAR_LOCAL_DATA': {
        await clearAllData();
        respond(sendResponse, { ok: true });
        return;
      }
      case 'GET_VIDEO_STATE': {
        const video = await getVideo(message.videoId);
        const segments = await listSegments(message.videoId);
        respond(sendResponse, { ok: true, data: { video, segments } });
        return;
      }
      case 'EXPORT_MARKDOWN': {
        const video = await getVideo(message.videoId);
        if (!video) {
          respond(sendResponse, { ok: false, error: '未找到视频记录，请先分析' });
          return;
        }
        const segments = await listSegments(message.videoId);
        const markdown = buildMarkdown({ video, segments });
        respond(sendResponse, { ok: true, data: { markdown, filename: `${video.videoId}.md` } });
        return;
      }
      case 'SEARCH_QUERY': {
        const config = await getConfig();
        const apiKey = config.geminiApiKey?.trim();
        const results = apiKey
          ? await searchSemantic({ apiKey, query: message.query, topK: message.topK }).catch(() =>
              searchKeyword({ query: message.query, topK: message.topK })
            )
          : await searchKeyword({ query: message.query, topK: message.topK });
        respond(sendResponse, { ok: true, data: { results } });
        return;
      }
      case 'CANCEL_ANALYSIS': {
        const job = analysisJobs.get(message.videoId);
        job?.cancel();
        analysisJobs.delete(message.videoId);
        respond(sendResponse, { ok: true });
        return;
      }
      case 'START_INCREMENTAL_ANALYSIS': {
        const bvid = message.bvid;
        const tabId = await resolveTargetTabId(sender, bvid);
        if (!tabId) {
          respond(sendResponse, { ok: false, error: '未找到目标 B站视频页 tab' });
          return;
        }
        analysisJobs.get(bvid)?.cancel();
        analysisJobs.delete(bvid);

        const push = (msg: any) => {
          chrome.tabs.sendMessage(tabId, msg).catch(() => {});
        };

        const job = startIncrementalAnalysis({
          bvid,
          currentTimeSec: message.currentTimeSec,
          tabId,
          push
        });
        analysisJobs.set(bvid, job);
        job.done.finally(() => {
          if (analysisJobs.get(bvid) === job) analysisJobs.delete(bvid);
        });

        respond(sendResponse, { ok: true });
        return;
      }
      default: {
        respond(sendResponse, { ok: false, error: `Unknown message type: ${(message as any).type}` });
      }
    }
  })();

  return true;
});

const analysisJobs = new Map<string, AnalysisJob>();

async function resolveTargetTabId(sender: chrome.runtime.MessageSender, bvid: string): Promise<number | null> {
  if (sender.tab?.id) return sender.tab.id;

  const tabs = await chrome.tabs.query({ url: 'https://www.bilibili.com/video/*' });
  const match =
    tabs.find((t) => typeof t.url === 'string' && t.url.includes(`/video/${bvid}`)) ??
    tabs.find((t) => t.active);
  return match?.id ?? null;
}

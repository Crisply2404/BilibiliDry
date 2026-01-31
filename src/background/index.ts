import { getConfig, setConfig } from '../shared/storage';
import type { BackgroundRequest, BackgroundResponse, VideoContext } from '../shared/messages';
import { startIncrementalAnalysis, type AnalysisJob } from './analyze';
import { clearAllData, getVideo, listSegments } from './db';
import { fetchSubtitleLines, fetchVideoView } from './bilibili';
import { buildMarkdown } from './markdown';
import { searchInVideoKeyword, searchInVideoSemantic } from './search';
import { getActiveLlm } from './llm';
import { testConnectionWithOpenAI } from './openai';

function redactSecrets(text: string): string {
  return (
    text
      // OpenAI-style keys
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***REDACTED***')
      // Providers sometimes echo partial keys like `sk-...abcd`
      .replace(/sk-\.\.\.[A-Za-z0-9_-]{2,}/g, 'sk-***REDACTED***')
      // Bearer tokens
      .replace(/Bearer\s+[A-Za-z0-9._~-]{8,}/gi, 'Bearer ***REDACTED***')
  );
}

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
      case 'TEST_LLM_CONNECTION': {
        const config = await getConfig();
        try {
          if (config.llmProvider === 'openai') {
            const baseUrl = String(config.openaiBaseUrl ?? '').trim();
            const apiKey = String(config.openaiApiKey ?? '').trim();
            const model = String(config.openaiModel ?? '').trim();
            if (!baseUrl) throw new Error('未配置 OpenAI Base URL');
            if (!apiKey) throw new Error('未配置 OpenAI API Key');
            if (!model) throw new Error('未配置 Model');
            await testConnectionWithOpenAI({ baseUrl, apiKey, model });
            respond(sendResponse, { ok: true, data: { source: 'openai', modelTag: `openai:${model}` } });
            return;
          }
          respond(sendResponse, { ok: false, error: '当前仅支持验证 OpenAI-compatible 连接' });
          return;
        } catch (err: any) {
          respond(sendResponse, { ok: false, error: redactSecrets(String(err?.message ?? err)) });
          return;
        }
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
          videoId: `${view.bvid}_${view.cid}`,
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
      case 'OPEN_DASHBOARD': {
        const url = chrome.runtime.getURL(`dashboard.html#${encodeURIComponent(message.videoId)}`);
        await chrome.tabs.create({ url });
        respond(sendResponse, { ok: true });
        return;
      }
      case 'SEARCH_IN_VIDEO': {
        const videoId = message.videoId;
        if (!videoId) {
          respond(sendResponse, { ok: false, error: '缺少 videoId' });
          return;
        }

        const config = await getConfig();
        try {
          const llm = getActiveLlm(config);
          const semantic = await searchInVideoSemantic({
            videoId,
            query: message.query,
            topK: message.topK,
            rerank: (args) => llm.rerankCandidates(args)
          });
          respond(sendResponse, { ok: true, data: semantic });
          return;
        } catch (err: any) {
          const keyword = await searchInVideoKeyword({ videoId, query: message.query, topK: message.topK });
          respond(sendResponse, {
            ok: true,
            data: { items: keyword, mode: 'keyword', note: redactSecrets(String(err?.message ?? '已回退关键词搜索')) }
          });
          return;
        }
      }
      case 'CANCEL_ANALYSIS': {
        const entry = analysisJobs.get(message.videoId);
        entry?.job.cancel();
        analysisJobs.delete(message.videoId);
        respond(sendResponse, { ok: true });
        return;
      }
      case 'START_INCREMENTAL_ANALYSIS': {
        const bvid = message.bvid;
        const videoId = message.videoId || (message as any).video?.videoId || bvid;
        const tabId = await resolveTargetTabId(sender, bvid);
        if (!tabId) {
          respond(sendResponse, { ok: false, error: '未找到目标 B站视频页 tab' });
          return;
        }

        // One analysis per tab: starting a new one cancels the previous.
        for (const [key, entry] of analysisJobs.entries()) {
          if (entry.tabId !== tabId) continue;
          entry.job.cancel();
          analysisJobs.delete(key);
        }

        analysisJobs.get(videoId)?.job.cancel();
        analysisJobs.delete(videoId);

        const push = (msg: any) => {
          chrome.tabs.sendMessage(tabId, msg).catch(() => {});
        };

        const job = startIncrementalAnalysis({
          bvid,
          videoId,
          currentTimeSec: message.currentTimeSec,
          video: (message as any).video,
          captions: (message as any).captions,
          tabId,
          push
        });
        analysisJobs.set(videoId, { job, tabId });
        job.done.finally(() => {
          if (analysisJobs.get(videoId)?.job === job) analysisJobs.delete(videoId);
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

const analysisJobs = new Map<string, { job: AnalysisJob; tabId: number }>();

async function resolveTargetTabId(sender: chrome.runtime.MessageSender, bvid: string): Promise<number | null> {
  if (sender.tab?.id) return sender.tab.id;

  const tabs = await chrome.tabs.query({ url: 'https://www.bilibili.com/video/*' });
  const match =
    tabs.find((t) => typeof t.url === 'string' && t.url.includes(`/video/${bvid}`)) ??
    tabs.find((t) => t.active);
  return match?.id ?? null;
}

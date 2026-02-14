import { getConfig, setConfig } from '../shared/storage';
import type { BackgroundRequest, BackgroundResponse, VideoContext } from '../shared/messages';
import { startIncrementalAnalysis, type AnalysisJob } from './analyze';
import { clearAllData, getVideo, listAnalysisRuns, listSegments } from './db';
import { fetchSubtitleLines, fetchVideoView } from './bilibili';
import { buildMarkdown } from './markdown';
import { searchInVideoKeyword, searchInVideoSemantic } from './search';
import { getActiveLlm } from './llm';
import { testConnectionWithOpenAI } from './openai';
import { runModelCascadeBenchmark } from './benchmark';

type PlayerTimeState = {
  videoId: string;
  bvid: string;
  tabId: number;
  currentTimeSec: number;
  durationSec?: number;
  playing?: boolean;
  updatedAtMs: number;
};

const playerStates = new Map<string, PlayerTimeState>();
const playerSubscribers = new Map<string, Set<chrome.runtime.Port>>();
const benchmarkJobs = new Map<string, Promise<void>>();
const keepAlivePorts = new Set<chrome.runtime.Port>();

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

function broadcastPlayerTime(videoId: string, state: PlayerTimeState) {
  const subs = playerSubscribers.get(videoId);
  if (!subs || subs.size === 0) return;
  for (const port of subs) {
    try {
      port.postMessage({ type: 'PLAYER_TIME', videoId, state });
    } catch {
      // ignore
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'ANALYSIS_KEEPALIVE') {
    keepAlivePorts.add(port);
    const tabId = port.sender?.tab?.id ?? null;

    const onMessage = (msg: any) => {
      // Intentionally no-op: the existence of this Port + periodic PING keeps the MV3 service worker alive.
      // (Helps avoid long analysis jobs being suspended mid-flight.)
      void msg;
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
      keepAlivePorts.delete(port);
      try {
        port.onMessage.removeListener(onMessage);
      } catch {
        // ignore
      }

      // If the user refreshed/closed the tab, cancel any analysis job bound to that tab.
      if (tabId) {
        for (const [key, entry] of analysisJobs.entries()) {
          if (entry.tabId !== tabId) continue;
          entry.job.cancel();
          analysisJobs.delete(key);
        }
      }
    });
    return;
  }

  if (port.name !== 'DASHBOARD_PLAYER_SYNC') return;

  let subscribedVideoId: string | null = null;

  const onMessage = (msg: any) => {
    if (!msg || msg.type !== 'SUBSCRIBE_PLAYER_TIME') return;
    const videoId = String(msg.videoId ?? '').trim();
    if (!videoId) return;

    // Move subscription if changed.
    if (subscribedVideoId && subscribedVideoId !== videoId) {
      const prev = playerSubscribers.get(subscribedVideoId);
      prev?.delete(port);
      if (prev && prev.size === 0) playerSubscribers.delete(subscribedVideoId);
    }

    subscribedVideoId = videoId;
    const set = playerSubscribers.get(videoId) ?? new Set<chrome.runtime.Port>();
    set.add(port);
    playerSubscribers.set(videoId, set);

    const state = playerStates.get(videoId);
    if (state) {
      try {
        port.postMessage({ type: 'PLAYER_TIME', videoId, state });
      } catch {
        // ignore
      }
    }
  };

  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    if (!subscribedVideoId) return;
    const set = playerSubscribers.get(subscribedVideoId);
    set?.delete(port);
    if (set && set.size === 0) playerSubscribers.delete(subscribedVideoId);
  });
});

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
      case 'GET_ANALYSIS_RUNS': {
        const runs = await listAnalysisRuns(message.videoId);
        respond(sendResponse, { ok: true, data: { runs } });
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
      case 'PLAYER_TIME_UPDATE': {
        const tabId = sender.tab?.id;
        if (!tabId) {
          respond(sendResponse, { ok: true });
          return;
        }
        const videoId = String((message as any).videoId ?? '').trim();
        const bvid = String((message as any).bvid ?? '').trim();
        const currentTimeSec = Number((message as any).currentTimeSec ?? 0);
        const durationSec = (message as any).durationSec;
        const playing = (message as any).playing;
        const updatedAtMs = Number((message as any).updatedAtMs ?? Date.now());
        if (!videoId || !bvid || !Number.isFinite(currentTimeSec)) {
          respond(sendResponse, { ok: true });
          return;
        }

        const state: PlayerTimeState = {
          videoId,
          bvid,
          tabId,
          currentTimeSec: Math.max(0, currentTimeSec),
          durationSec: typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : undefined,
          playing: typeof playing === 'boolean' ? playing : undefined,
          updatedAtMs
        };
        playerStates.set(videoId, state);
        broadcastPlayerTime(videoId, state);
        respond(sendResponse, { ok: true });
        return;
      }
      case 'SEEK_VIDEO': {
        const videoId = String((message as any).videoId ?? '').trim();
        const timeSec = Math.max(0, Number((message as any).timeSec ?? 0));
        if (!videoId || !Number.isFinite(timeSec)) {
          respond(sendResponse, { ok: false, error: '参数无效' });
          return;
        }

        const known = playerStates.get(videoId);
        const bvid = known?.bvid ?? String(videoId.split('_')[0] ?? '').trim();
        const tabId = known?.tabId ?? (await resolveTargetTabId(sender, bvid));
        if (!tabId) {
          respond(sendResponse, { ok: false, error: '未找到目标 B站视频页 tab' });
          return;
        }

        chrome.tabs.sendMessage(tabId, { type: 'SEEK_TO', videoId, timeSec }).catch(() => {});
        respond(sendResponse, { ok: true });
        return;
      }
      case 'RUN_BENCHMARK_ALTERNATIVE': {
        const videoId = String((message as any).videoId ?? '').trim();
        if (!videoId) {
          respond(sendResponse, { ok: false, error: '缺少 videoId' });
          return;
        }
        if (benchmarkJobs.has(videoId)) {
          respond(sendResponse, { ok: false, error: '对照实验正在运行中，请稍后再试' });
          return;
        }

        const config = await getConfig();
        if (!config.developerMode) {
          respond(sendResponse, { ok: false, error: '仅开发者模式可用（请在设置页开启）' });
          return;
        }

        const video = await getVideo(videoId);
        if (!video) {
          respond(sendResponse, { ok: false, error: '未找到视频记录，请先分析一次' });
          return;
        }

        const runs = await listAnalysisRuns(videoId);
        const latest = runs[0];
        if (!latest) {
          respond(sendResponse, { ok: false, error: '未找到分析 runs，请先分析一次' });
          return;
        }

        const mode = latest.cascadeEnabled ? ('strong_only' as const) : ('cascade' as const);
        if (mode === 'cascade') {
          const cheapModel = String(config.cascade?.cheapModel ?? '').trim();
          const strongModel = String(config.cascade?.strongModel ?? config.openaiModel ?? '').trim();
          if (!cheapModel || !strongModel) {
            respond(sendResponse, { ok: false, error: '未配置 cheap/strong model，无法跑 cheap+strong 对照组' });
            return;
          }
        }

        const emit = (msg: any) => {
          chrome.runtime.sendMessage(msg).catch(() => {});
        };

        const controller = new AbortController();
        const job = runModelCascadeBenchmark({ video, mode, emit, signal: controller.signal })
          .then(() => {})
          .catch((err: any) => {
            emit({
              type: 'BENCHMARK_ERROR',
              videoId,
              mode,
              error: redactSecrets(String(err?.message ?? err))
            });
          })
          .finally(() => {
            benchmarkJobs.delete(videoId);
          });

        benchmarkJobs.set(videoId, job);
        respond(sendResponse, { ok: true, data: { mode } });
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

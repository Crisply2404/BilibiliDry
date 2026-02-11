import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HeatmapBar from '../../components/HeatmapBar';
import PluginView from '../../components/PluginView';
import type { Segment } from '../../types';
import { ContentType, type WaterReasonType } from '../../types';
import type { BackgroundPush } from '../shared/messages';
import type { CaptionLine, VideoMeta } from '../shared/messages';
import type { AnalysisResult } from '../../types';
import { Zap } from 'lucide-react';
import { getDryPercent } from '../../services/segments';

type SearchResultItem = { startTime: number; endTime: number; score: number; snippet: string; reason?: string };
type OverlayUiMode = 'open' | 'minimized' | 'closed';
type Point = { x: number; y: number };

const UI_STORAGE_KEY = 'overlay_ui_v1';
const PANEL_SIZE = { w: 380, h: 560 };
const BALL_SIZE = 52;
const DRAG_THRESHOLD_PX = 5;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function clampPoint(p: Point, maxW: number, maxH: number): Point {
  return { x: clamp(p.x, 8, Math.max(8, maxW - 8)), y: clamp(p.y, 8, Math.max(8, maxH - 8)) };
}

function defaultPanelPos(): Point {
  return { x: Math.max(8, window.innerWidth - PANEL_SIZE.w - 16), y: 80 };
}

function defaultBallPos(): Point {
  return { x: Math.max(8, window.innerWidth - BALL_SIZE - 16), y: Math.max(8, window.innerHeight - BALL_SIZE - 140) };
}

function getBvidFromUrl(url: string): string | null {
  const match = url.match(/\/video\/(BV[a-zA-Z0-9]+)/);
  return match?.[1] ?? null;
}

function getPageFromUrl(url: string): number {
  try {
    const u = new URL(url);
    const p = Number(u.searchParams.get('p') ?? '1');
    if (Number.isFinite(p) && p >= 1) return Math.floor(p);
  } catch {
    // ignore
  }
  return 1;
}

function buildVideoId(bvid: string, cid: number): string {
  return `${bvid}_${cid}`;
}

function getVideoElement(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  if (videos.length === 0) return null;

  const scored = videos
    .map((v) => {
      const rect = v.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      const style = window.getComputedStyle(v);
      const opacity = Number.parseFloat(style.opacity || '1');
      const inViewport =
        rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
      const visible =
        inViewport &&
        rect.width >= 120 &&
        rect.height >= 120 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number.isFinite(opacity) &&
        opacity > 0.05;
      const currentTime = Number((v as any).currentTime ?? 0);
      const duration = Number((v as any).duration ?? 0);
      const readyState = Number((v as any).readyState ?? 0);
      const paused = Boolean((v as any).paused);
      const ended = Boolean((v as any).ended);
      const playing = !paused && !ended && readyState >= 2 && Number.isFinite(duration) && duration > 0;
      const progressed = Number.isFinite(currentTime) && currentTime > 1 && Number.isFinite(duration) && duration > 0;
      return { v, area, visible, playing, progressed, currentTime };
    })
    .filter((x) => x.visible)
    .sort((a, b) => {
      // Prefer the currently playing video (B站页面可能存在多个 video 元素).
      if (a.playing !== b.playing) return a.playing ? -1 : 1;
      // Then prefer a video that has progressed (currentTime > 1s).
      if (a.progressed !== b.progressed) return a.progressed ? -1 : 1;
      // Then by area.
      if (b.area !== a.area) return b.area - a.area;
      // Finally by currentTime (avoid picking a reset/hidden one).
      return (Number(b.currentTime) || 0) - (Number(a.currentTime) || 0);
    });

  return (scored[0]?.v ?? videos[0]) || null;
}

function getVideoMetaFromInitialState(page: number): VideoMeta | null {
  const state = (window as any).__INITIAL_STATE__;
  const videoData = state?.videoData;
  const bvid = videoData?.bvid ?? state?.bvid ?? getBvidFromUrl(window.location.href);
  const aid = videoData?.aid ?? state?.aid;
  const pages = Array.isArray(videoData?.pages) ? videoData.pages : [];
  const idx = Math.max(0, Math.min(pages.length - 1, Math.floor((page || 1) - 1)));
  const chosen = pages[idx] ?? pages[0];
  const cid = chosen?.cid ?? videoData?.cid;
  const partTitle = chosen?.part ? String(chosen.part) : undefined;
  const baseTitle = String(videoData?.title ?? document.title);
  const title = partTitle && !baseTitle.includes(partTitle) ? `${baseTitle} - ${partTitle}` : baseTitle;
  const durationSec = Number(chosen?.duration ?? videoData?.duration ?? 0);
  if (!bvid || !aid || !cid) return null;
  return {
    videoId: buildVideoId(String(bvid), Number(cid)),
    bvid: String(bvid),
    aid: Number(aid),
    cid: Number(cid),
    page,
    partTitle,
    title,
    durationSec
  };
}

async function fetchJson(url: string, options?: { credentials?: RequestCredentials }): Promise<any> {
  const res = await fetch(url, { credentials: options?.credentials ?? 'include' });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function fetchVideoMetaFromApi(bvid: string, page: number): Promise<VideoMeta> {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const json = await fetchJson(url);
  if (json?.code !== 0 || !json?.data) throw new Error(`视频信息获取失败: ${json?.message ?? 'unknown'}`);
  const pages = Array.isArray(json?.data?.pages) ? json.data.pages : [];
  const idx = Math.max(0, Math.min(pages.length - 1, Math.floor((page || 1) - 1)));
  const chosen = pages[idx] ?? pages[0];
  const cid = Number(chosen?.cid ?? json.data.cid);
  const partTitle = chosen?.part ? String(chosen.part) : undefined;
  const baseTitle = String(json.data.title ?? document.title);
  const title = partTitle && !baseTitle.includes(partTitle) ? `${baseTitle} - ${partTitle}` : baseTitle;
  const durationSec = Number(chosen?.duration ?? json.data.duration ?? 0);
  return {
    videoId: buildVideoId(String(json.data.bvid ?? bvid), cid),
    bvid: String(json.data.bvid ?? bvid),
    aid: Number(json.data.aid),
    cid,
    page,
    partTitle,
    title,
    durationSec
  };
}

async function fetchCaptionsFromPage(meta: VideoMeta): Promise<CaptionLine[]> {
  const url = `https://api.bilibili.com/x/player/wbi/v2?aid=${encodeURIComponent(String(meta.aid))}&cid=${encodeURIComponent(String(meta.cid))}`;
  const json = await fetchJson(url, { credentials: 'include' });
  if (json?.code !== 0) throw new Error(`字幕接口返回异常: ${json?.message ?? 'unknown'}`);
  if (json?.data?.need_login_subtitle && Array.isArray(json?.data?.subtitle?.subtitles) && json.data.subtitle.subtitles.length === 0) {
    throw new Error('该视频字幕需要登录后才能获取（请确认已登录 B站）');
  }
  const subtitles = json?.data?.subtitle?.subtitles;
  if (!Array.isArray(subtitles) || subtitles.length === 0) return [];
  const chosen =
    subtitles.find((s: any) => String(s?.lan).startsWith('zh')) ??
    subtitles.find((s: any) => String(s?.lan_doc).includes('中文')) ??
    subtitles[0];
  const subtitleUrl = chosen?.subtitle_url;
  if (!subtitleUrl) return [];
  // Subtitle JSON is usually hosted on `*.hdslb.com` with `Access-Control-Allow-Origin: *` (no credentials).
  // If we send cookies (`credentials: include`), browsers will block it. So omit credentials here.
  const subJson = await fetchJson(subtitleUrl.startsWith('//') ? `https:${subtitleUrl}` : subtitleUrl, { credentials: 'omit' });
  const body = subJson?.body;
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

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function isAutoSkippableWater(seg: Segment, enabledTypes: WaterReasonType[]): boolean {
  if (seg.type !== ContentType.WATER) return false;
  if (!Array.isArray(enabledTypes) || enabledTypes.length === 0) return false;
  const reasonType = (seg as any).waterReasonType as WaterReasonType | undefined;
  if (!reasonType) return true;
  return enabledTypes.includes(reasonType);
}

function pickSegmentAtTime(params: { segments: Segment[]; t: number; predicate: (s: Segment) => boolean }): Segment | null {
  const candidates = params.segments.filter(
    (s) => params.t >= Number(s.startTime) && params.t < Number(s.endTime) && params.predicate(s)
  );
  if (candidates.length === 0) return null;
  return (
    candidates
      .slice()
      .sort((a, b) => (Number(b.confidence) - Number(a.confidence)) || (Number(b.endTime) - Number(a.endTime)))[0] ?? null
  );
}

function getConnectedBlockEnd(params: { segments: Segment[]; anchor: Segment; predicate: (s: Segment) => boolean; gapSec?: number }): number {
  const gapSec = Number.isFinite(params.gapSec) ? Number(params.gapSec) : 0.25;
  const anchorStart = Number(params.anchor.startTime);
  const anchorEnd = Number(params.anchor.endTime);
  if (!Number.isFinite(anchorStart) || !Number.isFinite(anchorEnd) || anchorEnd <= anchorStart) return anchorEnd;

  const list = params.segments
    .filter(params.predicate)
    .map((s) => ({ start: Number(s.startTime), end: Number(s.endTime) }))
    .filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start)
    .sort((a, b) => a.start - b.start);

  let end = anchorEnd;
  for (const seg of list) {
    if (seg.end < anchorStart - gapSec) continue;
    if (seg.start <= end + gapSec) {
      end = Math.max(end, seg.end);
      continue;
    }
    break;
  }

  return end;
}

const OverlayApp: React.FC = () => {
  const [uiMode, setUiMode] = useState<OverlayUiMode>('open');
  const [panelPos, setPanelPos] = useState<Point>(() => defaultPanelPos());
  const [ballPos, setBallPos] = useState<Point>(() => defaultBallPos());
  const uiModeRef = useRef<OverlayUiMode>('open');

  const dragRef = useRef<{
    target: 'panel' | 'ball';
    pointerId: number;
    startX: number;
    startY: number;
    orig: Point;
    moved: boolean;
  } | null>(null);

  const [bvid, setBvid] = useState<string | null>(() => getBvidFromUrl(window.location.href));
  const [page, setPage] = useState<number>(() => getPageFromUrl(window.location.href));
  const [videoId, setVideoId] = useState<string | null>(null);
  const [autoAnalyzeOnOpen, setAutoAnalyzeOnOpen] = useState(false);
  const [autoSkip, setAutoSkip] = useState(false);
  const [waterEnabledTypes, setWaterEnabledTypes] = useState<WaterReasonType[]>(['REPEAT', 'NO_NEW_INFO', 'AD', 'SMALLTALK', 'OFFTOPIC']);
  const [developerMode, setDeveloperMode] = useState(false);

  const autoSkipSinceRef = useRef<number | null>(null);
  useEffect(() => {
    autoSkipSinceRef.current = autoSkip ? Date.now() : null;
  }, [autoSkip]);
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [durationSec, setDurationSec] = useState<number>(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [previousSegments, setPreviousSegments] = useState<Segment[] | null>(null);
  const [segmentsView, setSegmentsView] = useState<'current' | 'previous'>('current');
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState<boolean>(true);
  const [reflection, setReflection] = useState<{ progress: number; completed: number; total: number } | null>(null);
  const pendingSegmentsRef = useRef<Map<string, Segment>>(new Map());
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);

  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searchMode, setSearchMode] = useState<'semantic' | 'keyword' | ''>('');
  const [searchNote, setSearchNote] = useState<string>('');
  const [exportStatus, setExportStatus] = useState<string>('');

  useEffect(() => {
    uiModeRef.current = uiMode;
  }, [uiMode]);

  const segmentsRef = useRef<Segment[]>([]);
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  const durationSecRef = useRef<number>(0);
  useEffect(() => {
    durationSecRef.current = durationSec;
  }, [durationSec]);

  useEffect(() => {
    chrome.storage.local
      .get(UI_STORAGE_KEY)
      .then((res) => {
        const saved = res?.[UI_STORAGE_KEY];
        if (!saved) return;
        if (saved.mode === 'open' || saved.mode === 'minimized' || saved.mode === 'closed') {
          // Product choice: even if user previously "closed" (hide everything),
          // on refresh / re-enter we bring back the floating ball as a re-entry point.
          setUiMode(saved.mode === 'closed' ? 'minimized' : saved.mode);
        }
        if (saved.panel && typeof saved.panel.x === 'number' && typeof saved.panel.y === 'number') setPanelPos(saved.panel);
        if (saved.ball && typeof saved.ball.x === 'number' && typeof saved.ball.y === 'number') setBallPos(saved.ball);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      chrome.storage.local
        .set({
          [UI_STORAGE_KEY]: { mode: uiMode, panel: panelPos, ball: ballPos }
        })
        .catch(() => {});
    }, 200);
    return () => window.clearTimeout(id);
  }, [ballPos, panelPos, uiMode]);

  useEffect(() => {
    const onResize = () => {
      setPanelPos((p) => clampPoint(p, window.innerWidth - PANEL_SIZE.w, window.innerHeight - PANEL_SIZE.h));
      setBallPos((p) => clampPoint(p, window.innerWidth - BALL_SIZE, window.innerHeight - BALL_SIZE));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const openFromBall = useCallback((ball: Point) => {
    setUiMode('open');
    setPanelPos((prev) => {
      const next = { x: ball.x - PANEL_SIZE.w + BALL_SIZE, y: ball.y - 12 };
      const dist = Math.abs(prev.x - next.x) + Math.abs(prev.y - next.y);
      const pos = dist > 800 ? next : prev;
      return clampPoint(pos, window.innerWidth - PANEL_SIZE.w, window.innerHeight - PANEL_SIZE.h);
    });
  }, []);

  const startDrag = useCallback((target: 'panel' | 'ball', e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const pointerId = e.pointerId;
    const origin = target === 'panel' ? panelPos : ballPos;
    dragRef.current = { target, pointerId, startX: e.clientX, startY: e.clientY, orig: origin, moved: false };

    const onMove = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur || ev.pointerId !== cur.pointerId) return;
      const dx = ev.clientX - cur.startX;
      const dy = ev.clientY - cur.startY;
      if (!cur.moved) {
        const dist2 = dx * dx + dy * dy;
        if (dist2 < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        cur.moved = true;
      }
      const next = { x: cur.orig.x + dx, y: cur.orig.y + dy };
      if (cur.target === 'panel') {
        setPanelPos(clampPoint(next, window.innerWidth - PANEL_SIZE.w, window.innerHeight - PANEL_SIZE.h));
      } else {
        setBallPos(clampPoint(next, window.innerWidth - BALL_SIZE, window.innerHeight - BALL_SIZE));
      }
    };

    const onUp = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur || ev.pointerId !== cur.pointerId) return;
      const shouldOpen = cur.target === 'ball' && !cur.moved;
      const ball = cur.orig;
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (shouldOpen) openFromBall(ball);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [ballPos, openFromBall, panelPos]);

  const currentVideoKeyRef = useRef<string | null>(null);
  useEffect(() => {
    currentVideoKeyRef.current = videoId ?? bvid;
  }, [bvid, videoId]);

  const lastKnownTimeRef = useRef<number>(0);
  useEffect(() => {
    const tick = () => {
      const video = getVideoElement();
      if (video) {
        const t = video.currentTime || 0;
        lastKnownTimeRef.current = t;
        setCurrentTimeSec(t);
      }
    };
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, []);

  const lastPlayerSyncRef = useRef<{ atMs: number; timeSec: number } | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const idKey = String(videoId ?? '').trim();
      if (!idKey || !idKey.includes('_')) return;
      if (!bvid) return;
      const video = getVideoElement();
      if (!video) return;

      const t = Number(video.currentTime || 0);
      if (!Number.isFinite(t)) return;

      const now = Date.now();
      const last = lastPlayerSyncRef.current;
      if (last && now - last.atMs < 500 && Math.abs(t - last.timeSec) < 0.5) return;
      lastPlayerSyncRef.current = { atMs: now, timeSec: t };

      const durationSec = Number(video.duration || 0);
      const playing = Boolean(!video.paused && !video.ended && video.readyState >= 2);
      chrome.runtime
        .sendMessage({
          type: 'PLAYER_TIME_UPDATE',
          videoId: idKey,
          bvid,
          currentTimeSec: t,
          durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : undefined,
          playing,
          updatedAtMs: now
        })
        .catch(() => {});
    }, 250);
    return () => window.clearInterval(id);
  }, [bvid, videoId]);

  useEffect(() => {
    let current: HTMLVideoElement | null = null;
    let cleanup = () => {};

    const onSeeked = (e: Event) => {
      const video = e.currentTarget as HTMLVideoElement | null;
      if (!video) return;

      const meta = lastSeekRef.current;
      const now = Date.now();
      const kind = meta && now - meta.atMs < 1200 ? meta.kind : 'unknown';
      lastSeekRef.current = null;
      if (kind === 'system') return;

      const t = video.currentTime || 0;
      const seg = pickSegmentAtTime({
        segments: activeSegmentsRef.current,
        t,
        predicate: (s) => s.type === ContentType.WATER
      });
      if (seg) {
        const untilTime = getConnectedBlockEnd({
          segments: activeSegmentsRef.current,
          anchor: seg,
          predicate: (s) => s.type === ContentType.WATER
        });
        allowWaterRef.current = { untilTime };
      } else {
        allowWaterRef.current = null;
      }
    };

    const attach = (video: HTMLVideoElement) => {
      video.addEventListener('seeked', onSeeked);
      return () => video.removeEventListener('seeked', onSeeked);
    };

    const tick = () => {
      const next = getVideoElement();
      if (!next) {
        // If the old video was removed from DOM, detach.
        if (current && !document.contains(current)) {
          cleanup();
          current = null;
          cleanup = () => {};
        }
        return;
      }
      if (next === current) return;
      cleanup();
      current = next;
      cleanup = attach(next);
    };

    tick();
    const id = window.setInterval(tick, 800);
    return () => {
      window.clearInterval(id);
      cleanup();
    };
  }, []);

  const resolveCurrentVideoMeta = useCallback(async (): Promise<VideoMeta | null> => {
    if (!bvid) return null;
    const fromState = getVideoMetaFromInitialState(page);
    if (fromState?.videoId && fromState.bvid === bvid) return fromState;
    try {
      return await fetchVideoMetaFromApi(bvid, page);
    } catch {
      return null;
    }
  }, [bvid, page]);

  const refreshState = useCallback(async (nextVideoId?: string, opts?: { setSegments?: boolean }) => {
    let id = nextVideoId ?? videoId ?? bvid;
    if (!id) {
      setIsHistoryLoading(false);
      return;
    }
    setIsHistoryLoading(true);
    try {
      // Important: DB keys are `${bvid}_${cid}`. If we only have `bvid`,
      // resolve `cid` first; otherwise refresh may falsely show "暂无记录".
      if (!String(id).includes('_')) {
        const meta = await resolveCurrentVideoMeta();
        if (meta?.videoId) {
          id = meta.videoId;
          setVideoId(meta.videoId);
          if (meta.title) setVideoTitle(meta.title);
          if (meta.durationSec && Number.isFinite(meta.durationSec) && meta.durationSec > 0) {
            setDurationSec(meta.durationSec);
          }
        }
      }

      const resp = await chrome.runtime.sendMessage({ type: 'GET_VIDEO_STATE', videoId: id });
      if (resp?.ok && resp.data?.video) {
        setVideoTitle(resp.data.video.title ?? '');
        setDurationSec(resp.data.video.durationSec ?? 0);
        setVideoId(resp.data.video.videoId ?? id);
      }
      if (resp?.ok && Array.isArray(resp.data?.segments)) {
        if (opts?.setSegments === false) return;
        // Avoid wiping in-memory results while the background is still persisting data.
        if (resp.data.segments.length > 0 || segmentsRef.current.length === 0) {
          setSegments(resp.data.segments);
        }
      }
    } finally {
      setIsHistoryLoading(false);
    }
  }, [bvid, videoId, resolveCurrentVideoMeta]);

  useEffect(() => {
    if (!bvid) {
      setIsHistoryLoading(false);
      return;
    }
    refreshState(videoId ?? bvid).catch(() => setIsHistoryLoading(false));
  }, [bvid, page, videoId, refreshState]);

  // B站是 SPA 路由：在同一 tab 切换视频时 URL 会变化但 content script 不会重载
  useEffect(() => {
    let lastHref = window.location.href;
    const timer = window.setInterval(() => {
      const href = window.location.href;
      if (href === lastHref) return;
      lastHref = href;
      const next = getBvidFromUrl(href);
      const nextPage = getPageFromUrl(href);
      if (next !== bvid || nextPage !== page) {
        currentVideoKeyRef.current = null;
        setBvid(next);
        setPage(nextPage);
        setVideoId(null);
        setError('');
        setIsAnalyzing(false);
        setProgress(0);
        setResults([]);
        setQuery('');
        setSearchMode('');
        setSearchNote('');
        setExportStatus('');
        setVideoTitle('');
        setDurationSec(0);
        setSegments([]);
        setPreviousSegments(null);
        setSegmentsView('current');
        setIsHistoryLoading(true);
        pendingSegmentsRef.current = new Map();
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [bvid, page, refreshState]);

  const activeSegments = useMemo(() => {
    if (segmentsView === 'previous' && previousSegments) return previousSegments;
    return segments;
  }, [previousSegments, segments, segmentsView]);

  const activeSegmentsRef = useRef<Segment[]>([]);
  useEffect(() => {
    activeSegmentsRef.current = activeSegments;
  }, [activeSegments]);

  const sortedActiveSegments = useMemo(() => {
    return activeSegments.slice().sort((a, b) => a.startTime - b.startTime);
  }, [activeSegments]);

  const sortedActiveSegmentsRef = useRef<Segment[]>([]);
  useEffect(() => {
    sortedActiveSegmentsRef.current = sortedActiveSegments;
  }, [sortedActiveSegments]);

  const lastSeekRef = useRef<{ kind: 'system' | 'user'; atMs: number } | null>(null);
  const allowWaterRef = useRef<{ untilTime: number } | null>(null);

  const mergeSegments = useCallback((base: Segment[], incoming: Segment[]): Segment[] => {
    const next = new Map(base.map((s) => [s.id, s] as const));
    for (const s of incoming) {
      const old = next.get(s.id);
      next.set(s.id, old ? { ...old, ...s } : s);
    }
    return Array.from(next.values());
  }, []);

  useEffect(() => {
    chrome.runtime
      .sendMessage({ type: 'GET_CONFIG' })
      .then((resp) => {
        if (!resp?.ok) return;
        setAutoAnalyzeOnOpen(Boolean(resp.data?.analysis?.autoAnalyzeOnOpen));
        setAutoSkip(Boolean(resp.data?.analysis?.autoSkip));
        setDeveloperMode(Boolean(resp.data?.developerMode));
        const enabled = resp.data?.waterFilter?.enabledTypes;
        if (Array.isArray(enabled)) setWaterEnabledTypes(enabled as WaterReasonType[]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: chrome.storage.AreaName
    ) => {
      if (areaName !== 'local') return;
      const next = changes?.config?.newValue as any;
      if (!next) return;
      setAutoAnalyzeOnOpen(Boolean(next?.analysis?.autoAnalyzeOnOpen));
      setAutoSkip(Boolean(next?.analysis?.autoSkip));
      setDeveloperMode(Boolean(next?.developerMode));
      const enabled = next?.waterFilter?.enabledTypes;
      if (Array.isArray(enabled)) setWaterEnabledTypes(enabled as WaterReasonType[]);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    const handler = (message: BackgroundPush) => {
      const current = currentVideoKeyRef.current;
      if (!current) return;
      if (current && message.videoId !== current) {
        const curHasCid = String(current).includes('_');
        const msgHasCid = String(message.videoId).includes('_');
        if (curHasCid && msgHasCid) return;
        const curBvid = String(current).split('_')[0] ?? '';
        const msgBvid = String(message.videoId).split('_')[0] ?? '';
        if (!curBvid || !msgBvid || curBvid !== msgBvid) return;
      }
      if (message.type === 'SEEK_TO') {
        const video = getVideoElement();
        if (!video) return;
        const t = Math.max(0, Number((message as any).timeSec ?? 0));
        if (!Number.isFinite(t)) return;
        lastSeekRef.current = { kind: 'system', atMs: Date.now() };
        video.currentTime = t;
        lastKnownTimeRef.current = t;
        setCurrentTimeSec(t);
        return;
      }
      if (message.type === 'ANALYSIS_ERROR') {
        if (uiModeRef.current === 'closed') setUiMode('open');
        setIsAnalyzing(false);
        setError(message.error);
        setReflection(null);
        return;
      }
      if (message.type === 'ANALYSIS_UPDATE') {
        if (uiModeRef.current === 'closed') setUiMode('open');
        setIsAnalyzing(true);
        setError('');
        setProgress(message.progress);
        if (Array.isArray(message.segments) && message.segments.length > 0) {
          for (const s of message.segments) pendingSegmentsRef.current.set(s.id, s);
        }
        return;
      }
      if (message.type === 'ANALYSIS_DONE') {
        if (uiModeRef.current === 'closed') setUiMode('open');
        setIsAnalyzing(false);
        setProgress(1);
        const nextSegments = Array.from(pendingSegmentsRef.current.values());
        if (nextSegments.length > 0) {
          if (segmentsRef.current.length > 0) setPreviousSegments(segmentsRef.current);
          setSegments(nextSegments);
          setSegmentsView('current');
        }
        pendingSegmentsRef.current = new Map();
        refreshState(message.videoId, { setSegments: false }).catch(() => {});
        return;
      }
      if (message.type === 'REFLECTION_UPDATE') {
        if (developerMode && uiModeRef.current === 'closed') setUiMode('open');
        setReflection({ progress: message.progress, completed: message.completed, total: message.total });
        if (Array.isArray(message.segments) && message.segments.length > 0) {
          setSegments((prev) => mergeSegments(prev, message.segments!));
          setPreviousSegments((prev) => (prev ? mergeSegments(prev, message.segments!) : prev));
        }
        return;
      }
    };
    chrome.runtime.onMessage.addListener(handler as any);
    return () => chrome.runtime.onMessage.removeListener(handler as any);
  }, [developerMode, mergeSegments, refreshState]);

  const startAnalysis = useCallback(async () => {
    if (!bvid) return;
    setError('');
    if (segmentsRef.current.length > 0) setPreviousSegments(segmentsRef.current);
    setSegmentsView('current');
    pendingSegmentsRef.current = new Map();
    setIsAnalyzing(true);
    setProgress(0);
    setReflection(null);
    try {
      const currentPage = page || getPageFromUrl(window.location.href);
      const meta = getVideoMetaFromInitialState(currentPage) ?? (await fetchVideoMetaFromApi(bvid, currentPage));
      if (!meta?.aid || !meta?.cid) throw new Error('未从页面解析到视频信息（可能是 B站页面结构变化）');
      const video = getVideoElement();
      const resolvedDurationSec =
        meta.durationSec && Number.isFinite(meta.durationSec) && meta.durationSec > 0
          ? meta.durationSec
          : video && Number.isFinite(video.duration) && video.duration > 0
            ? Math.ceil(video.duration)
            : 0;
      if (!resolvedDurationSec) throw new Error('未获取到视频时长（请先播放几秒后重试）');
      const resolvedMeta: VideoMeta = { ...meta, durationSec: resolvedDurationSec, videoId: meta.videoId ?? buildVideoId(meta.bvid, meta.cid) };
      const resolvedVideoId = resolvedMeta.videoId ?? bvid;
      setVideoTitle(resolvedMeta.title ?? '');
      setDurationSec(resolvedDurationSec);
      setVideoId(resolvedVideoId);
      currentVideoKeyRef.current = resolvedVideoId;
      let captions: CaptionLine[] | undefined;
      try {
        const lines = await fetchCaptionsFromPage(resolvedMeta);
        if (lines.length > 0) captions = lines;
      } catch {
        // If page-side subtitle fetch fails (often CORS), fall back to background fetching.
      }
      await chrome.runtime.sendMessage({
        type: 'START_INCREMENTAL_ANALYSIS',
        videoId: resolvedVideoId,
        bvid,
        currentTimeSec: lastKnownTimeRef.current,
        video: resolvedMeta,
        ...(captions ? { captions } : {})
      });
    } catch (e: any) {
      setIsAnalyzing(false);
      setProgress(0);
      setError(String(e?.message ?? e));
    }
  }, [bvid, page]);

  useEffect(() => {
    if (!autoAnalyzeOnOpen) return;
    if (!bvid) return;
    if (segments.length > 0) return;
    startAnalysis().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAnalyzeOnOpen, bvid]);

  const currentSegment = useMemo(() => {
    const t = currentTimeSec;
    const water = pickSegmentAtTime({ segments: activeSegments, t, predicate: (s) => s.type === ContentType.WATER });
    if (water) return water;
    const dry = pickSegmentAtTime({ segments: activeSegments, t, predicate: (s) => s.type === ContentType.DRY });
    return dry;
  }, [activeSegments, currentTimeSec]);

  const setAutoSkipPersist = useCallback(async (next: boolean) => {
    setAutoSkip(next);
    try {
      await chrome.runtime.sendMessage({ type: 'SET_CONFIG', config: { analysis: { autoSkip: next } } });
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!autoSkip) return;
    const timer = window.setInterval(() => {
      const video = getVideoElement();
      if (!video) return;
      if (video.paused) return;
      const t = video.currentTime || 0;

      const sorted = sortedActiveSegmentsRef.current;
      if (!sorted || sorted.length === 0) return;

      const hold = allowWaterRef.current;
      if (hold) {
        const anyWater = pickSegmentAtTime({
          segments: sorted,
          t,
          predicate: (s) => s.type === ContentType.WATER
        });
        if (!anyWater || !Number.isFinite(hold.untilTime) || t >= hold.untilTime) {
          allowWaterRef.current = null;
        } else {
          return;
        }
      }

      const enabledTypes = waterEnabledTypes;
      const currentWater = pickSegmentAtTime({
        segments: sorted,
        t,
        predicate: (s) => isAutoSkippableWater(s, enabledTypes)
      });

      // Case 1: already inside skippable WATER.
      if (currentWater) {
        const untilTime = getConnectedBlockEnd({
          segments: sorted,
          anchor: currentWater,
          predicate: (s) => isAutoSkippableWater(s, enabledTypes)
        });
        if (!Number.isFinite(untilTime) || untilTime <= t + 0.01) return;
        lastSeekRef.current = { kind: 'system', atMs: Date.now() };
        video.currentTime = untilTime;
        return;
      }

      // Case 2: about to enter skippable WATER — skip proactively.
      // DX: avoid "toggle = instant jump" surprise; only start proactive skipping a moment after enabling.
      const since = autoSkipSinceRef.current;
      if (since && Date.now() - since < 1200) return;

      const nextWater = sorted.find(
        (s) => isAutoSkippableWater(s, enabledTypes) && Number.isFinite(s.startTime) && Number(s.startTime) >= t
      );
      if (!nextWater) return;
      const dt = Number(nextWater.startTime) - t;
      if (!Number.isFinite(dt) || dt < 0 || dt > 2.0) return;
      const untilTime = getConnectedBlockEnd({
        segments: sorted,
        anchor: nextWater,
        predicate: (s) => isAutoSkippableWater(s, enabledTypes)
      });
      if (!Number.isFinite(untilTime) || untilTime <= t + 0.01) return;
      lastSeekRef.current = { kind: 'system', atMs: Date.now() };
      video.currentTime = untilTime;
    }, 250);
    return () => window.clearInterval(timer);
  }, [autoSkip, waterEnabledTypes]);

  const seek = useCallback((time: number) => {
    const video = getVideoElement();
    if (!video) return;
    const t = Math.max(0, time);
    lastSeekRef.current = { kind: 'user', atMs: Date.now() };
    video.currentTime = t;
    lastKnownTimeRef.current = t;
    setCurrentTimeSec(t);
  }, []);

  const cancel = useCallback(async () => {
    const id = videoId ?? bvid;
    if (!id) return;
    await chrome.runtime.sendMessage({ type: 'CANCEL_ANALYSIS', videoId: id });
    setIsAnalyzing(false);
    setProgress(0);
  }, [bvid, videoId]);

  const doExport = useCallback(async () => {
    const id = videoId ?? bvid;
    if (!id) return;
    const resp = await chrome.runtime.sendMessage({ type: 'EXPORT_MARKDOWN', videoId: id });
    if (!resp?.ok) {
      setExportStatus(resp?.error ?? '导出失败');
      return;
    }
    const md = resp.data?.markdown ?? '';
    const filename = resp.data?.filename ?? `${id}.md`;
    try {
      await navigator.clipboard.writeText(md);
      setExportStatus('已复制到剪贴板');
    } catch {
      setExportStatus('复制失败（可能无权限），将直接下载');
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setTimeout(() => setExportStatus(''), 1500);
  }, [bvid, videoId]);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    const id = videoId ?? bvid;
    if (!id) return;
    const resp = await chrome.runtime.sendMessage({ type: 'SEARCH_IN_VIDEO', videoId: id, query: q, topK: 5 });
    if (!resp?.ok) {
      setError(resp?.error ?? '搜索失败');
      return;
    }
    setResults(resp.data?.items ?? []);
    setSearchMode(resp.data?.mode ?? '');
    setSearchNote(resp.data?.note ?? '');
  }, [bvid, query, videoId]);

  const dryPercent = useMemo(() => {
    if (!durationSec || activeSegments.length === 0) return 0;
    return getDryPercent({ segments: activeSegments, totalDurationSec: durationSec });
  }, [activeSegments, durationSec]);

  const analysisData: AnalysisResult | null = useMemo(() => {
    const id = videoId ?? bvid;
    if (!id) return null;
    if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0) return null;
    if (activeSegments.length === 0) return null;

    const dry = activeSegments
      .filter((s) => s.type === ContentType.DRY)
      .slice()
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 6)
      .map((s) => `- ${s.summary}`)
      .join('\n');

    return {
      videoId: id,
      title: videoTitle || bvid || id,
      totalDuration: durationSec,
      segments: activeSegments,
      logicBlocks: [],
      overallSummary: dry ? `本视频干货要点：\n${dry}` : '暂无摘要（请先分析）。',
      processedAt: new Date().toISOString()
    };
  }, [activeSegments, bvid, durationSec, videoId, videoTitle]);

  const openDashboard = useCallback(() => {
    const id = videoId ?? bvid;
    if (!id) return;
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD', videoId: id }).catch(() => {
      const url = chrome.runtime.getURL(`dashboard.html#${encodeURIComponent(id)}`);
      window.open(url, '_blank');
    });
  }, [bvid, videoId]);

  const subtitle = useMemo(() => {
    if (!bvid) return '';
    const p = page > 1 ? `p${page}` : '';
    const cid = videoId?.includes('_') ? videoId.split('_')[1] : '';
    return `BV: ${bvid}${p ? ` · ${p}` : ''}${cid ? ` · cid:${cid}` : ''}`;
  }, [bvid, page, videoId]);

  const minimizeToBall = useCallback(() => {
    setUiMode('minimized');
    setBallPos((prev) => {
      const next = { x: panelPos.x + PANEL_SIZE.w - BALL_SIZE, y: panelPos.y + 8 };
      // If user already moved the ball, keep their choice unless panel is far away.
      const dist = Math.abs(prev.x - next.x) + Math.abs(prev.y - next.y);
      const pos = dist > 500 ? next : prev;
      return clampPoint(pos, window.innerWidth - BALL_SIZE, window.innerHeight - BALL_SIZE);
    });
  }, [panelPos.x, panelPos.y]);

  const closeOverlay = useCallback(() => {
    setUiMode('closed');
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (uiMode === 'open') minimizeToBall();
        else if (uiMode === 'minimized') closeOverlay();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeOverlay, minimizeToBall, uiMode]);

  return (
    <div className="z-[2147483647]">
      {uiMode === 'open' && (
        <div
          style={{ position: 'fixed', left: `${panelPos.x}px`, top: `${panelPos.y}px`, zIndex: 2147483647 }}
        >
          <PluginView
            data={analysisData}
            isAnalyzing={isAnalyzing}
            onAnalyze={startAnalysis}
            onOpenDashboard={openDashboard}
            onMinimize={minimizeToBall}
            onClose={closeOverlay}
            developerMode={developerMode}
            verificationStatus={developerMode ? (reflection ?? undefined) : undefined}
            onHeaderPointerDown={(e) => {
              const el = e.target as HTMLElement | null;
              if (el && el.closest('button')) return;
              startDrag('panel', e);
            }}
            subtitle={subtitle}
            error={error}
            isHistoryLoading={isHistoryLoading}
            progress={isAnalyzing ? progress : undefined}
            heatmap={
              analysisData
                ? {
                    currentTime: currentTimeSec,
                    onSeek: seek,
                    interactive: true
                  }
                : undefined
            }
            extra={
              analysisData ? (
                <div className="space-y-3">
                  {previousSegments && !isAnalyzing && (
                    <button
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50"
                      onClick={() => setSegmentsView((v) => (v === 'current' ? 'previous' : 'current'))}
                    >
                      {segmentsView === 'current' ? '查看上次分析' : '返回本次分析'}
                    </button>
                  )}
                  <div className="flex gap-2">
                    <button
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-40"
                      onClick={doExport}
                      disabled={activeSegments.length === 0}
                    >
                      导出 MD
                    </button>
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs">
                    <span className="text-gray-700">
                      自动跳过注水（{autoSkip ? '已开启' : '已关闭'}，快要进入注水段会绕开）
                    </span>
                    <input
                      type="checkbox"
                      checked={autoSkip}
                      onChange={(e) => setAutoSkipPersist(e.target.checked)}
                    />
                  </label>
                  <div className="text-[10px] text-gray-400">
                    当前：{currentSegment ? (currentSegment.type === ContentType.WATER ? '注水' : '干货') : '未命中片段'}
                  </div>
                  <div className="text-[10px] text-gray-400">注水类别过滤：可在设置页调整（重复/广告/无信息增量/寒暄/跑题）。</div>
                  <div className="text-[10px] text-gray-400">提示：你手动拖进注水段时，不会强制自动跳过。</div>
                  {isAnalyzing && (
                    <button
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50"
                      onClick={cancel}
                    >
                      取消分析
                    </button>
                  )}
                  {exportStatus && <div className="text-[11px] text-gray-500">{exportStatus}</div>}

                  <div className="rounded-lg border border-gray-200 bg-white p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-gray-700">本视频搜索</div>
                      {searchMode && <div className="text-[10px] text-gray-500">{searchMode === 'semantic' ? '语义' : '关键词'}</div>}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input
                        className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-xs outline-none focus:border-bilibili-blue"
                        placeholder="例如：这节课的结论是什么？"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') doSearch();
                        }}
                      />
                      <button className="rounded-md bg-gray-900 px-2 py-1 text-xs font-semibold text-white hover:opacity-90" onClick={doSearch}>
                        搜索
                      </button>
                    </div>
                    {searchNote && <div className="mt-1 text-[11px] text-gray-500">{searchNote}</div>}
                    {results.length > 0 && (
                      <div className="mt-2 max-h-40 overflow-auto bdry-scrollbar space-y-2">
                        {results.map((r, idx) => (
                          <button
                            key={`${r.startTime}:${r.endTime}:${idx}`}
                            className="w-full rounded-md border border-gray-100 bg-gray-50 p-2 text-left hover:bg-gray-100"
                            onClick={() => {
                              const t = Math.max(0, Math.floor(r.startTime));
                              const video = getVideoElement();
                              if (!video) return;
                              video.currentTime = t;
                              video.play().catch(() => {});
                            }}
                          >
                            <div className="flex justify-between gap-2 text-[11px] text-gray-600">
                              <span className="truncate">命中片段</span>
                              <span className="shrink-0 font-mono">{formatTime(r.startTime)}</span>
                            </div>
                            <div className="mt-1 text-xs text-gray-800">{r.snippet}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50"
                    onClick={refreshState}
                  >
                    刷新本地状态
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <div className="text-xs font-semibold text-gray-700">干货热力图</div>
                    <div className="mt-2">
                      <HeatmapBar segments={activeSegments} totalDuration={durationSec || 1} currentTime={currentTimeSec} onSeek={seek} />
                    </div>
                    <div className="mt-2 flex justify-between text-[10px] text-gray-400 font-mono">
                      <span>0:00</span>
                      <span>{durationSec ? formatTime(durationSec) : '--:--'}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500">{durationSec ? `干货≈${dryPercent}%` : '未加载'}</div>
                  </div>

                  <button
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50"
                    onClick={refreshState}
                  >
                    刷新本地状态
                  </button>
                </div>
              )
            }
          />
        </div>
      )}

      {uiMode === 'minimized' && (
        <button
          type="button"
          style={{
            position: 'fixed',
            left: `${ballPos.x}px`,
            top: `${ballPos.y}px`,
            width: `${BALL_SIZE}px`,
            height: `${BALL_SIZE}px`,
            zIndex: 2147483647
          }}
          className="rounded-full bg-bilibili-pink text-white shadow-2xl border border-white/30 flex items-center justify-center hover:opacity-90 active:scale-[0.98]"
          onPointerDown={(e) => startDrag('ball', e)}
          aria-label="打开 BilibiliDry"
          title="打开 BilibiliDry"
        >
          <Zap size={22} className="text-white" />
        </button>
      )}
    </div>
  );
};

export default OverlayApp;

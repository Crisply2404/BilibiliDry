import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HeatmapBar from '../../components/HeatmapBar';
import PluginView from '../../components/PluginView';
import type { Segment } from '../../types';
import { ContentType } from '../../types';
import type { BackgroundPush } from '../shared/messages';
import type { CaptionLine, VideoMeta } from '../shared/messages';
import type { AnalysisResult } from '../../types';
import { Zap } from 'lucide-react';

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
  return document.querySelector('video');
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

function getNextDryStart(segments: Segment[], currentTime: number): number | null {
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  const idx = sorted.findIndex((s) => currentTime >= s.startTime && currentTime < s.endTime);
  if (idx === -1) {
    const next = sorted.find((s) => s.type === ContentType.DRY && s.startTime > currentTime);
    return next ? next.startTime : null;
  }
  const current = sorted[idx];
  const next = sorted.slice(idx + 1).find((s) => s.type === ContentType.DRY);
  if (!next) return null;
  return current.type === ContentType.WATER ? next.startTime : next.startTime;
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
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [durationSec, setDurationSec] = useState<number>(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [previousSegments, setPreviousSegments] = useState<Segment[] | null>(null);
  const [segmentsView, setSegmentsView] = useState<'current' | 'previous'>('current');
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
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

  const refreshState = useCallback(async (nextVideoId?: string, opts?: { setSegments?: boolean }) => {
    const id = nextVideoId ?? videoId ?? bvid;
    if (!id) return;
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
  }, [bvid, videoId]);

  useEffect(() => {
    refreshState().catch(() => {});
  }, [refreshState]);

  // Best-effort: when page/bvid changes (分P/切视频)，尽快从页面状态解析出 videoId（bvid+cid）以便加载正确的本地数据。
  useEffect(() => {
    if (!bvid) return;
    const meta = getVideoMetaFromInitialState(page);
    if (!meta?.videoId) return;
    setVideoId(meta.videoId);
    if (meta.title) setVideoTitle(meta.title);
    if (meta.durationSec && meta.durationSec > 0) setDurationSec(meta.durationSec);
    refreshState(meta.videoId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bvid, page]);

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
        pendingSegmentsRef.current = new Map();
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [bvid, page, refreshState]);

  const activeSegments = useMemo(() => {
    if (segmentsView === 'previous' && previousSegments) return previousSegments;
    return segments;
  }, [previousSegments, segments, segmentsView]);

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
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (message: BackgroundPush) => {
      const current = currentVideoKeyRef.current;
      if (!current) return;
      if (current && message.videoId !== current) return;
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
        if (uiModeRef.current === 'closed') setUiMode('open');
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
  }, [mergeSegments, refreshState]);

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

  const skip = useCallback(() => {
    const video = getVideoElement();
    if (!video) {
      setError('未找到播放器 video 元素');
      return;
    }
    const next = getNextDryStart(activeSegments, video.currentTime || 0);
    if (next == null) {
      setError('未找到下一个干货片段');
      return;
    }
    video.currentTime = next;
  }, [activeSegments]);

  useEffect(() => {
    if (!autoSkip) return;
    const timer = window.setInterval(() => {
      const video = getVideoElement();
      if (!video) return;
      const t = video.currentTime || 0;
      const current = activeSegments.find((s) => t >= s.startTime && t < s.endTime);
      if (!current || current.type !== ContentType.WATER) return;
      const next = getNextDryStart(activeSegments, t);
      if (next == null) return;
      video.currentTime = next;
    }, 600);
    return () => window.clearInterval(timer);
  }, [activeSegments, autoSkip]);

  const seek = useCallback((time: number) => {
    const video = getVideoElement();
    if (!video) return;
    const t = Math.max(0, time);
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
    const dry = activeSegments
      .filter((s) => s.type === ContentType.DRY)
      .reduce((acc, cur) => acc + Math.max(0, cur.endTime - cur.startTime), 0);
    return Math.round((dry / durationSec) * 100);
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
            verificationStatus={reflection ?? undefined}
            onHeaderPointerDown={(e) => {
              const el = e.target as HTMLElement | null;
              if (el && el.closest('button')) return;
              startDrag('panel', e);
            }}
            subtitle={subtitle}
            error={error}
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
                      className="flex-1 rounded-lg bg-bilibili-pink px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
                      onClick={skip}
                      disabled={activeSegments.length === 0}
                    >
                      一键跳过注水
                    </button>
                    <button
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-40"
                      onClick={doExport}
                      disabled={activeSegments.length === 0}
                    >
                      导出 MD
                    </button>
                  </div>
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HeatmapBar from '../../components/HeatmapBar';
import type { Segment } from '../../types';
import { ContentType } from '../../types';
import type { BackgroundPush } from '../shared/messages';

type SearchResultItem = { videoId: string; title: string; startTime: number; score: number; snippet: string };

function getBvidFromUrl(url: string): string | null {
  const match = url.match(/\/video\/(BV[a-zA-Z0-9]+)/);
  return match?.[1] ?? null;
}

function getVideoElement(): HTMLVideoElement | null {
  return document.querySelector('video');
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
  const bvid = useMemo(() => getBvidFromUrl(window.location.href), []);
  const [autoAnalyzeOnOpen, setAutoAnalyzeOnOpen] = useState(false);
  const [autoSkip, setAutoSkip] = useState(false);
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [durationSec, setDurationSec] = useState<number>(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [exportStatus, setExportStatus] = useState<string>('');

  const lastKnownTimeRef = useRef<number>(0);
  useEffect(() => {
    const tick = () => {
      const video = getVideoElement();
      if (video) lastKnownTimeRef.current = video.currentTime || 0;
    };
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, []);

  const refreshState = useCallback(async () => {
    if (!bvid) return;
    const resp = await chrome.runtime.sendMessage({ type: 'GET_VIDEO_STATE', videoId: bvid });
    if (resp?.ok && resp.data?.video) {
      setVideoTitle(resp.data.video.title ?? '');
      setDurationSec(resp.data.video.durationSec ?? 0);
    }
    if (resp?.ok && Array.isArray(resp.data?.segments)) {
      setSegments(resp.data.segments);
    }
  }, [bvid]);

  useEffect(() => {
    refreshState().catch(() => {});
  }, [refreshState]);

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
      if (message.type === 'ANALYSIS_ERROR') {
        setIsAnalyzing(false);
        setError(message.error);
        return;
      }
      if (message.type === 'ANALYSIS_UPDATE') {
        setIsAnalyzing(true);
        setError('');
        setProgress(message.progress);
        if (Array.isArray(message.segments) && message.segments.length > 0) {
          setSegments((prev) => {
            const next = new Map(prev.map((s) => [s.id, s] as const));
            for (const s of message.segments!) next.set(s.id, s);
            return Array.from(next.values());
          });
        }
        return;
      }
      if (message.type === 'ANALYSIS_DONE') {
        setIsAnalyzing(false);
        setProgress(1);
      }
    };
    chrome.runtime.onMessage.addListener(handler as any);
    return () => chrome.runtime.onMessage.removeListener(handler as any);
  }, []);

  const startAnalysis = useCallback(async () => {
    if (!bvid) return;
    setError('');
    setIsAnalyzing(true);
    setProgress(0);
    await chrome.runtime.sendMessage({
      type: 'START_INCREMENTAL_ANALYSIS',
      bvid,
      currentTimeSec: lastKnownTimeRef.current
    });
  }, [bvid]);

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
    const next = getNextDryStart(segments, video.currentTime || 0);
    if (next == null) {
      setError('未找到下一个干货片段');
      return;
    }
    video.currentTime = next;
  }, [segments]);

  useEffect(() => {
    if (!autoSkip) return;
    const timer = window.setInterval(() => {
      const video = getVideoElement();
      if (!video) return;
      const t = video.currentTime || 0;
      const current = segments.find((s) => t >= s.startTime && t < s.endTime);
      if (!current || current.type !== ContentType.WATER) return;
      const next = getNextDryStart(segments, t);
      if (next == null) return;
      video.currentTime = next;
    }, 600);
    return () => window.clearInterval(timer);
  }, [autoSkip, segments]);

  const seek = useCallback((time: number) => {
    const video = getVideoElement();
    if (!video) return;
    video.currentTime = Math.max(0, time);
  }, []);

  const cancel = useCallback(async () => {
    if (!bvid) return;
    await chrome.runtime.sendMessage({ type: 'CANCEL_ANALYSIS', videoId: bvid });
    setIsAnalyzing(false);
    setProgress(0);
  }, [bvid]);

  const doExport = useCallback(async () => {
    if (!bvid) return;
    const resp = await chrome.runtime.sendMessage({ type: 'EXPORT_MARKDOWN', videoId: bvid });
    if (!resp?.ok) {
      setExportStatus(resp?.error ?? '导出失败');
      return;
    }
    const md = resp.data?.markdown ?? '';
    const filename = resp.data?.filename ?? `${bvid}.md`;
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
  }, [bvid]);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    const resp = await chrome.runtime.sendMessage({ type: 'SEARCH_QUERY', query: q, topK: 5 });
    if (!resp?.ok) {
      setError(resp?.error ?? '搜索失败');
      return;
    }
    setResults(resp.data?.results ?? []);
  }, [query]);

  const dryPercent = useMemo(() => {
    if (!durationSec || segments.length === 0) return 0;
    const dry = segments
      .filter((s) => s.type === ContentType.DRY)
      .reduce((acc, cur) => acc + Math.max(0, cur.endTime - cur.startTime), 0);
    return Math.round((dry / durationSec) * 100);
  }, [durationSec, segments]);

  return (
    <div className="fixed right-4 top-20 z-[2147483647] w-[360px] rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900">BilibiliDry</div>
          <div className="max-w-[260px] truncate text-[11px] text-slate-500">{videoTitle || bvid || '未识别 BV'}</div>
        </div>
        <button
          className="rounded-md bg-bilibili-blue px-2 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
          onClick={startAnalysis}
          disabled={!bvid}
        >
          {isAnalyzing ? '分析中…' : '分析'}
        </button>
      </div>

      <div className="space-y-3 px-3 py-3">
        {error && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</div>}

        <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
          <div className="flex items-baseline justify-between">
            <div className="text-xs font-semibold text-slate-700">干货热力图</div>
            <div className="text-[11px] text-slate-500">
              {durationSec ? `干货≈${dryPercent}%` : '未加载'}
              {isAnalyzing ? ` · ${Math.round(progress * 100)}%` : ''}
            </div>
          </div>
          <div className="mt-2">
            <HeatmapBar segments={segments} totalDuration={durationSec || 1} currentTime={lastKnownTimeRef.current} onSeek={seek} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400 font-mono">
            <span>0:00</span>
            <span>{durationSec ? formatTime(durationSec) : '--:--'}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            className="flex-1 rounded-lg bg-bilibili-pink px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
            onClick={skip}
            disabled={segments.length === 0}
          >
            一键跳过注水
          </button>
          <button
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
            onClick={doExport}
            disabled={segments.length === 0}
          >
            导出 MD
          </button>
        </div>
        {isAnalyzing && (
          <button
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            onClick={cancel}
          >
            取消分析
          </button>
        )}
        {exportStatus && <div className="text-[11px] text-slate-500">{exportStatus}</div>}

        <div className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="text-xs font-semibold text-slate-700">跨视频搜索</div>
          <div className="mt-2 flex gap-2">
            <input
              className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-bilibili-blue"
              placeholder="例如：RSC 序列化"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSearch();
              }}
            />
            <button className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:opacity-90" onClick={doSearch}>
              搜索
            </button>
          </div>
          {results.length > 0 && (
            <div className="mt-2 max-h-40 overflow-auto bdry-scrollbar space-y-2">
              {results.map((r, idx) => (
                <button
                  key={`${r.videoId}:${r.startTime}:${idx}`}
                  className="w-full rounded-md border border-slate-100 bg-slate-50 p-2 text-left hover:bg-slate-100"
                  onClick={() => window.open(`https://www.bilibili.com/video/${r.videoId}?t=${Math.floor(r.startTime)}`, '_blank')}
                >
                  <div className="flex justify-between gap-2 text-[11px] text-slate-600">
                    <span className="truncate">{r.title}</span>
                    <span className="shrink-0 font-mono">{formatTime(r.startTime)}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-800">{r.snippet}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          onClick={refreshState}
        >
          刷新本地状态
        </button>
      </div>
    </div>
  );
};

export default OverlayApp;

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import HeatmapBar from '../../components/HeatmapBar';
import { ContentType, type Segment } from '../../types';

type VideoRecord = { videoId: string; title: string; durationSec: number; lastAnalyzedAt?: string };

function getVideoId(): string {
  return decodeURIComponent((location.hash || '').replace(/^#/, ''));
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const DashboardApp: React.FC = () => {
  const videoId = useMemo(() => getVideoId(), []);
  const [video, setVideo] = useState<VideoRecord | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState<string>('');

  const refresh = useCallback(async () => {
    if (!videoId) {
      setError('缺少 videoId（URL hash）');
      return;
    }
    const resp = await chrome.runtime.sendMessage({ type: 'GET_VIDEO_STATE', videoId });
    if (!resp?.ok) {
      setError(resp?.error ?? '读取失败');
      return;
    }
    setVideo(resp.data?.video ?? null);
    setSegments(resp.data?.segments ?? []);
    setError('');
  }, [videoId]);

  useEffect(() => {
    refresh().catch((e) => setError(String(e?.message ?? e)));
  }, [refresh]);

  const duration = video?.durationSec ?? 1;
  const dryPercent = useMemo(() => {
    if (!video?.durationSec) return 0;
    const dry = segments
      .filter((s) => s.type === ContentType.DRY)
      .reduce((acc, cur) => acc + Math.max(0, cur.endTime - cur.startTime), 0);
    return Math.round((dry / video.durationSec) * 100);
  }, [segments, video?.durationSec]);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">{videoId || '未知视频'}</div>
            <h1 className="text-xl font-bold text-slate-900">{video?.title ?? '未加载（请先在视频页点击分析）'}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              onClick={() => window.open(`https://www.bilibili.com/video/${videoId}`, '_blank')}
            >
              打开视频
            </button>
            <button
              className="rounded-lg bg-bilibili-blue px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
              onClick={refresh}
            >
              刷新
            </button>
          </div>
        </div>

        {error && <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-semibold text-slate-900">热力图</div>
            <div className="text-xs text-slate-500">
              干货≈{dryPercent}% · 分析时间：{video?.lastAnalyzedAt ?? '--'}
            </div>
          </div>
          <HeatmapBar segments={segments} totalDuration={duration} currentTime={0} onSeek={() => {}} />
          <div className="flex justify-between text-[10px] text-slate-400 font-mono">
            <span>0:00</span>
            <span>{video?.durationSec ? formatTime(video.durationSec) : '--:--'}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-900">片段列表</div>
          <div className="mt-3 divide-y divide-slate-100">
            {segments
              .slice()
              .sort((a, b) => a.startTime - b.startTime)
              .map((s) => (
                <div key={s.id} className="flex items-start gap-3 py-3">
                  <div className="w-24 shrink-0 font-mono text-xs text-slate-500">
                    {formatTime(s.startTime)}-{formatTime(s.endTime)}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm text-slate-900">{s.summary}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {s.type === ContentType.DRY ? '干货' : '注水'} · conf={Math.round(s.confidence * 100)}%
                    </div>
                  </div>
                  <button
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                    onClick={() => window.open(`https://www.bilibili.com/video/${videoId}?t=${Math.floor(s.startTime)}`, '_blank')}
                  >
                    跳转
                  </button>
                </div>
              ))}
            {segments.length === 0 && <div className="py-6 text-sm text-slate-500">暂无片段。请回到视频页点击“分析”。</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardApp;


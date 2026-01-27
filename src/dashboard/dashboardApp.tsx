import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DashboardView from '../../components/DashboardView';
import type { AnalysisResult, Segment } from '../../types';

type VideoRecord = { videoId: string; title: string; durationSec: number; lastAnalyzedAt?: string };

function getVideoId(): string {
  return decodeURIComponent((location.hash || '').replace(/^#/, ''));
}

function buildAnalysisResult(video: VideoRecord, segments: Segment[]): AnalysisResult {
  const dry = segments
    .slice()
    .filter((s) => s.type === 'DRY')
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map((s) => `- ${s.summary}`)
    .join('\n');

  return {
    videoId: video.videoId,
    title: video.title,
    totalDuration: video.durationSec,
    processedAt: video.lastAnalyzedAt ?? new Date().toISOString(),
    overallSummary: dry ? `本视频干货要点：\n${dry}` : '暂无摘要（请先分析）。',
    segments,
    logicBlocks: []
  };
}

const DashboardApp: React.FC = () => {
  const [videoId, setVideoId] = useState<string>(() => getVideoId());
  const [video, setVideo] = useState<VideoRecord | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const onHashChange = () => setVideoId(getVideoId());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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

  const data = useMemo(() => {
    if (!video) return null;
    return buildAnalysisResult(video, segments);
  }, [segments, video]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-2xl rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-2xl rounded-lg bg-white p-4 text-sm text-slate-700">
          未加载到分析数据，请回到视频页点击“分析”。（videoId: {videoId || '未知'}）
        </div>
      </div>
    );
  }

  return <DashboardView data={data} onBack={() => window.close()} />;
};

export default DashboardApp;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardView from '../../components/DashboardView';
import type { AnalysisResult, AnalysisRun, LogicBlock, Segment } from '../../types';
import { LogicType } from '../../types';

type VideoRecord = {
  videoId: string;
  bvid: string;
  cid: number;
  page?: number;
  title: string;
  durationSec: number;
  lastAnalyzedAt?: string;
};

type BenchmarkState = {
  running: boolean;
  progress: number;
  mode?: 'cascade' | 'strong_only';
  message?: string;
  error?: string;
};

function getVideoId(): string {
  return decodeURIComponent((location.hash || '').replace(/^#/, ''));
}

function buildLogicBlocksV0(params: { segments: Segment[]; totalDuration: number }): LogicBlock[] {
  const dry = params.segments.filter((s) => s.type === 'DRY');
  if (dry.length === 0) return [];

  const byTime = dry.slice().sort((a, b) => a.startTime - b.startTime);
  const pickClosest = (target: number): Segment => {
    let best = byTime[0];
    let bestDist = Math.abs(Number(best.startTime) - target);
    for (const s of byTime) {
      const dist = Math.abs(Number(s.startTime) - target);
      if (dist < bestDist) {
        best = s;
        bestDist = dist;
      }
    }
    return best;
  };

  const byConfidence = dry.slice().sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0));

  const used = new Set<string>();
  const takeUnique = (candidate: Segment, fallbackList: Segment[]): Segment => {
    if (!used.has(candidate.id)) {
      used.add(candidate.id);
      return candidate;
    }
    for (const s of fallbackList) {
      if (!used.has(s.id)) {
        used.add(s.id);
        return s;
      }
    }
    return candidate;
  };

  const total = Number(params.totalDuration) || 0;
  const background = takeUnique(byTime[0], byTime);
  const problem = takeUnique(pickClosest(Math.max(0, total * 0.25)), byTime);
  const solution = takeUnique(byConfidence[0], byConfidence);
  const caseSeg = takeUnique(pickClosest(Math.max(0, total * 0.75)), byTime.slice().reverse());

  return [
    {
      id: `v0_background_${background.id}`,
      type: LogicType.BACKGROUND,
      title: '背景与前置',
      description: background.summary,
      relatedSegments: [background.id]
    },
    {
      id: `v0_problem_${problem.id}`,
      type: LogicType.PROBLEM,
      title: '核心问题',
      description: problem.summary,
      relatedSegments: [problem.id]
    },
    {
      id: `v0_solution_${solution.id}`,
      type: LogicType.SOLUTION,
      title: '关键结论 / 方法',
      description: solution.summary,
      relatedSegments: [solution.id]
    },
    {
      id: `v0_case_${caseSeg.id}`,
      type: LogicType.CASE,
      title: '例子 / 案例',
      description: caseSeg.summary,
      relatedSegments: [caseSeg.id]
    }
  ];
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
    logicBlocks: buildLogicBlocksV0({ segments, totalDuration: video.durationSec })
  };
}

const DashboardApp: React.FC = () => {
  const [videoId, setVideoId] = useState<string>(() => getVideoId());
  const [video, setVideo] = useState<VideoRecord | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [developerMode, setDeveloperMode] = useState(false);
  const [benchmark, setBenchmark] = useState<BenchmarkState>({ running: false, progress: 0 });
  const [error, setError] = useState<string>('');
  const autoRefreshRef = useRef<{ videoId: string; tries: number; timer: number | null } | null>(null);

  useEffect(() => {
    const onHashChange = () => setVideoId(getVideoId());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    chrome.runtime
      .sendMessage({ type: 'GET_CONFIG' })
      .then((resp) => {
        if (!resp?.ok) return;
        setDeveloperMode(Boolean(resp.data?.developerMode));
      })
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    if (!videoId) {
      setError('缺少 videoId（URL hash）');
      return;
    }
    const [stateResp, runsResp] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_VIDEO_STATE', videoId }),
      chrome.runtime.sendMessage({ type: 'GET_ANALYSIS_RUNS', videoId })
    ]);
    if (!stateResp?.ok) {
      setError(stateResp?.error ?? '读取失败');
      return;
    }
    setVideo(stateResp.data?.video ?? null);
    setSegments(stateResp.data?.segments ?? []);
    if (runsResp?.ok) setRuns(Array.isArray(runsResp.data?.runs) ? (runsResp.data.runs as AnalysisRun[]) : []);
    setError('');
  }, [videoId]);

  useEffect(() => {
    refresh().catch((e) => setError(String(e?.message ?? e)));
  }, [refresh]);

  useEffect(() => {
    setBenchmark({ running: false, progress: 0 });
  }, [videoId]);

  useEffect(() => {
    const handler = (msg: any) => {
      if (!msg) return;
      if (String(msg.videoId ?? '') !== String(videoId ?? '')) return;

      if (msg.type === 'BENCHMARK_UPDATE') {
        setBenchmark({
          running: true,
          progress: Number.isFinite(Number(msg.progress)) ? Number(msg.progress) : 0,
          mode: msg.mode === 'cascade' || msg.mode === 'strong_only' ? msg.mode : undefined,
          message: typeof msg.message === 'string' ? msg.message : '',
          error: ''
        });
        return;
      }

      if (msg.type === 'BENCHMARK_DONE') {
        setBenchmark({
          running: false,
          progress: 1,
          mode: msg.mode === 'cascade' || msg.mode === 'strong_only' ? msg.mode : undefined,
          message: '对照实验完成',
          error: ''
        });
        refresh().catch(() => {});
        return;
      }

      if (msg.type === 'BENCHMARK_ERROR') {
        setBenchmark({
          running: false,
          progress: 0,
          mode: msg.mode === 'cascade' || msg.mode === 'strong_only' ? msg.mode : undefined,
          message: '',
          error: String(msg.error ?? '对照实验失败')
        });
      }
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [refresh, videoId]);

  const runBenchmark = useCallback(async () => {
    if (!videoId) return;
    setBenchmark({ running: true, progress: 0, error: '' });
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'RUN_BENCHMARK_ALTERNATIVE', videoId });
      if (!resp?.ok) {
        setBenchmark({ running: false, progress: 0, error: String(resp?.error ?? '对照实验启动失败') });
      } else {
        setBenchmark((prev) => ({ ...prev, running: true, mode: resp?.data?.mode }));
      }
    } catch (e: any) {
      setBenchmark({ running: false, progress: 0, error: String(e?.message ?? e ?? '对照实验启动失败') });
    }
  }, [videoId]);

  useEffect(() => {
    if (!developerMode) return;
    if (!videoId) return;
    const hasVerification = segments.some((s: any) => Boolean(s?.verification));
    if (hasVerification) {
      const cur = autoRefreshRef.current;
      if (cur?.timer) window.clearInterval(cur.timer);
      autoRefreshRef.current = null;
      return;
    }

    // Best-effort: dashboard may open before Reflection Gate finishes; poll for a short time.
    if (autoRefreshRef.current?.videoId === videoId) return;
    const timer = window.setInterval(() => {
      const cur = autoRefreshRef.current;
      if (!cur) return;
      if (cur.tries >= 10) {
        if (cur.timer) window.clearInterval(cur.timer);
        autoRefreshRef.current = null;
        return;
      }
      cur.tries += 1;
      refresh().catch(() => {});
    }, 1500);
    autoRefreshRef.current = { videoId, tries: 0, timer };
    return () => {
      const cur = autoRefreshRef.current;
      if (cur?.timer) window.clearInterval(cur.timer);
      autoRefreshRef.current = null;
    };
  }, [developerMode, refresh, segments, videoId]);

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

  return (
    <DashboardView
      data={data}
      runs={runs}
      video={video ?? undefined}
      developerMode={developerMode}
      benchmark={benchmark}
      onRunBenchmark={runBenchmark}
      onBack={() => window.close()}
    />
  );
};

export default DashboardApp;

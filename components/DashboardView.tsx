import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnalysisResult, AnalysisRun, Segment, LogicBlock, ContentType } from '../types';
import HeatmapBar from './HeatmapBar';
import LogicBlocks from './LogicBlocks';
import VerificationPanel from './VerificationPanel';
import { ArrowLeft, Download, ExternalLink, Search, Share2 } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

interface DashboardViewProps {
  data: AnalysisResult;
  runs?: AnalysisRun[];
  video?: { bvid: string; page?: number; videoId: string };
  developerMode?: boolean;
  onBack: () => void;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function waterReasonLabelZh(t?: string): string {
  switch (t) {
    case 'REPEAT':
      return '重复';
    case 'AD':
      return '广告';
    case 'NO_NEW_INFO':
      return '无信息增量';
    case 'SMALLTALK':
      return '寒暄';
    case 'OFFTOPIC':
      return '跑题';
    default:
      return '';
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const DashboardView: React.FC<DashboardViewProps> = ({ data, runs, video, developerMode, onBack }) => {
  const [playerBaseSec, setPlayerBaseSec] = useState(0);
  const [playerTimeSec, setPlayerTimeSec] = useState(0);
  const [playerNonce, setPlayerNonce] = useState(0);
  const [progressSync, setProgressSync] = useState(true);
  const [externalSyncAgeMs, setExternalSyncAgeMs] = useState<number | null>(null);
  const [segmentTab, setSegmentTab] = useState<'DRY' | 'WATER'>('DRY');
  const [activeSegment, setActiveSegment] = useState<Segment | null>(null);
  const lastTickMsRef = useRef<number>(Date.now());
  const lastExternalUpdateMsRef = useRef<number | null>(null);

  const latestRun = Array.isArray(runs) && runs.length > 0 ? runs[0] : null;
  const showDeveloperPanels = Boolean(developerMode);
  const prevRun = Array.isArray(runs) && runs.length > 1 ? runs[1] : null;

  const summarizeStage = (run: AnalysisRun | null, stage: 'cheap' | 'strong') => {
    const list = (run?.metrics ?? []).filter((m) => m.stage === stage);
    const calls = list.length;
    const totalMs = list.reduce((acc, cur) => acc + (Number(cur.latencyMs) || 0), 0);
    const reqChars = list.reduce((acc, cur) => acc + (Number(cur.requestChars) || 0), 0);
    const respChars = list.reduce((acc, cur) => acc + (Number(cur.responseChars) || 0), 0);
    return { calls, totalMs, reqChars, respChars };
  };

  const bvid = video?.bvid || String(data.videoId || '').split('_')[0] || '';
  const page = video?.page && Number.isFinite(video.page) && video.page > 1 ? Math.floor(video.page) : 1;

  const buildWatchUrl = (tSec: number): string => {
    const t = Math.max(0, Math.floor(Number(tSec) || 0));
    const p = page > 1 ? `p=${page}&` : '';
    return `https://www.bilibili.com/video/${encodeURIComponent(bvid)}?${p}t=${t}`;
  };

  const buildEmbedUrl = (tSec: number): string => {
    const t = Math.max(0, Math.floor(Number(tSec) || 0));
    const p = page > 1 ? `&page=${page}` : '';
    return `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}${p}&high_quality=1&danmaku=0&t=${t}`;
  };

  const seekTo = (time: number) => {
    const t = Math.max(0, Math.floor(Number(time) || 0));
    setPlayerBaseSec(t);
    setPlayerTimeSec(t);
    setPlayerNonce((n) => n + 1);
    lastTickMsRef.current = Date.now();
  };

  const videoId = video?.videoId ?? data.videoId;

  const seekExternal = (time: number) => {
    const id = String(videoId ?? '').trim();
    if (!id) return;
    const t = Math.max(0, Number(time) || 0);
    chrome.runtime.sendMessage({ type: 'SEEK_VIDEO', videoId: id, timeSec: t }).catch(() => {});
  };

  const seekAll = (time: number) => {
    seekTo(time);
    seekExternal(time);
  };

  useEffect(() => {
    const t = Number(playerTimeSec) || 0;
    const seg = data.segments.find((s) => t >= s.startTime && t < s.endTime) ?? null;
    setActiveSegment(seg);
  }, [data.segments, playerTimeSec]);

  useEffect(() => {
    const id = String(videoId ?? '').trim();
    if (!id) return;

    const port = chrome.runtime.connect({ name: 'DASHBOARD_PLAYER_SYNC' });
    port.postMessage({ type: 'SUBSCRIBE_PLAYER_TIME', videoId: id });

    const onMsg = (msg: any) => {
      if (!msg || msg.type !== 'PLAYER_TIME') return;
      if (String(msg.videoId ?? '') !== id) return;
      const state = msg.state ?? {};
      const t = Number(state.currentTimeSec ?? NaN);
      const updatedAtMs = Number(state.updatedAtMs ?? NaN);
      if (!Number.isFinite(t)) return;

      if (progressSync) {
        setPlayerTimeSec(t);
        lastTickMsRef.current = Date.now();
      }

      if (Number.isFinite(updatedAtMs)) {
        lastExternalUpdateMsRef.current = updatedAtMs;
        setExternalSyncAgeMs(Math.max(0, Date.now() - updatedAtMs));
      } else {
        lastExternalUpdateMsRef.current = Date.now();
        setExternalSyncAgeMs(0);
      }
    };

    port.onMessage.addListener(onMsg);
    return () => {
      try {
        port.onMessage.removeListener(onMsg);
      } catch {
        // ignore
      }
      try {
        port.disconnect();
      } catch {
        // ignore
      }
    };
  }, [progressSync, videoId]);

  useEffect(() => {
    if (!progressSync) return;
    const id = window.setInterval(() => {
      const updatedAtMs = lastExternalUpdateMsRef.current;
      if (!updatedAtMs) return;
      setExternalSyncAgeMs(Math.max(0, Date.now() - updatedAtMs));
    }, 500);
    return () => window.clearInterval(id);
  }, [progressSync]);

  useEffect(() => {
    if (!progressSync) return;
    lastTickMsRef.current = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const dt = Math.max(0, (now - lastTickMsRef.current) / 1000);
      lastTickMsRef.current = now;
      setPlayerTimeSec((prev) => {
        const next = Number(prev) + dt;
        return clamp(next, 0, Math.max(0, Number(data.totalDuration) || 0));
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [data.totalDuration, progressSync]);

  const handleBlockClick = (block: LogicBlock) => {
      // Find the first segment related to this block (simplified logic)
      if (block.relatedSegments.length > 0) {
          // In a real app we'd map ID to time, here assume ID matches index logic or direct find
          // For demo, just finding the first dry segment if logical mapping is complex
          const segId = block.relatedSegments[0];
          const segment = data.segments.find(s => s.id === segId);
          if (segment) seekAll(segment.startTime);
      } else {
        // Fallback: Just seek to a random dry spot for demo
        seekAll(data.totalDuration * 0.2);
      }
  };

  const chartData = useMemo(() => {
    const stepSec = 10;
    const windowSec = 60;
    const halfWindow = windowSec / 2;
    const total = Math.max(0, Math.floor(Number(data.totalDuration) || 0));
    const sorted = data.segments
      .slice()
      .filter((s) => Number.isFinite(s.startTime) && Number.isFinite(s.endTime) && s.endTime > s.startTime)
      .sort((a, b) => a.startTime - b.startTime);

    const densityAt = (t: number): number => {
      const start = clamp(t - halfWindow, 0, total);
      const end = clamp(t + halfWindow, 0, total);
      const span = Math.max(1, end - start);

      let score = 0;
      for (const s of sorted) {
        if (s.endTime <= start) continue;
        if (s.startTime >= end) break;
        const overlapStart = Math.max(start, s.startTime);
        const overlapEnd = Math.min(end, s.endTime);
        const overlap = overlapEnd - overlapStart;
        if (!(overlap > 0)) continue;
        if (s.type !== ContentType.DRY) continue;
        score += overlap * clamp(Number(s.confidence) || 0, 0, 1);
      }

      return clamp((score / span) * 100, 0, 100);
    };

    const points: Array<{ t: number; density: number }> = [];
    if (total <= 0) return points;

    for (let t = 0; t <= total; t += stepSec) {
      points.push({ t, density: densityAt(t) });
    }
    if (points.length === 0 || points[points.length - 1]!.t !== total) {
      points.push({ t: total, density: densityAt(total) });
    }

    // Extra smoothing (moving average) for better visual stability.
    const radius = 2;
    return points.map((p, idx) => {
      let acc = 0;
      let n = 0;
      for (let i = idx - radius; i <= idx + radius; i += 1) {
        const item = points[i];
        if (!item) continue;
        acc += item.density;
        n += 1;
      }
      return { ...p, density: n > 0 ? acc / n : p.density };
    });
  }, [data.segments, data.totalDuration]);

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-gray-800 font-sans flex flex-col">
      {/* Navbar */}
      <nav className="bg-white shadow-sm h-16 px-6 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="font-bold text-xl text-gray-800">知识仪表盘</h1>
          <span className="bg-bilibili-pink/10 text-bilibili-pink px-2 py-0.5 rounded text-xs font-medium border border-bilibili-pink/20">
            {data.title}
          </span>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
             <Share2 size={16} /> 分享
          </button>
          <button className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-bilibili-blue hover:bg-blue-500 rounded-lg transition-colors shadow-md shadow-blue-200">
             <Download size={16} /> 导出至 Notion
          </button>
        </div>
      </nav>

      <main className="flex-1 container mx-auto p-6 grid grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: Video & Visuals (8 cols) */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-6">
          
          {/* Video Player (Embed + Fallback) */}
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
              <div className="text-sm font-semibold text-gray-800">视频播放</div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500 font-mono">定位 {formatTime(playerTimeSec)}</div>
                {externalSyncAgeMs !== null ? (
                  <div className="text-[10px] text-gray-400 font-mono" title="来自 B 站页面的真实播放进度（由 content-script 上报）">
                    外部同步 {Math.round(externalSyncAgeMs / 1000)}s 前
                  </div>
                ) : null}
                <button
                  className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                  onClick={() => {
                    setProgressSync((v) => !v);
                    lastTickMsRef.current = Date.now();
                  }}
                  title="受跨域限制，Dashboard 无法读取 iframe 播放器的真实播放时间；这里用本地计时器近似同步。"
                >
                  进度同步：{progressSync ? '开' : '关'}
                </button>
                {bvid ? (
                  <button
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    onClick={() => window.open(buildWatchUrl(playerTimeSec), '_blank')}
                  >
                    <ExternalLink size={14} /> 在 B 站打开
                  </button>
                ) : null}
              </div>
            </div>

            <div className="bg-black aspect-video">
              {bvid ? (
                <iframe
                  key={playerNonce}
                  className="h-full w-full"
                  src={buildEmbedUrl(playerBaseSec)}
                  title="Bilibili Player"
                  allow="autoplay; fullscreen; picture-in-picture"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-sm text-white/70">
                  未获取到 bvid，无法内嵌播放（可回到视频页重新打开 Dashboard）
                </div>
              )}
            </div>

            <div className="px-4 py-3">
              <HeatmapBar
                segments={data.segments}
                totalDuration={data.totalDuration}
                currentTime={playerTimeSec}
                onSeek={(t) => seekAll(t)}
              />
              <div className="mt-2 text-[11px] text-gray-500">
                提示：Dashboard 里跳转时间点会重新加载播放器（跨域限制，先保证“能用”）。
              </div>
              {activeSegment ? (
                <div className="mt-2 rounded-md bg-gray-50 p-2 text-xs text-gray-700 border border-gray-100">
                  当前片段：{activeSegment.type === 'DRY' ? '干货' : '注水'}
                  {activeSegment.type === 'WATER' ? (
                    <>
                      {waterReasonLabelZh((activeSegment as any).waterReasonType) ? `（${waterReasonLabelZh((activeSegment as any).waterReasonType)}）` : ''}
                      ：{(activeSegment as any).waterReasonText || activeSegment.summary}
                    </>
                  ) : (
                    <>：{activeSegment.summary}</>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {/* Analytics Area */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Search size={20} className="text-bilibili-pink" /> 
                知识密度 & 语义记忆
            </h2>
            <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height={256} minWidth={200} minHeight={256}>
                    <AreaChart
                      data={chartData}
                      onClick={(e: any) => {
                        const t = Number(e?.activeLabel);
                        if (!Number.isFinite(t)) return;
                        seekAll(t);
                      }}
                    >
                        <defs>
                            <linearGradient id="colorDensity" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#23ADE5" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="#23ADE5" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="t"
                          type="number"
                          domain={[0, Math.max(0, Number(data.totalDuration) || 0)]}
                          tickFormatter={(v) => formatTime(Number(v) || 0)}
                        />
                        <YAxis hide />
                        <Tooltip
                          formatter={(value) => [Math.round(Number(value) || 0), '密度']}
                          labelFormatter={(label) => formatTime(Number(label) || 0)}
                        />
                        <Area type="monotone" dataKey="density" stroke="#23ADE5" fillOpacity={1} fill="url(#colorDensity)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {showDeveloperPanels && latestRun && (
              <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-700">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">Model Cascade 指标（latest vs prev）</div>
                  <div className="font-mono text-[11px] text-gray-500">
                    {new Date(latestRun.startedAt).toLocaleString()}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  <div className="rounded-md bg-white p-2 border border-gray-100">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-gray-800">latest</div>
                      {latestRun.cheapModel || latestRun.strongModel ? (
                        <div className="text-[11px] text-gray-500">
                          {latestRun.cheapModel ? `cheap=${latestRun.cheapModel}` : ''}
                          {latestRun.strongModel ? ` strong=${latestRun.strongModel}` : ''}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-gray-600">
                      cheap: calls={summarizeStage(latestRun, 'cheap').calls} ms={summarizeStage(latestRun, 'cheap').totalMs} req={summarizeStage(latestRun, 'cheap').reqChars} resp={summarizeStage(latestRun, 'cheap').respChars}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-gray-600">
                      strong: calls={summarizeStage(latestRun, 'strong').calls} ms={summarizeStage(latestRun, 'strong').totalMs} req={summarizeStage(latestRun, 'strong').reqChars} resp={summarizeStage(latestRun, 'strong').respChars}
                    </div>
                    {latestRun.quality ? (
                      <div className="mt-1 text-[11px] text-gray-600">
                        质量：pass={latestRun.quality.pass} weak={latestRun.quality.weak} fail={latestRun.quality.fail} repaired={latestRun.quality.repaired}
                      </div>
                    ) : null}
                  </div>

                  {prevRun ? (
                    <div className="rounded-md bg-white p-2 border border-gray-100">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-gray-800">prev</div>
                        <div className="text-[11px] text-gray-500 font-mono">
                          {new Date(prevRun.startedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-gray-600">
                        cheap: calls={summarizeStage(prevRun, 'cheap').calls} ms={summarizeStage(prevRun, 'cheap').totalMs} req={summarizeStage(prevRun, 'cheap').reqChars} resp={summarizeStage(prevRun, 'cheap').respChars}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-gray-600">
                        strong: calls={summarizeStage(prevRun, 'strong').calls} ms={summarizeStage(prevRun, 'strong').totalMs} req={summarizeStage(prevRun, 'strong').reqChars} resp={summarizeStage(prevRun, 'strong').respChars}
                      </div>
                      {prevRun.quality ? (
                        <div className="mt-1 text-[11px] text-gray-600">
                          质量：pass={prevRun.quality.pass} weak={prevRun.quality.weak} fail={prevRun.quality.fail} repaired={prevRun.quality.repaired}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="mt-2 text-[10px] text-gray-500">注：此处用字符数/耗时做对比（不是精确 token 计费）。</div>
              </div>
            )}
            {showDeveloperPanels ? (
              <div className="mt-4">
                <VerificationPanel segments={data.segments} maxItems={6} title="关键干货校验（字幕证据）" onSeek={seekAll} />
              </div>
            ) : null}
          </div>

          {/* Segment Cards */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-gray-800">片段卡片</h2>
              <div className="flex gap-2">
                <button
                  className={`rounded-full px-3 py-1 text-xs font-semibold border ${segmentTab === 'DRY' ? 'bg-bilibili-blue text-white border-bilibili-blue' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                  onClick={() => setSegmentTab('DRY')}
                >
                  干货
                </button>
                <button
                  className={`rounded-full px-3 py-1 text-xs font-semibold border ${segmentTab === 'WATER' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                  onClick={() => setSegmentTab('WATER')}
                >
                  注水
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {data.segments
                .filter((s) => s.type === segmentTab)
                .slice()
                .sort((a, b) => a.startTime - b.startTime)
                .slice(0, 20)
                .map((s) => {
                  const reasonLabel = s.type === 'WATER' ? waterReasonLabelZh((s as any).waterReasonType) : '';
                  const reasonText = s.type === 'WATER' ? ((s as any).waterReasonText || '') : '';
                  return (
                    <div key={s.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs text-gray-500 font-mono">
                            {formatTime(s.startTime)} - {formatTime(s.endTime)}
                            {s.type === 'WATER' && reasonLabel ? (
                              <span className="ml-2 inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-700 border border-gray-200">
                                {reasonLabel}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-sm text-gray-800">
                            {s.type === 'WATER' ? (reasonText || s.summary) : s.summary}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50"
                            onClick={() => seekAll(s.startTime)}
                          >
                            在此播放
                          </button>
                          {bvid ? (
                            <button
                              className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50"
                              onClick={() => window.open(buildWatchUrl(s.startTime), '_blank')}
                            >
                              打开 B 站
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              {data.segments.filter((s) => s.type === segmentTab).length === 0 ? (
                <div className="text-sm text-gray-500">暂无该类型片段。</div>
              ) : null}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Logic Blocks (4 cols) */}
        <div className="col-span-12 lg:col-span-4 flex flex-col h-full overflow-hidden">
             <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col h-full max-h-[800px]">
                <div className="p-4 border-b border-gray-100">
                    <h2 className="font-bold text-lg">逻辑积木</h2>
                    <p className="text-xs text-gray-500">点击积木可跳转至对应视频片段</p>
                </div>
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    <LogicBlocks blocks={data.logicBlocks} onBlockClick={handleBlockClick} />
                </div>
                <div className="p-4 border-t border-gray-100 bg-gray-50">
                    <button 
                        className="w-full py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-600 font-medium hover:bg-gray-50 flex items-center justify-center gap-2"
                        onClick={() => alert("这将激活 Pinecone 中的自然语言搜索功能。")}
                    >
                        <Search size={14} /> 向 AI 提问关于此视频的内容
                    </button>
                </div>
             </div>
        </div>

      </main>
    </div>
  );
};

export default DashboardView;

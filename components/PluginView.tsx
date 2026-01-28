import React from 'react';
import { AnalysisResult, ContentType } from '../types';
import HeatmapBar from './HeatmapBar';
import HeatmapLegend from './HeatmapLegend';
import { ExternalLink, Zap, Activity } from 'lucide-react';

interface PluginViewProps {
  data: AnalysisResult | null;
  isAnalyzing: boolean;
  onOpenDashboard: () => void;
  onAnalyze: () => void;
  subtitle?: string;
  error?: string;
  progress?: number; // 0..1
  heatmap?: {
    currentTime: number;
    onSeek: (time: number) => void;
    interactive?: boolean;
  };
  extra?: React.ReactNode;
}

const PluginView: React.FC<PluginViewProps> = ({ data, isAnalyzing, onOpenDashboard, onAnalyze, subtitle, error, progress, heatmap, extra }) => {
  const dryPercent = data 
    ? Math.round((data.segments.filter(s => s.type === ContentType.DRY).reduce((acc, cur) => acc + (cur.endTime - cur.startTime), 0) / data.totalDuration) * 100)
    : 0;

  const formatTime = (seconds: number) => {
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  };

  const safeProgress = typeof progress === 'number' && Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : undefined;
  const heatmapCurrentTime = heatmap?.currentTime ?? 0;
  const heatmapOnSeek = heatmap?.onSeek ?? (() => {});
  const heatmapInteractive = Boolean(heatmap?.interactive);

  return (
    <div className="w-[380px] h-[560px] rounded-xl overflow-hidden bg-white/95 backdrop-blur border border-gray-200 shadow-2xl flex flex-col font-sans">
      {/* Header */}
      <div className="h-14 bg-bilibili-pink flex items-center justify-between px-4 text-white">
        <div className="flex items-center gap-2">
            <Zap className="fill-current" size={20} />
            <h1 className="font-bold text-lg text-white" style={{ color: '#fff' }}>BilibiliDry</h1>
        </div>
        <button
          onClick={onAnalyze}
          disabled={isAnalyzing}
          className="rounded-full bg-white/20 px-4 py-1.5 text-sm font-semibold backdrop-blur hover:bg-white/25 disabled:opacity-50"
        >
          {isAnalyzing ? '分析中…' : '分析'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 overflow-y-auto custom-scrollbar flex flex-col">
        {subtitle && (
          <div className="mb-3 text-xs text-gray-500 line-clamp-1">
            {subtitle}
          </div>
        )}

        {error && (
          <div className="mb-3 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
            {error}
          </div>
        )}

        {!data && !isAnalyzing && (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500 space-y-4">
                <Activity size={48} className="text-gray-300" />
                <p className="text-sm">暂无此视频的分析记录。</p>
                <button 
                    onClick={onAnalyze}
                    className="bg-bilibili-blue hover:bg-blue-500 text-white px-6 py-2 rounded-full font-medium transition-colors shadow-lg shadow-blue-200"
                >
                    提取视频干货
                </button>
            </div>
        )}

        {isAnalyzing && (
            <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-bilibili-pink"></div>
                <p className="text-sm text-gray-500 animate-pulse">Agent 协作处理中...</p>
                {typeof safeProgress === 'number' && (
                  <div className="w-full max-w-[260px]">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                      <div className="h-full bg-bilibili-blue transition-all" style={{ width: `${Math.round(safeProgress * 100)}%` }} />
                    </div>
                    <div className="mt-1 text-center text-[10px] text-gray-400 font-mono">{Math.round(safeProgress * 100)}%</div>
                  </div>
                )}
                <div className="text-xs text-gray-400">
                    <div>步骤 1: 字幕提取与 OCR 识别...</div>
                    <div>步骤 2: 语义注水内容识别...</div>
                </div>
            </div>
        )}

        {data && !isAnalyzing && (
            <div className="space-y-6">
                {/* Stats Card */}
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                    <h2 className="text-sm font-bold text-gray-700 mb-2 line-clamp-1">{data.title}</h2>
                    <div className="flex justify-between items-center text-xs text-gray-500 mb-3">
                        <span>干货含量: <span className="text-bilibili-blue font-bold text-lg">{dryPercent}%</span></span>
                        <span>节省时间: <span className="text-green-600 font-bold">~{Math.round((100-dryPercent) * data.totalDuration / 60 / 100)} 分钟</span></span>
                    </div>
                    {/* Mini Heatmap */}
                    <HeatmapBar 
                        segments={data.segments} 
                        totalDuration={data.totalDuration} 
                        currentTime={heatmapCurrentTime}
                        onSeek={heatmapOnSeek}
                        interactive={heatmapInteractive}
                    />
                    {/* Legend Row - Moved out here with better spacing */}
                    <div className="flex justify-between items-center text-[10px] text-gray-400 mt-2 font-mono">
                        <span>0:00</span>
                        <HeatmapLegend />
                        <span>{formatTime(data.totalDuration)}</span>
                    </div>
                </div>

                {/* Summary */}
                <div>
                    <h3 className="text-xs font-bold uppercase text-gray-400 mb-2">核心摘要</h3>
                    <p className="text-sm text-gray-700 leading-snug whitespace-pre-line">{data.overallSummary}</p>
                </div>

                {/* Quick Actions */}
                <div className="pt-2">
                    <button 
                        onClick={onOpenDashboard}
                        className="w-full bg-black text-white py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-gray-800 transition-colors"
                    >
                        <ExternalLink size={16} />
                        打开完整仪表盘
                    </button>
                    <p className="text-[10px] text-center text-gray-400 mt-2">支持导出 Markdown（后续可接 Notion）</p>
                </div>

                {extra ? <div className="pt-2">{extra}</div> : null}
            </div>
        )}
      </div>
    </div>
  );
};

export default PluginView;

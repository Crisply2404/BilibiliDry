import React, { useState, useEffect } from 'react';
import { AnalysisResult, Segment, LogicBlock } from '../types';
import HeatmapBar from './HeatmapBar';
import LogicBlocks from './LogicBlocks';
import { Play, Pause, SkipForward, ArrowLeft, Download, Search, Share2 } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

interface DashboardViewProps {
  data: AnalysisResult;
  onBack: () => void;
}

const DashboardView: React.FC<DashboardViewProps> = ({ data, onBack }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeSegment, setActiveSegment] = useState<Segment | null>(null);

  // Simulate Video Playback
  useEffect(() => {
    let interval: any;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime(prev => {
          if (prev >= data.totalDuration) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, data.totalDuration]);

  // Update active segment based on time
  useEffect(() => {
    const segment = data.segments.find(s => currentTime >= s.startTime && currentTime < s.endTime);
    setActiveSegment(segment || null);
  }, [currentTime, data.segments]);

  const handleSeek = (time: number) => {
    setCurrentTime(time);
    setIsPlaying(false); // Pause on seek
  };

  const handleBlockClick = (block: LogicBlock) => {
      // Find the first segment related to this block (simplified logic)
      if (block.relatedSegments.length > 0) {
          // In a real app we'd map ID to time, here assume ID matches index logic or direct find
          // For demo, just finding the first dry segment if logical mapping is complex
          const segId = block.relatedSegments[0];
          const segment = data.segments.find(s => s.id === segId);
          if (segment) handleSeek(segment.startTime);
      } else {
        // Fallback: Just seek to a random dry spot for demo
        handleSeek(data.totalDuration * 0.2);
      }
  };

  // Prepare chart data
  const chartData = data.segments.map(s => ({
    time: Math.floor(s.startTime / 60) + 'm',
    density: s.type === 'DRY' ? s.confidence * 100 : 10
  }));

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
          
          {/* Player Simulation */}
          <div className="bg-black aspect-video rounded-xl shadow-2xl relative overflow-hidden group">
             {/* Mock Content */}
             <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-white/20 text-6xl font-black uppercase tracking-widest select-none">Video Player</span>
             </div>
             
             {/* Dynamic Overlay Text (Simulating CC) */}
             <div className="absolute bottom-16 left-0 right-0 text-center px-10">
                <span className="bg-black/60 text-white px-3 py-1 rounded text-lg">
                    {activeSegment ? activeSegment.summary : "..."}
                </span>
             </div>

             {/* Controls Overlay */}
             <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                <div className="flex items-center justify-between mb-4 text-white">
                    <button 
                        onClick={() => setIsPlaying(!isPlaying)}
                        className="p-3 bg-white/20 hover:bg-bilibili-pink rounded-full backdrop-blur-sm transition-all"
                    >
                        {isPlaying ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" />}
                    </button>
                    <div className="font-mono text-sm">
                        {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, '0')} / 
                        {Math.floor(data.totalDuration / 60)}:{String(Math.floor(data.totalDuration % 60)).padStart(2, '0')}
                    </div>
                </div>
                {/* Heatmap Integrated in Player */}
                <HeatmapBar 
                    segments={data.segments} 
                    totalDuration={data.totalDuration} 
                    currentTime={currentTime} 
                    onSeek={handleSeek}
                />
             </div>
          </div>

          {/* Analytics Area */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Search size={20} className="text-bilibili-pink" /> 
                知识密度 & 语义记忆
            </h2>
            <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                        <defs>
                            <linearGradient id="colorDensity" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#23ADE5" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="#23ADE5" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="time" />
                        <YAxis hide />
                        <Tooltip />
                        <Area type="monotone" dataKey="density" stroke="#23ADE5" fillOpacity={1} fill="url(#colorDensity)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
            <div className="mt-4 p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
                <strong className="text-gray-900">Agent 反思:</strong> 系统在 03:00 到 05:00 之间检测到较高的信息密度。关于“Server Component 序列化”的片段与此前索引的 React 官方文档语义高度一致。
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
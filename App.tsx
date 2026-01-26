import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppState, AnalysisResult } from './types';
import { analyzeTranscriptWithGemini, getMockAnalysis } from './services/geminiService';
import PluginView from './components/PluginView';
import DashboardView from './components/DashboardView';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    viewMode: 'PLUGIN',
    isAnalyzing: false,
    currentVideoId: null,
    analysisResult: null,
    currentTime: 0
  });

  const [inputTranscript, setInputTranscript] = useState<string>("");

  // Handler for starting analysis
  const handleAnalyze = async () => {
    setState(prev => ({ ...prev, isAnalyzing: true }));
    
    try {
      let result: AnalysisResult;
      
      if (process.env.API_KEY && inputTranscript.trim().length > 50) {
        // Use Real Gemini API if Key exists and input provided
        result = await analyzeTranscriptWithGemini(inputTranscript);
      } else {
        // Fallback to Mock Data (Simulating the Planner Agent latency)
        await new Promise(resolve => setTimeout(resolve, 2000));
        result = getMockAnalysis();
      }

      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        analysisResult: result,
        currentVideoId: result.videoId
      }));
    } catch (error) {
      console.error("Analysis failed", error);
      alert("分析失败，请检查控制台或 API Key 配置。");
      setState(prev => ({ ...prev, isAnalyzing: false }));
    }
  };

  const switchToDashboard = () => {
    setState(prev => ({ ...prev, viewMode: 'DASHBOARD' }));
  };

  const switchToPlugin = () => {
    setState(prev => ({ ...prev, viewMode: 'PLUGIN' }));
  };

  // Rendering logic based on View Mode
  if (state.viewMode === 'DASHBOARD') {
    if (!state.analysisResult) return <div className="p-10">错误: 数据未加载。</div>;
    return <DashboardView data={state.analysisResult} onBack={switchToPlugin} />;
  }

  // Default: Plugin View Simulation
  // We wrap it in a container to center it on the screen for the demo purpose,
  // making it look like a popup floating over a blurred background.
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center bg-[url('https://picsum.photos/1920/1080?blur=5')] bg-cover">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
      
      <div className="relative z-10 flex gap-8 items-start">
        
        {/* The Plugin Simulator */}
        <PluginView 
          data={state.analysisResult} 
          isAnalyzing={state.isAnalyzing}
          onAnalyze={handleAnalyze}
          onOpenDashboard={switchToDashboard}
        />

        {/* Debug / Control Panel for the Demo */}
        {!state.analysisResult && !state.isAnalyzing && (
            <div className="w-[300px] bg-white p-6 rounded-lg shadow-xl border border-gray-200">
                <h3 className="font-bold text-gray-800 mb-2">演示控制台</h3>
                <p className="text-xs text-gray-500 mb-4">
                    在下方粘贴字幕以测试 Gemini 3 Flash，或留空以使用默认的“React Server Components”模拟数据。
                </p>
                <textarea 
                    className="w-full h-32 p-2 text-xs border border-gray-300 rounded mb-2"
                    placeholder="在此粘贴字幕..."
                    value={inputTranscript}
                    onChange={(e) => setInputTranscript(e.target.value)}
                />
                <button 
                    onClick={handleAnalyze}
                    className="w-full bg-bilibili-pink text-white py-2 rounded text-sm font-bold hover:bg-pink-600 transition"
                >
                    运行 Agent 分析
                </button>
            </div>
        )}
      </div>
    </div>
  );
};

export default App;
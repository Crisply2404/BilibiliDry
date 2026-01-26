import React, { useCallback, useEffect, useState } from 'react';
import { getConfig, setConfig } from '../shared/storage';

const OptionsApp: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [chunkSec, setChunkSec] = useState(90);
  const [autoAnalyzeOnOpen, setAutoAnalyzeOnOpen] = useState(false);
  const [autoSkip, setAutoSkip] = useState(false);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    getConfig().then((config) => {
      setApiKey(config.geminiApiKey ?? '');
      setChunkSec(config.analysis.chunkSec);
      setAutoAnalyzeOnOpen(config.analysis.autoAnalyzeOnOpen);
      setAutoSkip(config.analysis.autoSkip);
    });
  }, []);

  const save = useCallback(async () => {
    await setConfig({
      geminiApiKey: apiKey.trim() || undefined,
      analysis: {
        chunkSec,
        autoAnalyzeOnOpen,
        autoSkip
      }
    });
    setStatus('已保存');
    setTimeout(() => setStatus(''), 1200);
  }, [apiKey, chunkSec, autoAnalyzeOnOpen, autoSkip]);

  const clearLocalData = useCallback(async () => {
    const ok = confirm('将清空本地分析记录与记忆（segments/embeddings）。确定继续？');
    if (!ok) return;
    await chrome.runtime.sendMessage({ type: 'CLEAR_LOCAL_DATA' });
    setStatus('已清空');
    setTimeout(() => setStatus(''), 1200);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">BilibiliDry 设置</h1>
          <p className="mt-1 text-sm text-slate-600">
            BYOK：API Key 仅保存在本地（`chrome.storage.local`），不会上传到任何后端。
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-900">Gemini API Key</div>
          <input
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-bilibili-blue"
            placeholder="粘贴你的 Gemini API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div className="mt-2 text-xs text-slate-500">建议创建专用 Key 并开启用量监控。</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="text-sm font-semibold text-slate-900">分析设置</div>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-700">字幕分块时长（秒）</span>
            <input
              type="number"
              min={30}
              max={300}
              className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-sm"
              value={chunkSec}
              onChange={(e) => setChunkSec(Number(e.target.value))}
            />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-700">打开视频页自动开始分析</span>
            <input
              type="checkbox"
              checked={autoAnalyzeOnOpen}
              onChange={(e) => setAutoAnalyzeOnOpen(e.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-700">自动跳过注水</span>
            <input type="checkbox" checked={autoSkip} onChange={(e) => setAutoSkip(e.target.checked)} />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="rounded-lg bg-bilibili-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            onClick={save}
          >
            保存
          </button>
          <button
            className="rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
            onClick={clearLocalData}
          >
            清空本地记忆
          </button>
          <div className="text-sm text-slate-500">{status}</div>
        </div>
      </div>
    </div>
  );
};

export default OptionsApp;


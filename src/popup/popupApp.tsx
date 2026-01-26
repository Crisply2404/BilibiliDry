import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getConfig } from '../shared/storage';

async function getActiveBilibiliTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.url?.includes('bilibili.com/video/')) return undefined;
  return tab;
}

const PopupApp: React.FC = () => {
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('准备就绪');

  useEffect(() => {
    getConfig()
      .then((config) => setHasKey(Boolean(config.geminiApiKey)))
      .catch(() => setHasKey(false));
  }, []);

  const keyHint = useMemo(() => (hasKey ? '已配置' : '未配置'), [hasKey]);

  const start = useCallback(async () => {
    const tab = await getActiveBilibiliTab();
    if (!tab?.id || !tab.url) {
      setStatus('请打开一个 B 站视频页');
      return;
    }
    const bvidMatch = tab.url.match(/\/video\/(BV[a-zA-Z0-9]+)/);
    if (!bvidMatch) {
      setStatus('未识别到 BV 号');
      return;
    }
    setStatus('已发起分析…');
    await chrome.runtime.sendMessage({ type: 'START_INCREMENTAL_ANALYSIS', bvid: bvidMatch[1] });
  }, []);

  const openOptions = useCallback(async () => {
    await chrome.runtime.openOptionsPage();
  }, []);

  return (
    <div className="w-[360px] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-bold text-slate-900">BilibiliDry</div>
        <div className="text-xs text-slate-500">Gemini Key: {keyHint}</div>
      </div>
      <div className="text-xs text-slate-600">{status}</div>
      <button
        className="w-full rounded-lg bg-bilibili-blue py-2 text-sm font-semibold text-white hover:opacity-90"
        onClick={start}
      >
        开始/刷新分析（当前视频）
      </button>
      <button
        className="w-full rounded-lg border border-slate-200 bg-white py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        onClick={openOptions}
      >
        打开设置
      </button>
      <div className="text-[11px] text-slate-500">
        提示：插件会在视频页注入“热力图/跳过/导出/搜索”浮层。
      </div>
    </div>
  );
};

export default PopupApp;


import React, { useCallback, useEffect, useState } from 'react';
import { getConfig, setConfig } from '../shared/storage';
import type { WaterReasonType } from '../../types';

const OptionsApp: React.FC = () => {
  const [llmProvider, setLlmProvider] = useState<'gemini' | 'openai'>('gemini');

  const [developerMode, setDeveloperMode] = useState(false);

  const [geminiApiKey, setGeminiApiKey] = useState('');

  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openaiModel, setOpenaiModel] = useState('');
  const [cascadeEnabled, setCascadeEnabled] = useState(false);
  const [cheapModel, setCheapModel] = useState('');
  const [strongModel, setStrongModel] = useState('');
  const [strongTopK, setStrongTopK] = useState(6);
  const [verifyStatus, setVerifyStatus] = useState<string>('');

  const [qiniuAccessKey, setQiniuAccessKey] = useState('');
  const [qiniuSecretKey, setQiniuSecretKey] = useState('');
  const [qiniuBucket, setQiniuBucket] = useState('');
  const [qiniuDomain, setQiniuDomain] = useState('');

  const [chunkSec, setChunkSec] = useState(90);
  const [autoAnalyzeOnOpen, setAutoAnalyzeOnOpen] = useState(false);
  const [autoSkip, setAutoSkip] = useState(false);
  const [waterEnabledTypes, setWaterEnabledTypes] = useState<WaterReasonType[]>(['REPEAT', 'NO_NEW_INFO', 'AD', 'SMALLTALK', 'OFFTOPIC']);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    getConfig().then((config) => {
      setLlmProvider(config.llmProvider ?? 'gemini');
      setDeveloperMode(Boolean(config.developerMode));
      setGeminiApiKey(config.geminiApiKey ?? '');

      setOpenaiBaseUrl(config.openaiBaseUrl ?? '');
      setOpenaiApiKey(config.openaiApiKey ?? '');
      setOpenaiModel(config.openaiModel ?? '');
      setCascadeEnabled(Boolean(config.cascade?.enabled));
      setCheapModel(config.cascade?.cheapModel ?? '');
      setStrongModel(config.cascade?.strongModel ?? '');
      setStrongTopK(Number(config.cascade?.strongTopK ?? 6));

      setQiniuAccessKey(config.qiniuAccessKey ?? '');
      setQiniuSecretKey(config.qiniuSecretKey ?? '');
      setQiniuBucket(config.qiniuBucket ?? '');
      setQiniuDomain(config.qiniuDomain ?? '');

      setChunkSec(config.analysis.chunkSec);
      setAutoAnalyzeOnOpen(config.analysis.autoAnalyzeOnOpen);
      setAutoSkip(config.analysis.autoSkip);
      if (Array.isArray(config.waterFilter?.enabledTypes)) setWaterEnabledTypes(config.waterFilter!.enabledTypes as WaterReasonType[]);
    });
  }, []);

  const toggleWaterType = useCallback((t: WaterReasonType, enabled: boolean) => {
    setWaterEnabledTypes((prev) => {
      const set = new Set(prev);
      if (enabled) set.add(t);
      else set.delete(t);
      return Array.from(set.values());
    });
  }, []);

  const save = useCallback(async () => {
    await setConfig({
      llmProvider,
      developerMode,
      geminiApiKey: geminiApiKey.trim() || undefined,

      openaiBaseUrl: openaiBaseUrl.trim() || '',
      openaiApiKey: openaiApiKey.trim() || undefined,
      openaiModel: openaiModel.trim() || '',
      cascade: {
        enabled: cascadeEnabled,
        cheapModel: cheapModel.trim() || undefined,
        strongModel: strongModel.trim() || undefined,
        strongTopK: Math.max(1, Math.min(20, Math.floor(Number(strongTopK) || 6)))
      },
      waterFilter: {
        enabledTypes: waterEnabledTypes
      },

      qiniuAccessKey: qiniuAccessKey.trim() || undefined,
      qiniuSecretKey: qiniuSecretKey.trim() || undefined,
      qiniuBucket: qiniuBucket.trim() || undefined,
      qiniuDomain: qiniuDomain.trim() || undefined,

      analysis: {
        chunkSec,
        autoAnalyzeOnOpen,
        autoSkip
      }
    });
    setStatus('已保存');
    setTimeout(() => setStatus(''), 1200);
  }, [
    llmProvider,
    developerMode,
    geminiApiKey,
    openaiBaseUrl,
    openaiApiKey,
    openaiModel,
    cascadeEnabled,
    cheapModel,
    strongModel,
    strongTopK,
    waterEnabledTypes,
    qiniuAccessKey,
    qiniuSecretKey,
    qiniuBucket,
    qiniuDomain,
    chunkSec,
    autoAnalyzeOnOpen,
    autoSkip
  ]);

  const verifyConnection = useCallback(async () => {
    setVerifyStatus('验证中…');
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'TEST_LLM_CONNECTION' });
      if (resp?.ok) setVerifyStatus(`可用（${String(resp.data?.modelTag ?? resp.data?.source ?? '').trim() || 'ok'}）`);
      else setVerifyStatus(resp?.error ?? '验证失败');
    } catch (e: any) {
      setVerifyStatus(String(e?.message ?? e));
    } finally {
      setTimeout(() => setVerifyStatus(''), 2500);
    }
  }, []);

  const clearLocalData = useCallback(async () => {
    const ok = confirm('将清空本地分析记录与记忆（segments 等）。确定继续？');
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
            BYOK：所有 Key 仅保存在本地（`chrome.storage.local`），不会上传到任何后端。
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="text-sm font-semibold text-slate-900">LLM Provider</div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={llmProvider === 'gemini'} onChange={() => setLlmProvider('gemini')} />
              <span>Gemini</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={llmProvider === 'openai'} onChange={() => setLlmProvider('openai')} />
              <span>OpenAI-compatible</span>
            </label>
          </div>

          {llmProvider === 'gemini' && (
            <div>
              <div className="text-sm font-semibold text-slate-900">Gemini API Key</div>
              <input
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-bilibili-blue"
                placeholder="粘贴你的 Gemini API Key"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
              />
              <div className="mt-2 text-xs text-slate-500">用于字幕分块分析与本视频语义搜索（重排）。</div>
            </div>
          )}

          {llmProvider === 'openai' && (
            <div className="space-y-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">OpenAI Base URL</div>
                <input
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-bilibili-blue"
                  placeholder="例如：https://api.qnaigc.com/v1"
                  value={openaiBaseUrl}
                  onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                />
                <div className="mt-1 text-xs text-slate-500">
                  需要在 `manifest.config.ts` 的 `host_permissions` 中允许该域名；目前内置允许 `api.qnaigc.com` / `api.openai.com` / `api.x.ai` / `right.codes`。
                </div>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">OpenAI API Key</div>
                <input
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-bilibili-blue"
                  placeholder="粘贴你的 OpenAI-compatible Key"
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Model</div>
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-bilibili-blue"
                    placeholder="例如：gpt-5.2"
                    value={openaiModel}
                    onChange={(e) => setOpenaiModel(e.target.value)}
                  />
                  <div className="mt-1 text-xs text-slate-500">未启用 Model Cascade 时，分析/校验将使用此模型。</div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Model Cascade</div>
                    <div className="text-xs text-slate-500">先 cheap 粗筛出热力图，再 strong 只精炼 Top 干货。</div>
                  </div>
                  <input type="checkbox" checked={cascadeEnabled} onChange={(e) => setCascadeEnabled(e.target.checked)} />
                </div>
                {cascadeEnabled && (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Cheap Model（粗筛）</div>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-bilibili-blue"
                        placeholder="留空则使用上面的 Model"
                        value={cheapModel}
                        onChange={(e) => setCheapModel(e.target.value)}
                      />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Strong Model（精炼）</div>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-bilibili-blue"
                        placeholder="留空则使用上面的 Model"
                        value={strongModel}
                        onChange={(e) => setStrongModel(e.target.value)}
                      />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Strong TopK</div>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-bilibili-blue"
                        value={strongTopK}
                        onChange={(e) => setStrongTopK(Number(e.target.value))}
                      />
                      <div className="mt-1 text-xs text-slate-500">只对最关键的 TopK 干货段做精炼。</div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  onClick={verifyConnection}
                >
                  验证连接
                </button>
                <div className="text-sm text-slate-500">{verifyStatus}</div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="text-sm font-semibold text-slate-900">七牛云（预留）</div>
          <div className="text-xs text-slate-500">
            目前版本仅保存配置，不会上传任何内容。若后续接入上传功能，建议使用最小权限与专用 bucket。
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <div className="text-sm font-semibold text-slate-900">AccessKey</div>
              <input
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-bilibili-blue"
                value={qiniuAccessKey}
                onChange={(e) => setQiniuAccessKey(e.target.value)}
              />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">SecretKey</div>
              <input
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-bilibili-blue"
                value={qiniuSecretKey}
                onChange={(e) => setQiniuSecretKey(e.target.value)}
              />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">Bucket</div>
              <input
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-bilibili-blue"
                value={qiniuBucket}
                onChange={(e) => setQiniuBucket(e.target.value)}
              />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">Domain（可选）</div>
              <input
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-bilibili-blue"
                value={qiniuDomain}
                onChange={(e) => setQiniuDomain(e.target.value)}
              />
            </div>
          </div>
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
            <span className="text-slate-700">自动跳过注水（按类别过滤）</span>
            <input type="checkbox" checked={autoSkip} onChange={(e) => setAutoSkip(e.target.checked)} />
          </label>

          <div className="pt-2">
            <div className="text-sm font-semibold text-slate-900">注水过滤（默认策略）</div>
            <div className="mt-1 text-xs text-slate-500">自动跳过仅对勾选类别生效；未勾选类别会正常播放。</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={waterEnabledTypes.includes('REPEAT')}
                  onChange={(e) => toggleWaterType('REPEAT', e.target.checked)}
                />
                <span>重复</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={waterEnabledTypes.includes('NO_NEW_INFO')}
                  onChange={(e) => toggleWaterType('NO_NEW_INFO', e.target.checked)}
                />
                <span>无信息增量</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={waterEnabledTypes.includes('AD')} onChange={(e) => toggleWaterType('AD', e.target.checked)} />
                <span>广告</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={waterEnabledTypes.includes('SMALLTALK')}
                  onChange={(e) => toggleWaterType('SMALLTALK', e.target.checked)}
                />
                <span>寒暄</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={waterEnabledTypes.includes('OFFTOPIC')}
                  onChange={(e) => toggleWaterType('OFFTOPIC', e.target.checked)}
                />
                <span>跑题</span>
              </label>
            </div>
          </div>
        </div>

        <details className="rounded-xl border border-slate-200 bg-white p-5">
          <summary className="cursor-pointer select-none text-sm font-semibold text-slate-900">高级（开发者）</summary>
          <div className="mt-3 space-y-3">
            <label className="flex items-center justify-between gap-4 text-sm">
              <span className="text-slate-700">开发者模式（显示调试信息）</span>
              <input type="checkbox" checked={developerMode} onChange={(e) => setDeveloperMode(e.target.checked)} />
            </label>
            <div className="text-xs text-slate-500">
              开启后会在仪表盘/插件弹窗展示一些开发用数据（例如 Model Cascade 指标、关键干货校验证据）。普通使用建议关闭。
            </div>
          </div>
        </details>

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

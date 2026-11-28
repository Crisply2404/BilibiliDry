import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { findPreset, originPattern, PROVIDER_PRESETS } from '../core/llm/presets';
import { WATER_REASON_LABEL, WATER_REASONS } from '../core/types';
import { send } from '../shared/protocol';
import type { Settings } from '../shared/settings';
import { cx } from '../ui/components';
import { useSettings } from '../ui/hooks';

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[13px] font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-slate-400">{hint}</span>}
    </label>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cx('mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors', checked ? 'bg-bili-pink' : 'bg-slate-300')}>
        <span className={cx('block h-4 w-4 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
      </button>
      <span>
        <span className="block text-[13px] font-medium text-slate-700">{label}</span>
        {hint && <span className="block text-[12px] text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}

/** Ask for access to the provider's origin. Must run inside the click handler (user gesture). */
async function requestOrigin(baseUrl: string): Promise<boolean> {
  const origin = originPattern(baseUrl);
  if (!origin) return false;
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

export function Options() {
  const [saved, save] = useSettings();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'busy'; text: string } | null>(null);
  const [stats, setStats] = useState<{ videos: number; vectors: number; traces: number; chats: number } | null>(null);

  useEffect(() => {
    if (saved && !draft) setDraft(saved);
  }, [saved, draft]);
  useEffect(() => {
    send<typeof stats>({ type: 'GET_STATS' }).then(setStats).catch(() => undefined);
  }, []);

  if (!draft) return <div className="p-10 text-slate-400">加载中…</div>;
  const preset = findPreset(draft.provider);
  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const choosePreset = (id: string) => {
    const p = findPreset(id);
    if (!p) return;
    set({ provider: id, baseUrl: p.baseUrl || draft.baseUrl, model: p.model || draft.model, embeddingModel: p.embeddingModel ?? '' });
  };

  const saveAndTest = async () => {
    setStatus({ kind: 'busy', text: '正在保存并测试连接…' });
    try {
      const granted = await requestOrigin(draft.baseUrl);
      if (!granted) throw new Error('没有获得访问该接口地址的权限');
      await save(draft);
      const r = await send<{ model: string; latencyMs: number; embedding?: string }>({ type: 'TEST_CONNECTION' });
      setStatus({ kind: 'ok', text: `连接成功：${r.model}，${r.latencyMs}ms${r.embedding ? `；Embedding：${r.embedding}` : ''}` });
    } catch (err) {
      setStatus({ kind: 'err', text: String((err as Error).message) });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-10">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Bilibili<span className="text-bili-pink">Dry</span> 设置
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">B 站自己的 AI 总结不用配置就能看；配置一个模型后，还能标出注水、一键跳过、向视频和整个知识库提问。</p>
        </div>
        <button className="btn-outline" onClick={() => void send({ type: 'OPEN_DASHBOARD' })}>
          打开知识库
        </button>
      </header>

      <section className="card space-y-4 p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <KeyRound className="h-4 w-4 text-bili-pink" /> 模型服务
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {PROVIDER_PRESETS.map((p) => (
            <button key={p.id} className={cx('rounded-lg border px-2 py-2 text-[12px]', draft.provider === p.id ? 'border-bili-pink bg-bili-pink/5 font-medium text-bili-pink' : 'border-slate-200 hover:border-slate-300')} onClick={() => choosePreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {preset?.note && <p className="text-[12px] text-slate-500">{preset.note}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="接口地址（Base URL）" hint="OpenAI 兼容接口">
            <input className="input" value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
          </Field>
          <Field
            label="API Key"
            hint={
              preset?.keyUrl ? (
                <a className="inline-flex items-center gap-0.5 text-bili-blue hover:underline" href={preset.keyUrl} target="_blank" rel="noreferrer">
                  去 {preset.label} 获取 <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                '本地模型可留空'
              )
            }
          >
            <div className="relative">
              <input className="input pr-9" type={showKey ? 'text' : 'password'} value={draft.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder="sk-..." autoComplete="off" />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Field label="模型" hint="整片分析和问答都用它；需要能一次读完整个视频的字幕（上下文越长越好）">
            <input className="input" list="bdry-models" value={draft.model} onChange={(e) => set({ model: e.target.value })} />
            <datalist id="bdry-models">
              {(preset?.models ?? [preset?.model ?? '']).filter(Boolean).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          {preset?.reasoningStyle && (
            <Field label="思考深度" hint="关闭最快最便宜；开得越深越慢、输出越贵">
              <select className="input" value={draft.reasoning} onChange={(e) => set({ reasoning: e.target.value as Settings['reasoning'] })}>
                <option value="off">关闭（推荐）</option>
                <option value="low">浅</option>
                <option value="high">深</option>
              </select>
            </Field>
          )}
          <Field label="Embedding 模型（可选）" hint="只影响知识库搜索：填了会在关键词检索之外再加语义检索；留空只用关键词">
            <input className="input" value={draft.embeddingModel} onChange={(e) => set({ embeddingModel: e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={saveAndTest} disabled={status?.kind === 'busy'}>
            {status?.kind === 'busy' && <Loader2 className="h-4 w-4 animate-spin" />}保存并测试
          </button>
          {status && (
            <span className={cx('flex items-center gap-1 text-[12px]', status.kind === 'ok' ? 'text-emerald-600' : status.kind === 'err' ? 'text-red-600' : 'text-slate-500')}>
              {status.kind === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : status.kind === 'err' ? <XCircle className="h-4 w-4" /> : null}
              {status.text}
            </span>
          )}
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-[15px] font-semibold">观看体验</h2>
        <Toggle checked={draft.autoAnalyze} onChange={(v) => set({ autoAnalyze: v })} label="打开视频时自动分析" hint="关闭时在视频页右栏的卡片里点“分析这个视频”，更省钱" />
        <Toggle checked={draft.autoSkip} onChange={(v) => set({ autoSkip: v })} label="自动跳过注水" hint="播放到下面勾选的类型时自动跳过，屏幕底部会出现“撤销”" />
        <div className="flex flex-wrap gap-2 pl-12">
          {WATER_REASONS.map((r) => {
            const on = draft.skipReasons.includes(r);
            return (
              <button key={r} className={cx('chip !px-3 !py-1 !text-[12px]', on ? 'bg-bili-pink text-white' : 'bg-slate-100 text-slate-500')} onClick={() => set({ skipReasons: on ? draft.skipReasons.filter((x) => x !== r) : [...draft.skipReasons, r] })}>
                {WATER_REASON_LABEL[r]}
              </button>
            );
          })}
        </div>
        <Toggle checked={draft.showOnProgress} onChange={(v) => set({ showOnProgress: v })} label="在 B 站进度条上标出干货和注水" hint="没分析过的视频会标出 B 站 AI 总结的章节位置" />
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-[15px] font-semibold">高级</h2>
        <Toggle checked={draft.developerMode} onChange={(v) => set({ developerMode: v })} label="开发者模式" hint="在卡片和工作台显示每次分析、问答的调用记录：耗时、token、缓存命中、费用、错误" />
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <ShieldCheck className="h-4 w-4 text-emerald-500" /> 隐私与数据
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-600">
          <li>没有服务器。字幕和问题只会发给你在上面填写的模型服务。</li>
          <li>API Key、分析结果、对话记录都只保存在本机浏览器（chrome.storage 与 IndexedDB）。</li>
          <li>读取字幕和 B 站 AI 总结时会带上你的 B 站登录状态，只用于请求 B 站自己的接口，每个视频只请求一次并缓存。</li>
        </ul>
        <div className="flex items-center gap-3 text-[12px] text-slate-500">
          {stats && (
            <span>
              已保存 {stats.videos} 个视频、{stats.vectors} 条向量、{stats.chats} 段对话、{stats.traces} 条调用记录
            </span>
          )}
          <button
            className="btn-ghost !text-red-600"
            onClick={async () => {
              if (!confirm('删除所有本地分析结果、对话和记录？此操作不可撤销（设置和 Key 会保留）。')) return;
              await send({ type: 'CLEAR_ALL' });
              setStats(await send({ type: 'GET_STATS' }));
            }}
          >
            清空本地数据
          </button>
        </div>
      </section>

      {dirty && (
        <div className="sticky bottom-4 flex justify-end">
          <div className="flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-2 text-[13px] text-white shadow-lg">
            有未保存的修改
            <button className="btn-ghost !text-white/70 hover:!bg-white/10" onClick={() => setDraft(saved)}>
              撤销
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                const providerKeys: Array<keyof Settings> = ['baseUrl', 'apiKey', 'model', 'embeddingModel'];
                if (saved && providerKeys.some((k) => draft[k] !== saved[k])) void saveAndTest();
                else void save(draft);
              }}
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

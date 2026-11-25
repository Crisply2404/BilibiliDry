import { BookOpen, Loader2, Play, Settings2, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatTime } from '../core/transcript/captions';
import { send, type VideoBundle } from '../shared/protocol';
import { isConfigured } from '../shared/settings';
import { useSettings } from '../ui/hooks';
import { readLocation } from '../content/page';

export function Popup() {
  const [settings] = useSettings();
  const [tabLoc, setTabLoc] = useState<{ bvid: string; page: number } | null | undefined>(undefined);
  const [bundle, setBundle] = useState<VideoBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      const loc = tab?.url ? readLocation(tab.url) : null;
      setTabLoc(loc);
      if (loc) {
        try {
          setBundle(await send<VideoBundle>({ type: 'RESOLVE_VIDEO', bvid: loc.bvid, page: loc.page }));
        } catch (err) {
          setError(String((err as Error).message));
        }
      }
    });
  }, []);

  const configured = settings ? isConfigured(settings) : true;
  const v = bundle?.video;
  const waterSec = bundle?.segments.filter((s) => s.kind === 'water').reduce((a, s) => a + s.end - s.start, 0) ?? 0;

  return (
    <div className="w-[320px] space-y-3 bg-white p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-bili-pink" />
        <span className="text-[15px] font-bold">
          Bilibili<span className="text-bili-pink">Dry</span>
        </span>
      </div>
      {!configured && (
        <div className="rounded-lg bg-amber-50 p-3 text-[12px] text-amber-700">
          还没有配置模型。
          <button className="ml-1 font-medium underline" onClick={() => void send({ type: 'OPEN_OPTIONS' })}>
            去设置
          </button>
        </div>
      )}
      {tabLoc === undefined ? (
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      ) : !tabLoc ? (
        <p className="text-[12px] leading-relaxed text-slate-500">打开一个 B 站视频（bilibili.com/video/BV…），页面右侧会出现 BilibiliDry 面板。</p>
      ) : error ? (
        <p className="text-[12px] text-red-600">{error}</p>
      ) : v ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <div className="line-clamp-2 text-[13px] font-medium">{v.title}</div>
          <div className="text-[11px] text-slate-500">
            {formatTime(v.durationSec)}
            {bundle!.segments.length > 0 ? ` · 可跳过 ${formatTime(waterSec)} · ${bundle!.segments.length} 个片段` : ' · 尚未分析'}
            {bundle!.job && !['done'].includes(bundle!.job.status) ? ` · ${bundle!.job.message}` : ''}
          </div>
          {bundle!.digest?.tldr && <p className="text-[12px] text-slate-600">{bundle!.digest.tldr}</p>}
          {bundle!.segments.length === 0 && configured && (
            <button className="btn-primary w-full" onClick={() => void send({ type: 'ANALYZE', bvid: v.bvid, page: v.page }).then(() => window.close())}>
              <Play className="h-4 w-4" /> 分析这个视频
            </button>
          )}
        </div>
      ) : (
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      )}
      <div className="flex gap-2">
        <button className="btn-outline flex-1" onClick={() => void send({ type: 'OPEN_DASHBOARD', videoId: v?.videoId })}>
          <BookOpen className="h-4 w-4" /> 知识库
        </button>
        <button className="btn-outline flex-1" onClick={() => void send({ type: 'OPEN_OPTIONS' })}>
          <Settings2 className="h-4 w-4" /> 设置
        </button>
      </div>
    </div>
  );
}

import { Activity, BookOpen, Download, ListTree, Loader2, MessageCircle, Play, RotateCcw, Search, Settings2, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { formatTime } from '../core/transcript/captions';
import type { CaptionLine } from '../core/types';
import { readLocation } from '../content/page';
import { send, type SearchResultItem, type VideoBundle } from '../shared/protocol';
import { isConfigured } from '../shared/settings';
import { ChatThread, cx, DigestView, Empty, Heatmap, JobBar, OfficialSummaryView, SearchResults, SegmentList, TraceList, type LineTime } from '../ui/components';
import { useChat, useSettings, useVideo } from '../ui/hooks';

type Tab = 'summary' | 'chat' | 'segments' | 'library' | 'trace';

/** The browser tab the side panel is looking at, followed across tab switches and SPA navigation. */
function useActiveTab(): { tabId: number | null; url: string } {
  const [tab, setTab] = useState<{ tabId: number | null; url: string }>({ tabId: null, url: '' });
  useEffect(() => {
    // `?tab=<id>` pins the panel to one tab (tests, or opening the panel page in its own tab).
    const pinned = Number(new URLSearchParams(location.search).get('tab'));
    const refresh = () =>
      void (Number.isFinite(pinned) && pinned > 0 ? chrome.tabs.get(pinned).then((t) => [t]) : chrome.tabs.query({ active: true, currentWindow: true })).then(([t]) =>
        setTab((cur) => (cur.tabId === (t?.id ?? null) && cur.url === (t?.url ?? '') ? cur : { tabId: t?.id ?? null, url: t?.url ?? '' }))
      );
    refresh();
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo) => {
      if (info.url || info.status === 'complete') refresh();
    };
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    const id = setInterval(refresh, 2000); // Bilibili changes video via history.pushState
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearInterval(id);
    };
  }, []);
  return tab;
}

function usePlayhead(tabId: number | null, enabled: boolean): number | undefined {
  const [time, setTime] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (tabId === null || !enabled) return;
    const poll = () =>
      void chrome.tabs
        .sendMessage(tabId, { type: 'GET_TIME' })
        .then((r: { time?: number } | undefined) => setTime(r?.time))
        .catch(() => setTime(undefined));
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, [tabId, enabled]);
  return time;
}

/** `className` sets the outer height: the full window in Chrome's side panel, a column in the online demo. */
export function SidePanel({ className = 'h-screen' }: { className?: string } = {}) {
  const { tabId, url } = useActiveTab();
  const loc = useMemo(() => (url ? readLocation(url) : null), [url]);
  const [settings] = useSettings();
  const [videoId, setVideoId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const { bundle, setBundle, traces } = useVideo(videoId);
  const [tab, setTab] = useState<Tab>('summary');
  const [busy, setBusy] = useState(false);
  const configured = settings ? isConfigured(settings) : false;
  const time = usePlayhead(tabId, Boolean(loc));

  useEffect(() => {
    setVideoId(null);
    setResolveError(null);
    if (!loc) {
      setTab((t) => (t === 'trace' ? t : 'library'));
      return;
    }
    setTab((t) => (t === 'library' ? 'summary' : t));
    send<VideoBundle>({ type: 'RESOLVE_VIDEO', bvid: loc.bvid, page: loc.page })
      .then((b) => {
        setVideoId(b.video?.videoId ?? null);
        setBundle(b);
      })
      .catch((err) => setResolveError(String(err.message ?? err)));
  }, [loc?.bvid, loc?.page]); // eslint-disable-line react-hooks/exhaustive-deps

  const video = bundle?.video ?? null;
  const segments = bundle?.segments ?? [];
  const digest = bundle?.digest ?? null;
  const job = bundle?.job ?? null;
  const running = job ? ['queued', 'fetching', 'running'].includes(job.status) : false;
  const duration = video?.durationSec ?? 0;

  const seek = useCallback(
    (t: number, bvid?: string) => {
      if (!loc) return;
      if (bvid && bvid !== loc.bvid) void send({ type: 'SEEK', bvid, page: 1, time: t });
      else if (tabId !== null) void chrome.tabs.sendMessage(tabId, { type: 'SEEK_TO', time: t }).catch(() => undefined);
    },
    [loc, tabId]
  );

  const analyze = async (fresh = false) => {
    if (!loc) return;
    setBusy(true);
    try {
      const j = await send<NonNullable<VideoBundle['job']>>({ type: 'ANALYZE', bvid: loc.bvid, page: loc.page, fresh });
      setBundle((b) => (b ? { ...b, job: j } : b));
    } catch (err) {
      setResolveError(String((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const exportMd = async () => {
    if (!videoId) return;
    const md = await send<string>({ type: 'EXPORT_MARKDOWN', videoId });
    await navigator.clipboard.writeText(md).catch(() => undefined);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    a.download = `${(video?.title ?? 'notes').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.md`;
    a.click();
  };

  const tabs: Array<[Tab, string, typeof Sparkles]> = loc
    ? [
        ['summary', '总结', Sparkles],
        ['chat', '问答', MessageCircle],
        ['segments', '片段', ListTree],
        ['library', '知识库', BookOpen],
        ...(settings?.developerMode ? ([['trace', '记录', Activity]] as Array<[Tab, string, typeof Sparkles]>) : [])
      ]
    : [['library', '知识库', BookOpen]];

  return (
    <div className={cx('flex flex-col bg-white text-slate-800', className)}>
      <header className="flex items-start gap-2 border-b border-slate-100 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">
            Bilibili<span className="text-bili-pink">Dry</span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-slate-500">{video ? video.title : loc ? '读取视频信息…' : '打开一个 B 站视频，这里会显示它的总结、可跳过的片段和问答'}</div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {videoId && segments.length > 0 && (
            <button className="btn-ghost !p-1.5" title="导出 Markdown 笔记" onClick={() => void exportMd()}>
              <Download className="h-4 w-4" />
            </button>
          )}
          <button className="btn-ghost !p-1.5" title="知识库工作台" onClick={() => void send({ type: 'OPEN_DASHBOARD', videoId: videoId ?? undefined })}>
            <BookOpen className="h-4 w-4" />
          </button>
          <button className="btn-ghost !p-1.5" title="设置" onClick={() => void send({ type: 'OPEN_OPTIONS' })}>
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      {loc && (
        <div className="space-y-2 border-b border-slate-100 px-3 py-2.5">
          {resolveError && <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">{resolveError}</div>}
          {duration > 0 && segments.length > 0 && <Heatmap segments={segments} duration={duration} current={time} onSeek={seek} highlightIds={digest?.highlightIds} />}
          {!configured ? (
            <div className="rounded-lg border border-bili-blue/20 bg-bili-blue/5 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
              B 站自己的 AI 总结不用配置就能看。配置一个模型（推荐 DeepSeek，一个视频约一两分钱）后，还能标出哪里是注水、一键跳过，并向视频提问。
              <button className="btn-primary mt-2 !py-1 text-[12px]" onClick={() => void send({ type: 'OPEN_OPTIONS' })}>
                去设置
              </button>
            </div>
          ) : segments.length === 0 && !running ? (
            <button className="btn-primary w-full justify-center" disabled={busy || !videoId} onClick={() => void analyze()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} 分析这个视频
            </button>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              {segments.length > 0 && <StatChips segments={segments} duration={duration} />}
              <span className="flex-1" />
              {!running && segments.length > 0 && (
                <button className="btn-ghost !px-1.5 !py-0.5" title="重新分析" onClick={() => void analyze(true)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          <JobBar job={job} onResume={() => void analyze()} onCancel={() => videoId && void send({ type: 'CANCEL', videoId })} onRetryFresh={() => void analyze(true)} />
        </div>
      )}

      <nav className="flex gap-1 border-b border-slate-100 px-2">
        {tabs.map(([key, label, Icon]) => (
          <button key={key} className={cx('flex items-center gap-1 border-b-2 px-2 py-1.5 text-[12px]', tab === key ? 'border-bili-pink font-medium text-bili-pink' : 'border-transparent text-slate-500 hover:text-slate-700')} onClick={() => setTab(key)}>
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {tab === 'summary' && (
          <div className="space-y-4 px-3 py-3">
            {digest && segments.length > 0 && <DigestView digest={digest} segments={segments} onSeek={seek} stats={false} />}
            {video?.official && <OfficialSummaryView official={video.official} onSeek={seek} />}
            {!digest && !video?.official && (
              <Empty icon={<Sparkles className="h-6 w-6 text-bili-pink/40" />} title={running ? '正在分析…' : 'B 站没有为这个视频生成总结'}>
                {running ? '模型正在通读全片，分析好的片段会先出现在进度条上。' : configured ? '点上面的“分析这个视频”生成总结、重点和可跳过片段。' : '配置模型后可以自己分析。'}
              </Empty>
            )}
          </div>
        )}
        {tab === 'chat' && videoId && <VideoChat videoId={videoId} bvid={loc?.bvid} configured={configured} time={time} onSeek={seek} />}
        {tab === 'segments' && <div className="px-3 py-3">{segments.length ? <SegmentList segments={segments} onSeek={seek} current={time} highlightIds={digest?.highlightIds} /> : <Empty title="还没有片段" />}</div>}
        {tab === 'library' && <Library configured={configured} onSeek={seek} />}
        {tab === 'trace' && <div className="px-3 py-3"><TraceList traces={traces} /></div>}
      </main>
    </div>
  );
}

function StatChips({ segments, duration }: { segments: { kind: string; start: number; end: number }[]; duration: number }) {
  const water = segments.filter((s) => s.kind === 'water').reduce((a, s) => a + s.end - s.start, 0);
  return (
    <>
      <span className="chip bg-bili-pink/10 text-bili-pink">干货 {Math.round(((duration - water) / Math.max(1, duration)) * 100)}%</span>
      <span className="chip bg-slate-100 text-slate-500">可跳过 {formatTime(water)}</span>
    </>
  );
}

function ChatInput({ onAsk, live, onStop, onClear, canClear, placeholder }: { onAsk: (q: string) => void; live: boolean; onStop: () => void; onClear: () => void; canClear: boolean; placeholder: string }) {
  const [q, setQ] = useState('');
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    onAsk(q);
    setQ('');
  };
  return (
    <form className="flex items-end gap-1.5 border-t border-slate-100 p-2" onSubmit={submit}>
      {canClear && (
        <button type="button" className="btn-ghost !p-2" title="清空对话" onClick={onClear}>
          <Trash2 className="h-4 w-4" />
        </button>
      )}
      <textarea
        className="input max-h-28 min-h-[38px] resize-none"
        rows={1}
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {live ? (
        <button type="button" className="btn-outline shrink-0" onClick={onStop}>
          停止
        </button>
      ) : (
        <button className="btn-primary shrink-0" disabled={!q.trim()}>
          发送
        </button>
      )}
    </form>
  );
}

function VideoChat({ videoId, bvid, configured, time, onSeek }: { videoId: string; bvid?: string; configured: boolean; time?: number; onSeek: (t: number, bvid?: string) => void }) {
  const chat = useChat(videoId);
  const [lines, setLines] = useState<CaptionLine[]>([]);
  useEffect(() => {
    void send<CaptionLine[]>({ type: 'GET_CAPTIONS', videoId }).then(setLines).catch(() => undefined);
  }, [videoId, chat.turns.length]);
  const lineTime: LineTime = (line, b) => (b && b !== bvid ? undefined : lines[line]?.from);
  if (!configured) return <Empty title="配置模型后就能向视频提问">回答会带上可点击的出处，指向说这句话的那一行字幕。</Empty>;
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 scroll-thin">
        {chat.turns.length === 0 && !chat.live && (
          <div className="space-y-1.5">
            <div className="text-[12px] text-slate-500">试试这样问：</div>
            {['这个视频讲了哪几件事？', '现在这里在说什么？', '有没有提到具体的数据或例子？'].map((q) => (
              <button key={q} className="block w-full rounded-lg bg-slate-50 px-3 py-1.5 text-left text-[12px] text-slate-600 hover:bg-slate-100" onClick={() => chat.ask(q, time)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <ChatThread turns={chat.turns} live={chat.live} error={chat.error} lineTime={lineTime} onSeek={onSeek} />
      </div>
      <ChatInput onAsk={(q) => chat.ask(q, time)} live={Boolean(chat.live)} onStop={chat.stop} onClear={() => void chat.clear()} canClear={chat.turns.length > 0} placeholder="问这个视频…（Enter 发送）" />
    </div>
  );
}

function Library({ configured, onSeek }: { configured: boolean; onSeek: (t: number, bvid?: string) => void }) {
  const [mode, setMode] = useState<'search' | 'ask'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const chat = useChat(mode === 'ask' ? 'library' : null);
  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      setResults(await send<SearchResultItem[]>({ type: 'SEARCH', query, k: 10 }));
    } finally {
      setSearching(false);
    }
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-3 px-3 pt-3 text-[12px]">
        {(['search', 'ask'] as const).map((m) => (
          <button key={m} className={cx('rounded-full px-2.5 py-0.5', mode === m ? 'bg-bili-pink/10 font-medium text-bili-pink' : 'text-slate-500 hover:text-slate-700')} onClick={() => setMode(m)}>
            {m === 'search' ? '搜索片段' : '问知识库'}
          </button>
        ))}
      </div>
      {mode === 'search' ? (
        <div className="space-y-2 px-3 py-3">
          <form onSubmit={search} className="flex gap-1.5">
            <input className="input" placeholder="在所有分析过的视频里找…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="btn-primary shrink-0" disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </button>
          </form>
          {results && <SearchResults items={results} showVideo onSeek={(it) => onSeek(it.start, it.bvid)} />}
        </div>
      ) : !configured ? (
        <Empty title="配置模型后可以向整个知识库提问">比如“哪个视频讲过 RRF？”“这两个视频的说法有什么不同？”</Empty>
      ) : (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 scroll-thin">
            {chat.turns.length === 0 && !chat.live && <div className="text-[12px] leading-relaxed text-slate-500">问你看过的所有视频，比如“哪个视频讲过 RRF？”“这两个视频的说法有什么不同？”。Agent 会先检索、再读原文，回答里的出处可以直接跳到对应视频。</div>}
            <ChatThread turns={chat.turns} live={chat.live} error={chat.error} onSeek={onSeek} />
          </div>
          <ChatInput onAsk={(q) => chat.ask(q)} live={Boolean(chat.live)} onStop={chat.stop} onClear={() => void chat.clear()} canClear={chat.turns.length > 0} placeholder="问知识库…（Enter 发送）" />
        </>
      )}
    </div>
  );
}

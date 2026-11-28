import { Activity, BookOpen, ChevronDown, Download, ListTree, Loader2, MessageCircle, Play, RotateCcw, Search, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Trace } from '../core/trace/tracer';
import { segmentStats } from '../core/playback';
import { formatTime } from '../core/transcript/captions';
import type { CaptionLine } from '../core/types';
import { send, type SearchResultItem, type VideoBundle } from '../shared/protocol';
import { isConfigured, type Settings } from '../shared/settings';
import { ChatThread, cx, DigestView, Empty, JobBar, OfficialSummaryView, SearchResults, SegmentList, TraceList, type LineTime } from '../ui/components';
import { useChat } from '../ui/hooks';

type Tab = 'summary' | 'chat' | 'segments' | 'library' | 'trace';
export type SeekTo = (t: number, bvid?: string) => void;

export interface PanelProps {
  bvid: string;
  videoId: string | null;
  bundle: VideoBundle | null;
  setBundle: (fn: (b: VideoBundle | null) => VideoBundle | null) => void;
  traces: Trace[];
  settings: Settings | null;
  resolveError: string | null;
  /** Playhead, for "现在这里在说什么？" and the current-segment marker. */
  time: number;
  onSeek: SeekTo;
  /**
   * "card": a card in Bilibili's right column, the height of the player, collapsible to its header.
   * "drawer": slides over the right side of the player when the right column is gone (wide, web
   * fullscreen and fullscreen modes).
   */
  variant: 'card' | 'drawer';
  height?: number;
  collapsed?: boolean;
  onToggle: () => void;
}

/**
 * Everything about the current video beside the player: Bilibili's own summary, our analysis,
 * chat, segments and the library. It lives in the page (see `content/App.tsx`), so it looks and
 * scrolls like part of Bilibili instead of a separate browser panel.
 */
export function Panel(props: PanelProps) {
  const { bvid, videoId, bundle, setBundle, traces, settings, time, onSeek, variant, collapsed = false, onToggle } = props;
  const [tab, setTab] = useState<Tab>('summary');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = settings ? isConfigured(settings) : false;

  const video = bundle?.video ?? null;
  const segments = bundle?.segments ?? [];
  const digest = bundle?.digest ?? null;
  const job = bundle?.job ?? null;
  const running = job ? ['queued', 'fetching', 'running'].includes(job.status) : false;
  const stats = segmentStats(segments);
  const shownError = props.resolveError ?? error;

  useEffect(() => setError(null), [bvid]);

  const analyze = async (fresh = false) => {
    if (!video) return;
    setBusy(true);
    try {
      const j = await send<NonNullable<VideoBundle['job']>>({ type: 'ANALYZE', bvid: video.bvid, page: video.page, fresh });
      setBundle((b) => (b ? { ...b, job: j } : b));
    } catch (err) {
      setError(String((err as Error).message));
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

  const tabs: Array<[Tab, string, typeof Sparkles]> = [
    ['summary', '总结', Sparkles],
    ['chat', '问答', MessageCircle],
    ['segments', '片段', ListTree],
    ['library', '知识库', BookOpen],
    ...(settings?.developerMode ? ([['trace', '记录', Activity]] as Array<[Tab, string, typeof Sparkles]>) : [])
  ];

  const status: ReactNode = running ? (
    <span className="flex items-center gap-1 text-slate-500">
      <Loader2 className="h-3 w-3 animate-spin text-bili-pink" />
      分析中 {job?.linesTotal ? Math.round((job.linesDone / job.linesTotal) * 100) : 0}%
    </span>
  ) : stats.dryShare !== null ? (
    <>
      <span className="font-medium text-bili-pink">干货 {Math.round(stats.dryShare * 100)}%</span>
      <span className="text-slate-400">可跳过 {formatTime(stats.waterSec)}</span>
    </>
  ) : video?.official ? (
    <span className="text-slate-500">B 站 AI 总结</span>
  ) : null;

  const iconBtn = (title: string, icon: ReactNode, onClick: () => void) => (
    <button
      className="rounded-md p-1.5 text-slate-500 hover:bg-black/5 hover:text-slate-700"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {icon}
    </button>
  );

  const header = (
    <header
      className={cx('flex h-11 shrink-0 cursor-pointer select-none items-center gap-2 bg-[#F1F2F3] pl-3 pr-1.5 text-[12px]', variant === 'card' && 'rounded-md', variant === 'card' && !collapsed && 'rounded-b-none')}
      onClick={onToggle}
      title={variant === 'card' ? (collapsed ? '展开' : '收起') : undefined}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-bili-pink" />
      <span className="shrink-0 text-[14px] font-medium text-bili-ink">
        Bilibili<span className="text-bili-pink">Dry</span>
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{status}</span>
      {!collapsed && videoId && segments.length > 0 && iconBtn('导出 Markdown 笔记', <Download className="h-4 w-4" />, () => void exportMd())}
      {!collapsed && iconBtn('知识库工作台', <BookOpen className="h-4 w-4" />, () => void send({ type: 'OPEN_DASHBOARD', videoId: videoId ?? undefined }))}
      {!collapsed && iconBtn('设置', <Settings2 className="h-4 w-4" />, () => void send({ type: 'OPEN_OPTIONS' }))}
      {variant === 'card' ? (
        <ChevronDown className={cx('mx-1 h-4 w-4 shrink-0 text-slate-400 transition-transform', !collapsed && 'rotate-180')} />
      ) : (
        iconBtn('关闭', <X className="h-4 w-4" />, onToggle)
      )}
    </header>
  );

  if (collapsed) return <div className="overflow-hidden rounded-md text-slate-800">{header}</div>;

  return (
    <div
      className={cx('flex flex-col overflow-hidden bg-white text-slate-800', variant === 'card' ? 'rounded-md border border-[#E3E5E7]' : 'h-full shadow-2xl')}
      style={variant === 'card' ? { height: props.height ? Math.max(360, props.height) : 560 } : undefined}
    >
      {header}

      <div className="space-y-2 px-3 pt-2.5 empty:hidden">
        {shownError && <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">{shownError}</div>}
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
        ) : null}
        <JobBar job={job} onResume={() => void analyze()} onCancel={() => videoId && void send({ type: 'CANCEL', videoId })} onRetryFresh={() => void analyze(true)} />
      </div>

      <nav className="flex shrink-0 items-center gap-1 border-b border-slate-100 px-2">
        {tabs.map(([key, label, Icon]) => (
          <button key={key} className={cx('flex items-center gap-1 border-b-2 px-2 py-2 text-[12px]', tab === key ? 'border-bili-pink font-medium text-bili-pink' : 'border-transparent text-slate-500 hover:text-slate-700')} onClick={() => setTab(key)}>
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
        <span className="flex-1" />
        {!running && segments.length > 0 && (
          <button className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="重新分析" onClick={() => void analyze(true)}>
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {tab === 'summary' && (
          <div className="space-y-4 px-3 py-3">
            {digest && segments.length > 0 && <DigestView digest={digest} segments={segments} onSeek={onSeek} stats={false} />}
            {video?.official && <OfficialSummaryView official={video.official} onSeek={onSeek} />}
            {!digest && !video?.official && (
              <Empty icon={<Sparkles className="h-6 w-6 text-bili-pink/40" />} title={running ? '正在分析…' : video ? 'B 站没有为这个视频生成总结' : '读取视频信息…'}>
                {running ? '模型正在通读全片，分析好的片段会先出现在进度条上。' : !video ? null : configured ? '点上面的“分析这个视频”生成总结、重点和可跳过片段。' : '配置模型后可以自己分析。'}
              </Empty>
            )}
          </div>
        )}
        {tab === 'chat' && videoId && <VideoChat videoId={videoId} bvid={bvid} configured={configured} time={time} onSeek={onSeek} />}
        {tab === 'segments' && <div className="px-3 py-3">{segments.length ? <SegmentList segments={segments} onSeek={onSeek} current={time} highlightIds={digest?.highlightIds} /> : <Empty title="还没有片段" />}</div>}
        {tab === 'library' && <Library configured={configured} onSeek={onSeek} />}
        {tab === 'trace' && <div className="px-3 py-3"><TraceList traces={traces} /></div>}
      </main>
    </div>
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

function VideoChat({ videoId, bvid, configured, time, onSeek }: { videoId: string; bvid?: string; configured: boolean; time?: number; onSeek: SeekTo }) {
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

function Library({ configured, onSeek }: { configured: boolean; onSeek: SeekTo }) {
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

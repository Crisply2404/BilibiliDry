import { BookOpen, ChevronsRight, Download, ExternalLink, FastForward, GripHorizontal, ListTree, Loader2, MessageCircle, Minus, Play, RotateCcw, Search, Settings2, Sparkles, Trash2, Activity } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { isSkippable, nextDryStart, segmentAt, skipTarget } from '../core/playback';
import { formatTime } from '../core/transcript/captions';
import { WATER_REASON_LABEL, type Segment } from '../core/types';
import { send, type JobState, type SearchResultItem, type TabCommand, type VideoBundle } from '../shared/protocol';
import { isConfigured } from '../shared/settings';
import { ChatThread, cx, DigestView, Empty, Heatmap, JobBar, SearchResults, SegmentList, TraceList } from '../ui/components';
import { useChat, useSettings, useVideo } from '../ui/hooks';
import { findVideo, readLocation } from './page';

type Tab = 'overview' | 'chat' | 'search' | 'segments' | 'trace';

function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage blocked: keep in memory only
      }
    },
    [key]
  );
  return [v, set];
}

function usePlayer() {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [time, setTime] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      const v = findVideo();
      setVideo((cur) => (cur === v ? cur : v));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!video) return;
    const on = () => setTime(video.currentTime);
    video.addEventListener('timeupdate', on);
    video.addEventListener('seeked', on);
    on();
    return () => {
      video.removeEventListener('timeupdate', on);
      video.removeEventListener('seeked', on);
    };
  }, [video]);
  return { video, time };
}

function useCurrentVideoId() {
  const [loc, setLoc] = useState(() => readLocation());
  useEffect(() => {
    const id = setInterval(() => {
      const next = readLocation();
      setLoc((cur) => (cur?.bvid === next?.bvid && cur?.page === next?.page ? cur : next));
    }, 800);
    return () => clearInterval(id);
  }, []);
  return loc;
}

/** Thin importance strip laid over the bottom edge of the player. */
function PlayerStrip({ video, segments, duration, onSeek }: { video: HTMLVideoElement; segments: Segment[]; duration: number; onSeek: (t: number) => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const r = video.getBoundingClientRect();
      setRect((cur) => (cur && cur.x === r.x && cur.y === r.y && cur.width === r.width && cur.height === r.height ? cur : r));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video]);
  if (!rect || rect.width < 200 || rect.bottom < 0 || rect.top > innerHeight) return null;
  return (
    <div className="pointer-events-auto fixed z-[2147483000] opacity-80 transition-opacity hover:opacity-100" style={{ left: rect.left, top: rect.bottom - 4, width: rect.width }} title="BilibiliDry：粉色越深越重要，灰色可跳过">
      <Heatmap segments={segments} duration={duration} onSeek={onSeek} height={4} />
    </div>
  );
}

export function Overlay() {
  const loc = useCurrentVideoId();
  const { video: player, time } = usePlayer();
  const [settings] = useSettings();
  const [videoId, setVideoId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const { bundle, setBundle, traces } = useVideo(videoId);
  const chat = useChat(videoId);
  const [collapsed, setCollapsed] = useLocalState('bdry.collapsed', false);
  const [pos, setPos] = useLocalState<{ right: number; top: number }>('bdry.pos', { right: 16, top: 88 });
  const [tab, setTab] = useState<Tab>('overview');
  const [toast, setToast] = useState<{ text: string; undoTo?: number } | null>(null);
  const allowedRef = useRef(new Set<string>());
  const [question, setQuestion] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'video' | 'library'>('video');
  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  // Resolve bvid+page → videoId (the part's cid) whenever the URL changes.
  useEffect(() => {
    setVideoId(null);
    setResolveError(null);
    setResults(null);
    allowedRef.current.clear();
    if (!loc) return;
    send<VideoBundle>({ type: 'RESOLVE_VIDEO', bvid: loc.bvid, page: loc.page })
      .then((b) => {
        setVideoId(b.video?.videoId ?? null);
        setBundle(b);
      })
      .catch((err) => setResolveError(String(err.message ?? err)));
  }, [loc?.bvid, loc?.page]); // eslint-disable-line react-hooks/exhaustive-deps

  const segments = bundle?.segments ?? [];
  const digest = bundle?.digest ?? null;
  const job = bundle?.job ?? null;
  const duration = bundle?.video?.durationSec || player?.duration || 0;
  const running = job ? ['queued', 'fetching', 'running'].includes(job.status) : false;
  const configured = settings ? isConfigured(settings) : true;
  const reasons = useMemo(() => new Set(settings?.skipReasons ?? []), [settings?.skipReasons]);

  const seek = useCallback(
    (t: number, bvid?: string) => {
      if (bvid && loc && bvid !== loc.bvid) {
        void send({ type: 'SEEK', bvid, page: 1, time: t });
        return;
      }
      const v = findVideo();
      if (v) {
        v.currentTime = Math.max(0, t);
        if (v.paused) void v.play().catch(() => undefined);
      }
    },
    [loc]
  );

  // Commands from the dashboard ("jump to this moment").
  useEffect(() => {
    const on = (m: TabCommand) => {
      if (m?.type === 'SEEK_TO') seek(m.time);
    };
    chrome.runtime.onMessage.addListener(on);
    return () => chrome.runtime.onMessage.removeListener(on);
  }, [seek]);

  // Auto-skip filler. A segment the user returned to via "撤销" is never auto-skipped again.
  useEffect(() => {
    if (!settings?.autoSkip || !player || player.paused || segments.length === 0) return;
    const seg = segmentAt(segments, time);
    if (!seg || allowedRef.current.has(seg.id)) return;
    const target = skipTarget(segments, time, reasons);
    if (target === null) return;
    const from = time;
    player.currentTime = target;
    allowedRef.current.add(seg.id);
    setToast({ text: `已跳过 ${formatTime(target - from)} ${seg.waterReason ? WATER_REASON_LABEL[seg.waterReason] : '注水'}`, undoTo: from });
  }, [time, settings?.autoSkip, segments, reasons, player]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const analyze = useCallback(
    async (fresh = false) => {
      if (!loc) return;
      setBusy(true);
      try {
        const job = await send<JobState>({ type: 'ANALYZE', bvid: loc.bvid, page: loc.page, priorityTime: findVideo()?.currentTime, fresh });
        setBundle((b) => (b ? { ...b, job } : b));
      } catch (err) {
        setToast({ text: String((err as Error).message) });
      } finally {
        setBusy(false);
      }
    },
    [loc, setBundle]
  );

  // Auto-analyse once per video when enabled.
  const autoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settings?.autoAnalyze || !configured || !videoId || !bundle || autoRef.current === videoId) return;
    autoRef.current = videoId;
    if (bundle.segments.length === 0 && !bundle.job) void analyze();
  }, [settings?.autoAnalyze, configured, videoId, bundle, analyze]);

  const currentSeg = segmentAt(segments, time);
  const canSkipNow = currentSeg && currentSeg.kind === 'water' ? skipTarget(segments, time, new Set(['smalltalk', 'repeat', 'offtopic', 'ad', 'no_new_info'])) : null;

  const exportMd = async () => {
    if (!videoId) return;
    const md = await send<string>({ type: 'EXPORT_MARKDOWN', videoId });
    await navigator.clipboard.writeText(md).catch(() => undefined);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(bundle?.video?.title ?? 'notes').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setToast({ text: '笔记已复制到剪贴板并下载' });
  };

  const doSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      setResults(await send<SearchResultItem[]>({ type: 'SEARCH', query, videoId: scope === 'video' ? videoId ?? undefined : undefined, k: 8 }));
    } catch (err) {
      setToast({ text: String((err as Error).message) });
    } finally {
      setSearching(false);
    }
  };

  const onDrag = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const start = pos;
    const move = (ev: PointerEvent) => setPos({ right: Math.max(0, Math.min(innerWidth - 120, start.right - (ev.clientX - startX))), top: Math.max(0, Math.min(innerHeight - 60, start.top + (ev.clientY - startY))) });
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  if (!loc) return null;

  const tabs: Array<[Tab, string, typeof Sparkles]> = [
    ['overview', '概览', Sparkles],
    ['chat', '问答', MessageCircle],
    ['search', '搜索', Search],
    ['segments', '片段', ListTree],
    ...(settings?.developerMode ? ([['trace', '记录', Activity]] as Array<[Tab, string, typeof Sparkles]>) : [])
  ];

  return (
    <>
      {player && settings?.showStrip && segments.length > 0 && <PlayerStrip video={player} segments={segments} duration={duration} onSeek={seek} />}

      {toast && (
        <div className="pointer-events-auto fixed bottom-6 left-1/2 z-[2147483647] flex -translate-x-1/2 items-center gap-3 rounded-full bg-slate-900/90 px-4 py-2 text-[13px] text-white shadow-lg">
          <FastForward className="h-4 w-4 text-bili-pink" />
          {toast.text}
          {toast.undoTo !== undefined && (
            <button
              className="font-medium text-bili-blue hover:underline"
              onClick={() => {
                seek(toast.undoTo!);
                setToast(null);
              }}
            >
              撤销
            </button>
          )}
        </div>
      )}

      {collapsed ? (
        <button
          className="pointer-events-auto fixed z-[2147483600] flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-[13px] font-medium text-slate-700 shadow-lg ring-1 ring-slate-200 hover:ring-bili-pink"
          style={{ right: pos.right, top: pos.top }}
          onClick={() => setCollapsed(false)}
          title="展开 BilibiliDry"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin text-bili-pink" /> : <Sparkles className="h-4 w-4 text-bili-pink" />}
          Dry
          {canSkipNow !== null && (
            <span
              className="ml-1 rounded-full bg-bili-pink px-2 text-[11px] text-white"
              onClick={(e) => {
                e.stopPropagation();
                seek(canSkipNow!);
              }}
            >
              跳过
            </span>
          )}
        </button>
      ) : (
        <div className="pointer-events-auto fixed z-[2147483600] flex max-h-[calc(100vh-110px)] w-[380px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl bg-white text-slate-800 shadow-2xl ring-1 ring-slate-200" style={{ right: pos.right, top: pos.top }}>
          <header className="flex cursor-move items-center gap-2 border-b border-slate-100 px-3 py-2" onPointerDown={onDrag}>
            <GripHorizontal className="h-4 w-4 text-slate-300" />
            <span className="text-[14px] font-semibold">
              Bilibili<span className="text-bili-pink">Dry</span>
            </span>
            <span className="flex-1" />
            <div className="flex items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
              <button className="btn-ghost !p-1.5" title="导出 Markdown 笔记" onClick={exportMd} disabled={!segments.length}>
                <Download className="h-4 w-4" />
              </button>
              <button className="btn-ghost !p-1.5" title="打开知识库工作台" onClick={() => void send({ type: 'OPEN_DASHBOARD', videoId: videoId ?? undefined })}>
                <BookOpen className="h-4 w-4" />
              </button>
              <button className="btn-ghost !p-1.5" title="设置" onClick={() => void send({ type: 'OPEN_OPTIONS' })}>
                <Settings2 className="h-4 w-4" />
              </button>
              <button className="btn-ghost !p-1.5" title="收起" onClick={() => setCollapsed(true)}>
                <Minus className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="space-y-2 px-3 pt-2.5">
            {duration > 0 && <Heatmap segments={segments} duration={duration} current={time} onSeek={seek} highlightIds={digest?.highlightIds} />}
            <div className="flex items-center gap-2">
              {segments.length === 0 && !running ? (
                <button className="btn-primary" onClick={() => void analyze()} disabled={busy || !configured || !videoId}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} 分析这个视频
                </button>
              ) : (
                <>
                  <button className="btn-outline" disabled={canSkipNow === null} onClick={() => canSkipNow !== null && seek(canSkipNow)} title="跳过当前注水段">
                    <FastForward className="h-4 w-4" /> 跳过注水
                  </button>
                  <button className="btn-outline" onClick={() => { const t = nextDryStart(segments, time); if (t !== null) seek(t); }} title="跳到下一段干货">
                    <ChevronsRight className="h-4 w-4" /> 下一段
                  </button>
                </>
              )}
              <span className="flex-1" />
              {segments.length > 0 && !running && (
                <button className="btn-ghost !px-2 text-[12px]" title="用当前设置重新分析" onClick={() => void analyze(true)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {currentSeg && isSkippable(currentSeg, reasons) && settings && !settings.autoSkip && (
              <div className="text-[11px] text-slate-400">当前是{currentSeg.waterReason ? WATER_REASON_LABEL[currentSeg.waterReason] : '注水'}，可以跳过</div>
            )}
            <JobBar job={job} onResume={() => void analyze()} onCancel={() => videoId && void send({ type: 'CANCEL', videoId })} onRetryFresh={() => void analyze(true)} />
          </div>

          <nav className="mt-2 flex gap-1 border-b border-slate-100 px-2">
            {tabs.map(([key, label, Icon]) => (
              <button key={key} className={cx('flex items-center gap-1 border-b-2 px-2 py-1.5 text-[12px]', tab === key ? 'border-bili-pink font-medium text-bili-pink' : 'border-transparent text-slate-500 hover:text-slate-700')} onClick={() => setTab(key)}>
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </nav>

          <div className="min-h-[160px] flex-1 overflow-y-auto px-3 py-3 scroll-thin">
            {!configured ? (
              <Empty icon={<Settings2 className="h-6 w-6 text-slate-300" />} title="先配置一个模型">
                支持 DeepSeek、通义千问、Kimi、智谱、硅基流动、Gemini、OpenAI、Ollama 等，Key 只保存在你的浏览器里。
                <div className="mt-3">
                  <button className="btn-primary" onClick={() => void send({ type: 'OPEN_OPTIONS' })}>
                    打开设置
                  </button>
                </div>
              </Empty>
            ) : resolveError ? (
              <Empty title="读取视频信息失败">{resolveError}</Empty>
            ) : tab === 'overview' ? (
              segments.length === 0 ? (
                <Empty icon={<Sparkles className="h-6 w-6 text-bili-pink/40" />} title={running ? '正在分析…' : '还没有分析这个视频'}>
                  {running ? '从你正在看的位置开始，分析好的部分会先出现在热力条上。' : '分析后会得到：干货热力图、可跳过的注水段、章节、重点片段，以及带时间戳出处的问答。'}
                </Empty>
              ) : (
                <DigestView digest={digest} segments={segments} onSeek={seek} />
              )
            ) : tab === 'chat' ? (
              <div className="flex h-full flex-col gap-3">
                {chat.turns.length === 0 && !chat.live && (
                  <div className="space-y-1.5">
                    <div className="text-[12px] text-slate-500">试试这样问：</div>
                    {['这个视频讲了哪几件事？', '这里在说什么？', '有没有提到具体的数据或例子？'].map((q) => (
                      <button key={q} className="block w-full rounded-lg bg-slate-50 px-3 py-1.5 text-left text-[12px] text-slate-600 hover:bg-slate-100" onClick={() => chat.ask(q, time)}>
                        {q}
                      </button>
                    ))}
                    {!bundle?.video?.captionCount && <div className="text-[11px] text-amber-600">提示：问答需要先读取字幕，点上面的“分析这个视频”即可。</div>}
                  </div>
                )}
                <ChatThread turns={chat.turns} live={chat.live} error={chat.error} onSeek={seek} />
              </div>
            ) : tab === 'search' ? (
              <div className="space-y-2">
                <form onSubmit={doSearch} className="flex gap-1.5">
                  <input className="input" placeholder={scope === 'video' ? '在这个视频里找…' : '在所有分析过的视频里找…'} value={query} onChange={(e) => setQuery(e.target.value)} />
                  <button className="btn-primary shrink-0" disabled={searching}>
                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </button>
                </form>
                <div className="flex gap-3 text-[12px] text-slate-500">
                  {(['video', 'library'] as const).map((s) => (
                    <label key={s} className="flex cursor-pointer items-center gap-1">
                      <input type="radio" checked={scope === s} onChange={() => setScope(s)} />
                      {s === 'video' ? '本视频' : '知识库'}
                    </label>
                  ))}
                </div>
                {results && (
                  <SearchResults
                    items={results}
                    showVideo={scope === 'library'}
                    onSeek={(it) => (it.videoId === videoId ? seek(it.start) : void send({ type: 'SEEK', bvid: it.bvid, page: it.page, time: it.start }))}
                  />
                )}
              </div>
            ) : tab === 'segments' ? (
              segments.length ? <SegmentList segments={segments} onSeek={seek} current={time} highlightIds={digest?.highlightIds} /> : <Empty title="还没有片段" />
            ) : (
              <TraceList traces={traces} />
            )}
          </div>

          {tab === 'chat' && configured && (
            <form
              className="flex items-end gap-1.5 border-t border-slate-100 p-2"
              onSubmit={(e) => {
                e.preventDefault();
                chat.ask(question, time);
                setQuestion('');
              }}
            >
              {chat.turns.length > 0 && (
                <button type="button" className="btn-ghost !p-2" title="清空对话" onClick={() => void chat.clear()}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <textarea
                className="input max-h-28 min-h-[38px] resize-none"
                rows={1}
                placeholder="问这个视频…（Enter 发送）"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation(); // keep Bilibili's player hotkeys from firing while typing
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    chat.ask(question, time);
                    setQuestion('');
                  }
                }}
              />
              {chat.live ? (
                <button type="button" className="btn-outline shrink-0" onClick={chat.stop}>
                  停止
                </button>
              ) : (
                <button className="btn-primary shrink-0" disabled={!question.trim()}>
                  发送
                </button>
              )}
            </form>
          )}
          {bundle?.video && (
            <footer className="flex items-center gap-1 border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">
              <span className="truncate">{bundle.video.partTitle || bundle.video.title}</span>
              <span className="flex-1" />
              <a className="flex items-center gap-0.5 hover:text-slate-600" href="https://github.com/Crisply2404/BilibiliDry" target="_blank" rel="noreferrer">
                反馈 <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </footer>
          )}
        </div>
      )}
    </>
  );
}

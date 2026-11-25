import { Activity, ArrowLeft, BookOpen, Download, ExternalLink, Library, Loader2, MessageCircle, Search, Settings2, Sparkles, Trash2, Type } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Trace } from '../core/trace/tracer';
import { formatTime } from '../core/transcript/captions';
import type { CaptionLine } from '../core/types';
import { videoUrl } from '../core/export/markdown';
import { send, type JobState, type SearchResultItem, type VideoRecord } from '../shared/protocol';
import { ChatThread, cx, DigestView, Empty, Heatmap, JobBar, SearchResults, SegmentList, TraceList } from '../ui/components';
import { useChat, useEvents, useSettings, useVideo } from '../ui/hooks';

type Route = { name: 'library' } | { name: 'video'; id: string } | { name: 'traces' };

function parseRoute(): Route {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  const m = h.match(/^\/video\/(.+)$/);
  if (m) return { name: 'video', id: m[1] };
  if (h === '/traces') return { name: 'traces' };
  return { name: 'library' };
}

function useRoute(): Route {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const on = () => setRoute(parseRoute());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

const go = (hash: string) => {
  location.hash = hash;
};

type LibraryItem = VideoRecord & { jobStatus: JobState['status'] | null };

function LibraryView() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const load = useCallback(async () => setItems(await send<LibraryItem[]>({ type: 'LIST_LIBRARY' })), []);
  useEffect(() => void load(), [load]);
  useEvents('*', (p) => {
    if (p.type === 'LIBRARY_CHANGED' || (p.type === 'JOB' && ['done', 'partial', 'failed'].includes(p.job.status))) void load();
  });

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (items ?? []).filter((v) => !q || v.title.toLowerCase().includes(q) || (v.owner ?? '').toLowerCase().includes(q) || (v.tldr ?? '').toLowerCase().includes(q));
  }, [items, filter]);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return setResults(null);
    setSearching(true);
    try {
      setResults(await send<SearchResultItem[]>({ type: 'SEARCH', query, k: 12 }));
    } finally {
      setSearching(false);
    }
  };

  const totalWater = (items ?? []).reduce((a, v) => a + (v.waterSec ?? 0), 0);

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <form onSubmit={search} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input !py-2.5 pl-9 !text-[14px]" placeholder="在所有看过的视频里搜一句话、一个概念、一个名字…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button className="btn-primary !px-5" disabled={searching}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : '搜索'}
          </button>
        </form>
        {results && (
          <div className="mt-4">
            <SearchResults items={results} showVideo onSeek={(it) => void send({ type: 'SEEK', bvid: it.bvid, page: it.page, time: it.start })} />
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-[15px] font-semibold">知识库</h2>
          {items && (
            <span className="text-[12px] text-slate-400">
              {items.length} 个视频 · 累计可跳过 {formatTime(totalWater)}
            </span>
          )}
          <span className="flex-1" />
          <input className="input !w-56" placeholder="按标题 / UP 主筛选" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {!items ? (
          <div className="py-10 text-center text-slate-400">加载中…</div>
        ) : items.length === 0 ? (
          <div className="card">
            <Empty icon={<Library className="h-8 w-8 text-slate-300" />} title="知识库还是空的">
              打开任意 B 站视频，在右侧的 BilibiliDry 面板点“分析这个视频”。分析过的视频都会出现在这里，可以跨视频搜索和提问。
            </Empty>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((v) => (
              <article key={v.videoId} className="card group cursor-pointer overflow-hidden transition-shadow hover:shadow-md" onClick={() => go(`/video/${encodeURIComponent(v.videoId)}`)}>
                {v.cover && <img src={`${v.cover}@480w_270h_1c.webp`} alt="" className="aspect-video w-full object-cover" referrerPolicy="no-referrer" loading="lazy" />}
                <div className="space-y-1.5 p-3">
                  <h3 className="line-clamp-2 text-[13px] font-medium leading-snug">{v.title}{v.partTitle ? ` · ${v.partTitle}` : ''}</h3>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    {v.owner && <span>{v.owner}</span>}
                    <span>{formatTime(v.durationSec)}</span>
                    {v.waterSec !== undefined && v.durationSec > 0 && <span className="chip bg-bili-pink/10 text-bili-pink">干货 {Math.round((1 - v.waterSec / v.durationSec) * 100)}%</span>}
                    {v.jobStatus && v.jobStatus !== 'done' && <span className="chip bg-amber-50 text-amber-600">{v.jobStatus === 'partial' ? '部分完成' : v.jobStatus === 'failed' ? '失败' : v.jobStatus === 'running' || v.jobStatus === 'fetching' ? '分析中' : '未完成'}</span>}
                  </div>
                  {v.tldr && <p className="line-clamp-2 text-[12px] text-slate-500">{v.tldr}</p>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function VideoView({ id }: { id: string }) {
  const { bundle, traces: liveTraces, reload } = useVideo(id);
  const [settings] = useSettings();
  const chat = useChat(id);
  const [tab, setTab] = useState<'chat' | 'transcript' | 'trace'>('chat');
  const [lines, setLines] = useState<CaptionLine[] | null>(null);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [question, setQuestion] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (tab === 'transcript' && !lines) void send<CaptionLine[]>({ type: 'GET_CAPTIONS', videoId: id }).then(setLines);
    if (tab === 'trace') void send<Trace[]>({ type: 'GET_TRACES', videoId: id }).then(setTraces);
  }, [tab, id, lines]);

  const v = bundle?.video;
  const seek = useCallback(
    (t: number, bvid?: string) => {
      if (!v) return;
      void send({ type: 'SEEK', bvid: bvid ?? v.bvid, page: bvid && bvid !== v.bvid ? 1 : v.page, time: t });
    },
    [v]
  );
  if (!bundle) return <div className="py-10 text-center text-slate-400">加载中…</div>;
  if (!v) return <Empty title="没有找到这个视频" />;

  const allTraces = [...liveTraces, ...traces.filter((t) => !liveTraces.some((l) => l.id === t.id))];
  const shownLines = (lines ?? []).filter((l) => !filter || l.text.includes(filter));
  const analyze = (fresh = false) => void send({ type: 'ANALYZE', bvid: v.bvid, page: v.page, fresh }).then(reload).catch((e) => alert(e.message));

  return (
    <div className="space-y-4">
      <button className="btn-ghost !px-0" onClick={() => go('/')}>
        <ArrowLeft className="h-4 w-4" /> 知识库
      </button>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-snug">{v.title}{v.partTitle ? ` · ${v.partTitle}` : ''}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
            {v.owner && <span>{v.owner}</span>}
            <span>{formatTime(v.durationSec)}</span>
            <span>{v.bvid}{v.page > 1 ? ` P${v.page}` : ''}</span>
            {v.analyzedAt && <span>分析于 {new Date(v.analyzedAt).toLocaleString()}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <a className="btn-outline" href={videoUrl(v)} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" /> 去 B 站看
          </a>
          <button
            className="btn-outline"
            disabled={!bundle.segments.length}
            onClick={async () => {
              const md = await send<string>({ type: 'EXPORT_MARKDOWN', videoId: id });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
              a.download = `${v.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.md`;
              a.click();
            }}
          >
            <Download className="h-4 w-4" /> 导出笔记
          </button>
          <button
            className="btn-ghost !text-red-600"
            title="从知识库删除"
            onClick={async () => {
              if (!confirm('从知识库删除这个视频的分析结果和对话？')) return;
              await send({ type: 'DELETE_VIDEO', videoId: id });
              go('/');
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Heatmap segments={bundle.segments} duration={v.durationSec} onSeek={seek} highlightIds={bundle.digest?.highlightIds} height={18} />
      <JobBar job={bundle.job} onResume={() => analyze()} onCancel={() => void send({ type: 'CANCEL', videoId: id })} onRetryFresh={() => analyze(true)} />
      {!bundle.segments.length && !bundle.job && (
        <button className="btn-primary" onClick={() => analyze()}>
          <Sparkles className="h-4 w-4" /> 分析这个视频
        </button>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_440px]">
        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="mb-3 text-[14px] font-semibold">概览</h2>
            <DigestView digest={bundle.digest} segments={bundle.segments} onSeek={seek} />
          </section>
          <section className="card p-4">
            <h2 className="mb-3 text-[14px] font-semibold">全部片段</h2>
            <SegmentList segments={bundle.segments} onSeek={seek} highlightIds={bundle.digest?.highlightIds} />
          </section>
        </div>
        <div className="card flex max-h-[calc(100vh-120px)] flex-col lg:sticky lg:top-4">
          <nav className="flex gap-1 border-b border-slate-100 px-3">
            {(
              [
                ['chat', '问答', MessageCircle],
                ['transcript', '字幕', Type],
                ...(settings?.developerMode ? [['trace', '调用记录', Activity]] : [])
              ] as Array<[typeof tab, string, typeof MessageCircle]>
            ).map(([k, label, Icon]) => (
              <button key={k} className={cx('flex items-center gap-1 border-b-2 px-2 py-2 text-[13px]', tab === k ? 'border-bili-pink font-medium text-bili-pink' : 'border-transparent text-slate-500')} onClick={() => setTab(k)}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </nav>
          <div className="flex-1 overflow-y-auto p-4 scroll-thin">
            {tab === 'chat' ? (
              chat.turns.length === 0 && !chat.live ? (
                <Empty icon={<MessageCircle className="h-6 w-6 text-slate-300" />} title="问这个视频">
                  回答里的时间戳可以点击，会跳到 B 站对应位置。也可以问“我以前看的视频里谁讲过 X”。
                </Empty>
              ) : (
                <ChatThread turns={chat.turns} live={chat.live} error={chat.error} onSeek={seek} />
              )
            ) : tab === 'transcript' ? (
              <div className="space-y-2">
                <input className="input" placeholder="筛选字幕…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                {!lines ? (
                  <div className="text-[12px] text-slate-400">加载中…</div>
                ) : lines.length === 0 ? (
                  <Empty title="还没有字幕" />
                ) : (
                  <ul className="space-y-0.5">
                    {shownLines.slice(0, 1500).map((l) => (
                      <li key={l.idx} className="flex gap-2 text-[12px] leading-relaxed">
                        <button className="ts shrink-0" onClick={() => seek(l.from)}>
                          {formatTime(l.from)}
                        </button>
                        <span className="text-slate-700">{l.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <TraceList traces={allTraces} />
            )}
          </div>
          {tab === 'chat' && (
            <form
              className="flex gap-2 border-t border-slate-100 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                chat.ask(question);
                setQuestion('');
              }}
            >
              {chat.turns.length > 0 && (
                <button type="button" className="btn-ghost !p-2" onClick={() => void chat.clear()} title="清空对话">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <input className="input" placeholder="问这个视频…" value={question} onChange={(e) => setQuestion(e.target.value)} />
              {chat.live ? (
                <button type="button" className="btn-outline" onClick={chat.stop}>
                  停止
                </button>
              ) : (
                <button className="btn-primary" disabled={!question.trim()}>
                  发送
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function TracesView() {
  const [traces, setTraces] = useState<Trace[] | null>(null);
  useEffect(() => void send<Trace[]>({ type: 'GET_TRACES', limit: 100 }).then(setTraces), []);
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-[14px] font-semibold">最近的调用记录</h2>
      {traces ? <TraceList traces={traces} /> : <div className="text-slate-400">加载中…</div>}
    </section>
  );
}

export function Dashboard() {
  const route = useRoute();
  const [settings] = useSettings();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
          <button className="flex items-center gap-2 text-[16px] font-bold" onClick={() => go('/')}>
            <BookOpen className="h-5 w-5 text-bili-pink" />
            Bilibili<span className="-ml-2 text-bili-pink">Dry</span>
          </button>
          <span className="flex-1" />
          {settings?.developerMode && (
            <button className={cx('btn-ghost', route.name === 'traces' && 'bg-slate-100')} onClick={() => go('/traces')}>
              <Activity className="h-4 w-4" /> 调用记录
            </button>
          )}
          <button className="btn-ghost" onClick={() => void send({ type: 'OPEN_OPTIONS' })}>
            <Settings2 className="h-4 w-4" /> 设置
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-6">{route.name === 'video' ? <VideoView id={route.id} /> : route.name === 'traces' ? <TracesView /> : <LibraryView />}</main>
    </div>
  );
}

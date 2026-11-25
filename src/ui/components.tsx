import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Loader2, Search, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { heatmap } from '../core/playback';
import type { Trace } from '../core/trace/tracer';
import { traceTotals } from '../core/trace/tracer';
import { formatTime } from '../core/transcript/captions';
import { WATER_REASON_LABEL, type Segment, type VideoDigest } from '../core/types';
import type { ChatTurnRecord, JobState, SearchResultItem } from '../shared/protocol';
import type { LiveTurn } from './hooks';

export type SeekFn = (time: number, bvid?: string) => void;

export function cx(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(' ');
}

export function Ts({ t, onSeek, bvid, className }: { t: number; onSeek: SeekFn; bvid?: string; className?: string }) {
  return (
    <button type="button" className={cx('ts', className)} onClick={() => onSeek(t, bvid)} title="跳到这里">
      {formatTime(t)}
    </button>
  );
}

function heatColor(kind: string, value: number): string {
  if (kind === 'water') return '#e2e8f0';
  if (kind === 'unknown') return '#f8fafc';
  // light pink → bilibili pink by importance
  const a = 0.25 + 0.75 * value;
  return `rgba(251, 114, 153, ${a.toFixed(2)})`;
}

/** Timeline bar: pink intensity = importance, grey = filler, blank = not analysed yet. */
export function Heatmap({
  segments,
  duration,
  current,
  onSeek,
  highlightIds,
  height = 14
}: {
  segments: Segment[];
  duration: number;
  current?: number;
  onSeek: SeekFn;
  highlightIds?: string[];
  height?: number;
}) {
  const cells = useMemo(() => heatmap(segments, duration), [segments, duration]);
  const hl = new Set(highlightIds ?? []);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  if (!duration) return null;
  const segAt = (t: number) => segments.find((s) => t >= s.start && t < s.end);
  const hovered = hover ? segAt(hover.t) : undefined;
  return (
    <div className="relative select-none">
      <div
        className="relative w-full cursor-pointer overflow-hidden rounded-md bg-slate-100"
        style={{ height }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
          setHover({ x, t: (x / r.width) * duration });
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - r.left) / r.width) * duration);
        }}
      >
        {cells.map((c, i) => (
          <div
            key={i}
            className="absolute top-0 h-full"
            style={{ left: `${(c.start / duration) * 100}%`, width: `${Math.max(0.15, ((c.end - c.start) / duration) * 100)}%`, background: heatColor(c.kind, c.value) }}
          />
        ))}
        {segments
          .filter((s) => hl.has(s.id))
          .map((s) => (
            <div key={s.id} className="absolute top-0 h-[3px] bg-bili-blue" style={{ left: `${(s.start / duration) * 100}%`, width: `${((s.end - s.start) / duration) * 100}%` }} />
          ))}
        {current !== undefined && <div className="absolute top-0 h-full w-[2px] bg-slate-900" style={{ left: `${(current / duration) * 100}%` }} />}
      </div>
      {hover && (
        <div className="pointer-events-none absolute -top-1 z-10 max-w-[260px] -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-2 py-1 text-[11px] leading-snug text-white shadow" style={{ left: Math.max(60, hover.x) }}>
          <span className="font-mono">{formatTime(hover.t)}</span>
          {hovered && (
            <>
              {' · '}
              {hovered.kind === 'water' ? `可跳过：${hovered.waterReason ? WATER_REASON_LABEL[hovered.waterReason] : '注水'}` : hovered.title}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const PHASE_LABEL: Record<string, string> = {
  captions: '读取字幕',
  map: '分块识别干货/注水',
  digest: '生成章节与总结',
  verify: '核对字幕证据',
  refine: '精修重点',
  done: '完成'
};

export function JobBar({ job, onResume, onCancel, onRetryFresh }: { job: JobState | null; onResume: () => void; onCancel: () => void; onRetryFresh?: () => void }) {
  if (!job) return null;
  const active = ['queued', 'fetching', 'running'].includes(job.status);
  const pct = job.chunksTotal ? Math.round((job.chunksDone / job.chunksTotal) * 100) : 0;
  const resumable = ['interrupted', 'cancelled', 'partial', 'failed'].includes(job.status);
  if (job.status === 'done') return null;
  return (
    <div className={cx('rounded-lg border px-3 py-2 text-[12px]', job.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50')}>
      <div className="flex items-center gap-2">
        {active ? <Loader2 className="h-3.5 w-3.5 animate-spin text-bili-pink" /> : job.status === 'failed' ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" /> : <CircleDashed className="h-3.5 w-3.5 text-slate-400" />}
        <span className="font-medium text-slate-700">{active ? PHASE_LABEL[job.phase] ?? job.phase : job.message}</span>
        {job.chunksTotal > 0 && <span className="text-slate-400">{job.chunksDone}/{job.chunksTotal} 段</span>}
        <span className="flex-1" />
        {active && (
          <button className="btn-ghost !px-2 !py-0.5 text-[12px]" onClick={onCancel}>
            停止
          </button>
        )}
        {resumable && (
          <button className="btn-outline !px-2 !py-0.5 text-[12px]" onClick={onResume}>
            继续
          </button>
        )}
        {job.status === 'failed' && onRetryFresh && (
          <button className="btn-ghost !px-2 !py-0.5 text-[12px]" onClick={onRetryFresh}>
            重新开始
          </button>
        )}
      </div>
      {active && job.chunksTotal > 0 && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-bili-pink transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {job.error && <div className="mt-1 break-all text-[11px] text-red-600">{job.error}</div>}
    </div>
  );
}

export function DigestView({ digest, segments, onSeek }: { digest: VideoDigest | null; segments: Segment[]; onSeek: SeekFn }) {
  const highlights = segments.filter((s) => digest?.highlightIds.includes(s.id));
  const waterSec = segments.filter((s) => s.kind === 'water').reduce((a, s) => a + s.end - s.start, 0);
  const total = segments.length ? segments[segments.length - 1].end - segments[0].start : 0;
  return (
    <div className="space-y-4">
      {digest?.tldr && <p className="text-[13px] leading-relaxed text-slate-700">{digest.tldr}</p>}
      {total > 0 && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="chip bg-bili-pink/10 text-bili-pink">干货 {Math.round(((total - waterSec) / total) * 100)}%</span>
          <span className="chip bg-slate-100 text-slate-500">可跳过 {formatTime(waterSec)}</span>
          <span className="chip bg-slate-100 text-slate-500">{segments.length} 个片段</span>
        </div>
      )}
      {highlights.length > 0 && (
        <section>
          <h4 className="mb-1.5 flex items-center gap-1 text-[12px] font-semibold text-slate-500">
            <Sparkles className="h-3.5 w-3.5 text-bili-pink" /> 只看这几段
          </h4>
          <ul className="space-y-1.5">
            {highlights.map((s) => (
              <li key={s.id} className="rounded-lg bg-slate-50 px-2.5 py-2">
                <div className="flex items-start gap-1.5">
                  <Ts t={s.start} onSeek={onSeek} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-slate-800">
                      {s.title}
                      <GroundBadge s={s} />
                    </div>
                    <div className="text-[12px] leading-relaxed text-slate-600">{s.summary}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {digest && digest.takeaways.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[12px] font-semibold text-slate-500">要点</h4>
          <ul className="list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-slate-700">
            {digest.takeaways.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}
      {digest && digest.chapters.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[12px] font-semibold text-slate-500">章节</h4>
          <ol className="space-y-1">
            {digest.chapters.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[12px]">
                <Ts t={c.start} onSeek={onSeek} />
                <div>
                  <span className="font-medium text-slate-800">{c.title}</span>
                  {c.summary && <span className="text-slate-500"> — {c.summary}</span>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function GroundBadge({ s }: { s: Segment }) {
  const g = s.grounding;
  if (!g) return null;
  if (g.verdict === 'supported' || (!g.verdict && g.lexical >= 0.7))
    return (
      <span className="ml-1 inline-flex align-middle text-emerald-500" title={`字幕证据充分（词面重合 ${Math.round(g.lexical * 100)}%）${g.reason ? `：${g.reason}` : ''}`}>
        <ShieldCheck className="h-3.5 w-3.5" />
      </span>
    );
  if (g.verdict === 'partial' || g.lexical < 0.4)
    return (
      <span className="ml-1 inline-flex align-middle text-amber-500" title={`证据不完全${g.reason ? `：${g.reason}` : ''}（词面重合 ${Math.round(g.lexical * 100)}%）`}>
        <AlertTriangle className="h-3.5 w-3.5" />
      </span>
    );
  return null;
}

export function SegmentList({ segments, onSeek, current, highlightIds }: { segments: Segment[]; onSeek: SeekFn; current?: number; highlightIds?: string[] }) {
  const hl = new Set(highlightIds ?? []);
  return (
    <ul className="space-y-1">
      {segments.map((s) => {
        const active = current !== undefined && current >= s.start && current < s.end;
        return (
          <li key={s.id} className={cx('rounded-lg px-2 py-1.5 text-[12px]', active ? 'bg-bili-blue/10' : 'hover:bg-slate-50', s.kind === 'water' && 'opacity-60')}>
            <div className="flex items-start gap-1.5">
              <Ts t={s.start} onSeek={onSeek} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  {s.kind === 'water' ? (
                    <span className="chip bg-slate-100 text-slate-500">{s.waterReason ? WATER_REASON_LABEL[s.waterReason] : '注水'}</span>
                  ) : (
                    <span className="text-[10px] tracking-tighter text-bili-pink">{'●'.repeat(s.importance)}</span>
                  )}
                  <span className={cx('truncate font-medium', s.kind === 'water' ? 'text-slate-500' : 'text-slate-800')}>{s.title}</span>
                  {hl.has(s.id) && <Sparkles className="h-3 w-3 shrink-0 text-bili-pink" />}
                  <GroundBadge s={s} />
                </div>
                {s.kind === 'dry' && s.summary && <div className="mt-0.5 leading-relaxed text-slate-600">{s.summary}</div>}
                {s.kind === 'dry' && s.keyPoints.length > 0 && (
                  <ul className="mt-0.5 list-disc pl-4 text-slate-500">
                    {s.keyPoints.map((k, i) => (
                      <li key={i}>{k}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Render an answer: paragraphs, "- " lists, **bold**, and [mm:ss] / [BV.. mm:ss] as seek buttons. */
export function AnswerText({ text, citations, onSeek }: { text: string; citations?: ChatTurnRecord['citations']; onSeek: SeekFn }) {
  const grounded = new Map((citations ?? []).map((c) => [c.raw, c.grounded]));
  const renderInline = (line: string, key: number): ReactNode => {
    const parts = line.split(/(\[(?:BV[0-9A-Za-z]{10}\s*)?\d{1,2}:\d{2}(?::\d{2})?\]|\*\*[^*]+\*\*)/g);
    return (
      <Fragment key={key}>
        {parts.map((p, i) => {
          const m = p.match(/^\[(?:(BV[0-9A-Za-z]{10})\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\]$/);
          if (m) {
            const t = m[2].split(':').reduce((a, x) => a * 60 + Number(x), 0);
            const ok = grounded.get(p);
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSeek(t, m[1])}
                className={cx('ts mx-0.5 align-baseline', ok === false && '!text-amber-600')}
                title={ok === false ? '这个时间点不在检索到的证据里，请自行核对' : m[1] ? `跳到 ${m[1]} 的 ${m[2]}` : '跳到这里'}
              >
                {m[1] ? `${m[1].slice(0, 6)}… ${m[2]}` : m[2]}
              </button>
            );
          }
          if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
          return <Fragment key={i}>{p}</Fragment>;
        })}
      </Fragment>
    );
  };
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-slate-800">
      {blocks.map((b, bi) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*([-*]|\d+[.、])\s+/.test(l))) {
          return (
            <ul key={bi} className="list-disc space-y-0.5 pl-4">
              {lines.map((l, i) => (
                <li key={i}>{renderInline(l.replace(/^\s*([-*]|\d+[.、])\s+/, ''), i)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {renderInline(l.replace(/^#+\s*/, ''), i)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const TOOL_LABEL: Record<string, string> = {
  search_transcript: '检索字幕',
  read_transcript: '阅读字幕',
  get_outline: '查看大纲',
  search_library: '检索知识库'
};

export function ToolSteps({ tools }: { tools: Array<{ name: string; summary?: string; args?: Record<string, unknown> }> }) {
  const [open, setOpen] = useState(false);
  if (tools.length === 0) return null;
  return (
    <div className="text-[11px] text-slate-500">
      <button type="button" className="flex items-center gap-1 hover:text-slate-700" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Wrench className="h-3 w-3" /> 调用了 {tools.length} 次工具
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 border-l-2 border-slate-200 pl-2">
          {tools.map((t, i) => (
            <li key={i}>
              <span className="font-medium text-slate-600">{TOOL_LABEL[t.name] ?? t.name}</span>
              {t.args && Object.keys(t.args).length > 0 && <span className="text-slate-400"> {Object.values(t.args).map(String).join(' / ')}</span>}
              {t.summary && <span> → {t.summary}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ChatThread({
  turns,
  live,
  error,
  onSeek
}: {
  turns: ChatTurnRecord[];
  live: LiveTurn | null;
  error: string | null;
  onSeek: SeekFn;
}) {
  return (
    <div className="space-y-3">
      {turns.map((t, i) =>
        t.role === 'user' ? (
          <div key={i} className="ml-8 rounded-xl rounded-tr-sm bg-bili-blue/10 px-3 py-2 text-[13px] text-slate-800">
            {t.content}
          </div>
        ) : (
          <div key={i} className="space-y-1.5">
            {t.tools && <ToolSteps tools={t.tools} />}
            {t.error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">{t.error}</div> : <AnswerText text={t.content} citations={t.citations} onSeek={onSeek} />}
            {t.citations && t.citations.length > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <CheckCircle2 className="h-3 w-3" />
                {t.citations.filter((c) => c.grounded).length}/{t.citations.length} 处引用有字幕证据{t.mode === 'rag' ? ' · 单轮检索模式' : ''}
              </div>
            )}
          </div>
        )
      )}
      {live && (
        <div className="space-y-1.5">
          <div className="ml-8 rounded-xl rounded-tr-sm bg-bili-blue/10 px-3 py-2 text-[13px] text-slate-800">{live.question}</div>
          {live.tools.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-slate-500">
              {live.tools.map((t) => (
                <li key={t.id} className="flex items-center gap-1">
                  {t.summary ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <Loader2 className="h-3 w-3 animate-spin" />}
                  {t.name === 'search_transcript' || t.name === 'search_library' ? <Search className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                  {TOOL_LABEL[t.name] ?? t.name} {Object.values(t.args).map(String).join(' / ')}
                  {t.summary && <span className="text-slate-400"> → {t.summary}</span>}
                </li>
              ))}
            </ul>
          )}
          {live.answer ? (
            <AnswerText text={live.answer} onSeek={onSeek} />
          ) : (
            <div className="flex items-center gap-1 text-[12px] text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 思考中…
            </div>
          )}
        </div>
      )}
      {error && !live && turns.length === 0 && <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</div>}
    </div>
  );
}

export function SearchResults({ items, onSeek, showVideo }: { items: SearchResultItem[]; onSeek: (item: SearchResultItem) => void; showVideo?: boolean }) {
  if (items.length === 0) return <div className="py-6 text-center text-[12px] text-slate-400">没有找到相关内容</div>;
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="cursor-pointer rounded-lg border border-slate-100 px-2.5 py-2 hover:border-bili-blue/40 hover:bg-bili-blue/5" onClick={() => onSeek(it)}>
          <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="font-mono text-bili-blue">{formatTime(it.start)}</span>
            {showVideo && <span className="truncate">《{it.videoTitle}》</span>}
            <span className="flex-1" />
            <span>{it.via.join('+')}</span>
          </div>
          {it.context && <div className="text-[12px] font-medium text-slate-700">{it.context.split('：')[0]}</div>}
          <div className="line-clamp-3 text-[12px] leading-relaxed text-slate-600">{it.text}</div>
        </li>
      ))}
    </ul>
  );
}

export function TraceList({ traces }: { traces: Trace[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (traces.length === 0) return <div className="py-6 text-center text-[12px] text-slate-400">还没有记录</div>;
  return (
    <ul className="space-y-2">
      {traces.map((t) => {
        const tot = traceTotals(t);
        const isOpen = open === t.id;
        return (
          <li key={t.id} className="rounded-lg border border-slate-200">
            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]" onClick={() => setOpen(isOpen ? null : t.id)}>
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span className="chip bg-slate-100 text-slate-600">{t.kind === 'analysis' ? '分析' : t.kind === 'chat' ? '问答' : '检索'}</span>
              <span className="min-w-0 flex-1 truncate text-slate-700">{t.title}</span>
              <span className="shrink-0 text-slate-400">
                {tot.llmCalls} 次调用 · {(tot.promptTokens + tot.completionTokens).toLocaleString()} tok · {(tot.wallMs / 1000).toFixed(1)}s
                {tot.errors > 0 && <span className="text-red-500"> · {tot.errors} 错误</span>}
              </span>
            </button>
            {isOpen && <TraceTimeline trace={t} />}
          </li>
        );
      })}
    </ul>
  );
}

function TraceTimeline({ trace }: { trace: Trace }) {
  const end = trace.endedAt ?? Math.max(...trace.spans.map((s) => s.end ?? s.start), trace.startedAt + 1);
  const span = Math.max(1, end - trace.startedAt);
  const color: Record<string, string> = { stage: 'bg-slate-300', llm: 'bg-bili-pink', tool: 'bg-bili-blue', retrieval: 'bg-emerald-400', embed: 'bg-violet-400' };
  return (
    <div className="max-h-80 overflow-auto border-t border-slate-100 px-3 py-2 scroll-thin">
      {trace.spans.map((s) => (
        <div key={s.id} className="grid grid-cols-[160px_1fr_90px] items-center gap-2 py-0.5 text-[11px]">
          <span className={cx('truncate', s.parentId ? 'pl-3 text-slate-500' : 'font-medium text-slate-700')} title={s.error ?? JSON.stringify(s.attrs)}>
            {s.name}
          </span>
          <div className="relative h-2.5 rounded bg-slate-50">
            <div
              className={cx('absolute top-0 h-full rounded', s.status === 'error' ? 'bg-red-400' : color[s.kind] ?? 'bg-slate-300')}
              style={{ left: `${((s.start - trace.startedAt) / span) * 100}%`, width: `${Math.max(0.5, (((s.end ?? end) - s.start) / span) * 100)}%` }}
            />
          </div>
          <span className="text-right font-mono text-slate-400">
            {(((s.end ?? end) - s.start) / 1000).toFixed(1)}s{s.attrs.completionTokens !== undefined ? ` ${s.attrs.completionTokens}t` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      {icon}
      <div className="text-[13px] font-medium text-slate-700">{title}</div>
      {children && <div className="text-[12px] leading-relaxed text-slate-500">{children}</div>}
    </div>
  );
}

import { FastForward, Loader2, PanelRight, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { segmentAt, skipTarget } from '../core/playback';
import { formatTime } from '../core/transcript/captions';
import { WATER_REASON_LABEL, type Segment } from '../core/types';
import { send, type TabCommand, type VideoBundle } from '../shared/protocol';
import { useSettings, useVideo } from '../ui/hooks';
import { findProgressBar, findVideo, readLocation } from './page';

function useLocation() {
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

function usePlayback() {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [time, setTime] = useState(0);
  const [paused, setPaused] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setVideo((cur) => findVideo() ?? cur), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!video) return;
    const on = () => {
      setTime(video.currentTime);
      setPaused(video.paused);
    };
    for (const e of ['timeupdate', 'seeked', 'play', 'pause']) video.addEventListener(e, on);
    on();
    return () => {
      for (const e of ['timeupdate', 'seeked', 'play', 'pause']) video.removeEventListener(e, on);
    };
  }, [video]);
  return { video, time, paused };
}

/** A shadow root inside Bilibili's progress bar, so our strip scales and hides with it. */
function useProgressHost(enabled: boolean): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled) {
      setHost(null);
      return;
    }
    const attach = () => {
      const bar = findProgressBar();
      if (!bar) return setHost(null);
      let el = bar.querySelector<HTMLElement>(':scope > .bdry-progress');
      if (!el) {
        el = document.createElement('div');
        el.className = 'bdry-progress';
        el.style.cssText = 'position:absolute;left:0;right:0;top:-7px;height:4px;pointer-events:none;z-index:2;';
        if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
        bar.appendChild(el);
      }
      setHost((cur) => (cur === el ? cur : el));
    };
    attach();
    const id = setInterval(attach, 1500);
    return () => clearInterval(id);
  }, [enabled]);
  return host;
}

const SEG_COLOR = (s: Segment) => (s.kind === 'water' ? 'rgba(148,163,184,0.95)' : `rgba(251,114,153,${(0.35 + 0.13 * s.importance).toFixed(2)})`);

/** Dry/filler segments (or, without analysis, the official outline's chapter marks) on the progress bar. */
function ProgressStrip({ segments, duration, marks, highlightIds }: { segments: Segment[]; duration: number; marks: number[]; highlightIds: Set<string> }) {
  if (!duration) return null;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {segments.map((s) => (
        <div
          key={s.id}
          style={{
            position: 'absolute',
            left: `${(s.start / duration) * 100}%`,
            width: `${Math.max(0.15, ((s.end - s.start) / duration) * 100)}%`,
            top: 0,
            bottom: 0,
            background: SEG_COLOR(s),
            borderTop: highlightIds.has(s.id) ? '2px solid #fb7299' : undefined,
            boxSizing: 'border-box'
          }}
        />
      ))}
      {segments.length === 0 &&
        marks.map((t, i) => <div key={i} style={{ position: 'absolute', left: `${(t / duration) * 100}%`, top: -2, width: 2, height: 8, background: 'rgba(0,174,236,0.9)', borderRadius: 1 }} />)}
    </div>
  );
}

export function PlayerLayer() {
  const loc = useLocation();
  const { video, time, paused } = usePlayback();
  const [settings] = useSettings();
  const [videoId, setVideoId] = useState<string | null>(null);
  const { bundle, setBundle } = useVideo(videoId);
  const [toast, setToast] = useState<{ text: string; undoTo?: number } | null>(null);
  const [pill, setPill] = useState(false);
  const allowed = useRef(new Set<string>());

  useEffect(() => {
    setVideoId(null);
    allowed.current.clear();
    if (!loc) return;
    send<VideoBundle>({ type: 'RESOLVE_VIDEO', bvid: loc.bvid, page: loc.page })
      .then((b) => {
        setVideoId(b.video?.videoId ?? null);
        setBundle(b);
      })
      .catch(() => undefined);
  }, [loc?.bvid, loc?.page]); // eslint-disable-line react-hooks/exhaustive-deps

  const segments = bundle?.segments ?? [];
  const duration = bundle?.video?.durationSec || video?.duration || 0;
  const reasons = useMemo(() => new Set(settings?.skipReasons ?? []), [settings?.skipReasons]);
  const highlightIds = useMemo(() => new Set(bundle?.digest?.highlightIds ?? []), [bundle?.digest]);
  const marks = useMemo(() => (bundle?.video?.official?.outline ?? []).map((o) => o.start).filter((t) => t > 1), [bundle?.video?.official]);
  const progressHost = useProgressHost(Boolean(settings?.showOnProgress));

  const seek = useCallback(
    (t: number) => {
      const v = findVideo();
      if (!v) return;
      v.currentTime = Math.max(0, t);
      if (v.paused) void v.play().catch(() => undefined);
    },
    []
  );

  // Commands from the side panel and dashboard.
  useEffect(() => {
    const on = (m: TabCommand | { type: 'GET_TIME' }, _s: unknown, reply: (r: unknown) => void) => {
      if (m?.type === 'SEEK_TO') seek(m.time);
      if (m?.type === 'GET_TIME') reply({ time: findVideo()?.currentTime ?? 0, bvid: loc?.bvid });
    };
    chrome.runtime.onMessage.addListener(on);
    return () => chrome.runtime.onMessage.removeListener(on);
  }, [seek, loc?.bvid]);

  // Auto-skip filler of the chosen kinds. A segment the user went back to with "撤销" is never skipped again.
  const current = segmentAt(segments, time);
  useEffect(() => {
    if (!settings?.autoSkip || !video || paused || !current || current.kind !== 'water' || allowed.current.has(current.id)) return;
    const target = skipTarget(segments, time, reasons);
    if (target === null) return;
    const from = time;
    video.currentTime = target;
    allowed.current.add(current.id);
    setToast({ text: `已跳过 ${formatTime(target - from)} ${current.waterReason ? WATER_REASON_LABEL[current.waterReason] : '注水'}`, undoTo: from });
  }, [time, settings?.autoSkip, segments, reasons, video, paused, current]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  // The entry pill shows while the mouse moves over the player, like the player's own controls.
  useEffect(() => {
    const player = video?.closest('.bpx-player-container') ?? video?.parentElement;
    if (!player) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const show = () => {
      setPill(true);
      if (t) clearTimeout(t);
      t = setTimeout(() => setPill(false), 2500);
    };
    player.addEventListener('mousemove', show);
    return () => {
      player.removeEventListener('mousemove', show);
      if (t) clearTimeout(t);
    };
  }, [video]);

  if (!loc) return null;
  const skipTo = current?.kind === 'water' ? current.end : null;
  const running = bundle?.job ? ['queued', 'fetching', 'running'].includes(bundle.job.status) : false;
  const dryShare = segments.length ? segments.filter((s) => s.kind === 'dry').reduce((a, s) => a + s.end - s.start, 0) / Math.max(1, duration) : null;

  const openPanel = () =>
    void send({ type: 'OPEN_SIDE_PANEL' }).catch(() => setToast({ text: '点浏览器右上角的 BilibiliDry 图标打开侧边栏' }));

  return (
    <>
      {progressHost && createPortal(<ProgressStrip segments={segments} duration={duration} marks={marks} highlightIds={highlightIds} />, progressHost)}

      <button
        className={`pointer-events-auto absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[12px] text-white backdrop-blur transition-opacity hover:bg-black/75 ${pill || running ? 'opacity-100' : 'opacity-0'}`}
        onClick={openPanel}
        title="打开 BilibiliDry 侧边栏"
      >
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-bili-pink" /> : <Sparkles className="h-3.5 w-3.5 text-bili-pink" />}
        {running ? `分析中 ${bundle?.job?.linesTotal ? Math.round((bundle.job.linesDone / bundle.job.linesTotal) * 100) : 0}%` : dryShare !== null ? `干货 ${Math.round(dryShare * 100)}%` : 'Dry'}
        <PanelRight className="h-3.5 w-3.5 opacity-70" />
      </button>

      {skipTo !== null && !(settings?.autoSkip && current?.waterReason && reasons.has(current.waterReason)) && (
        <button
          className="pointer-events-auto absolute bottom-[72px] right-4 flex items-center gap-1.5 rounded-md bg-black/70 px-3.5 py-2 text-[13px] font-medium text-white shadow-lg backdrop-blur hover:bg-black/85"
          onClick={() => {
            allowed.current.add(current!.id);
            seek(skipTo);
          }}
        >
          跳过{current?.waterReason ? WATER_REASON_LABEL[current.waterReason] : '注水'}
          <span className="font-normal text-white/70">{formatTime(skipTo - time)}</span>
          <FastForward className="h-4 w-4 text-bili-pink" />
        </button>
      )}

      {toast && (
        <div className="pointer-events-auto absolute bottom-[72px] left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/75 px-4 py-2 text-[13px] text-white shadow-lg">
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
    </>
  );
}

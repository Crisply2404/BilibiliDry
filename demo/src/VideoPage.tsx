import { Maximize, Minimize, Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime } from '../../src/core/transcript/captions';
import { send, type VideoBundle } from '../../src/shared/protocol';
import { useSettings } from '../../src/ui/hooks';
import { SITE_BASE, videoPageUrl } from './boot';
import { clearDemoStorage } from './chromeShim';
import type { DemoVideo } from './videos';

const REPO = 'https://github.com/Crisply2404/BilibiliDry';

/**
 * A player with the same class names as Bilibili's ("bpx-player-…"), so the extension's real
 * player layer finds the container and draws onto this progress bar. Its web fullscreen covers the
 * window like Bilibili's, and the panel moves into a drawer exactly as it would there.
 */
function DemoPlayer({ video }: { video: DemoVideo }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [web, setWeb] = useState(false);
  const duration = video.built.video.durationSec;
  const caption = useMemo(() => video.built.lines.find((l) => time >= l.from && time <= l.to + 0.2)?.text ?? '', [time, video]);

  useEffect(() => {
    const t = Number(new URLSearchParams(location.search).get('t'));
    const el = ref.current;
    if (!el || !Number.isFinite(t) || t <= 0) return;
    const go = () => {
      el.currentTime = t;
      void el.play().catch(() => undefined);
    };
    if (el.readyState >= 1) go();
    else el.addEventListener('loadedmetadata', go, { once: true });
  }, []);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };

  return (
    <div className={`bpx-player-container player ${web ? 'web' : ''}`} data-screen={web ? 'web' : 'normal'}>
      <video
        ref={ref}
        src={new URL(video.media, SITE_BASE).href}
        playsInline
        muted
        preload="metadata"
        onClick={toggle}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onSeeked={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div className="player-label">示例画面</div>
      <div className="player-title">{video.built.video.title}</div>
      {caption && <div className="caption">{caption}</div>}
      <div className="controls">
        <button className="play" onClick={toggle} aria-label={playing ? '暂停' : '播放'}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <div
          className="bpx-player-progress-wrap progress-wrap"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (ref.current) ref.current.currentTime = ((e.clientX - r.left) / r.width) * duration;
          }}
        >
          <div className="bpx-player-progress">
            <div className="bpx-player-progress-schedule-wrap schedule">
              <div className="played" style={{ width: `${(time / Math.max(1, duration)) * 100}%` }} />
            </div>
          </div>
        </div>
        <span className="time">
          {formatTime(time)} / {formatTime(duration)}
        </span>
        <button className="play" onClick={() => setWeb((w) => !w)} aria-label={web ? '退出网页全屏' : '网页全屏'} title={web ? '退出网页全屏' : '网页全屏'}>
          {web ? <Minimize size={17} /> : <Maximize size={17} />}
        </button>
      </div>
    </div>
  );
}

function useOtherStatus(other: DemoVideo): 'none' | 'running' | 'done' {
  const [status, setStatus] = useState<'none' | 'running' | 'done'>('none');
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const b = await send<VideoBundle>({ type: 'GET_VIDEO', videoId: `${other.bvid}_${other.cid}` });
        if (stop) return;
        const running = b.job && ['queued', 'fetching', 'running'].includes(b.job.status);
        setStatus(running ? 'running' : b.segments.length ? 'done' : 'none');
      } catch {
        // background still starting
      }
    };
    void poll();
    const t = setInterval(poll, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [other]);
  return status;
}

export function VideoPage({ video, other }: { video: DemoVideo; other: DemoVideo }) {
  const [settings, save] = useSettings();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const otherStatus = useOtherStatus(other);
  const { title, durationSec } = video.built.video;

  useEffect(() => {
    const open = () => setOptionsOpen(true);
    window.addEventListener('bdry-demo:options', open);
    return () => window.removeEventListener('bdry-demo:options', open);
  }, []);

  const reset = async () => {
    if (!confirm('清空这个演示里的分析结果、对话和设置，回到初始状态？')) return;
    await send({ type: 'CLEAR_ALL' }).catch(() => undefined);
    clearDemoStorage();
    location.href = videoPageUrl(video.bvid);
  };

  return (
    <div className="demo">
      <header className="topbar">
        <a className="brand" href={videoPageUrl(video.bvid)}>
          Bilibili<span>Dry</span>
          <em>在线演示</em>
        </a>
        <nav>
          <a href={new URL('dashboard.html', SITE_BASE).href} target="_blank" rel="noreferrer">
            知识库工作台
          </a>
          <a href={`${REPO}/releases`} target="_blank" rel="noreferrer">
            安装扩展
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <button onClick={() => void reset()}>重置</button>
        </nav>
      </header>

      <div className="layout">
        <main className="page">
          <section className="meta">
            <h1>{title}</h1>
            <div className="meta-row">
              <span>{formatTime(durationSec)}</span>
              <span>AI 字幕（原创示例）</span>
              <label className="toggle">
                <input type="checkbox" checked={Boolean(settings?.autoSkip)} disabled={!settings} onChange={(e) => void save({ autoSkip: e.target.checked })} />
                自动跳过注水（广告、寒暄、重复）
              </label>
            </div>
          </section>

          <DemoPlayer video={video} />

          <section className="intro">
            <h2>不用装扩展，先看看它怎么用</h2>
            <p>
              这一页把 BilibiliDry 扩展的代码原样跑在你的浏览器里：播放器上的进度条标注和跳过按钮、右边的 BilibiliDry 卡片、分析和问答、知识库都是真的。只有两处换成了预先准备的回应：<b>B 站接口</b>和<b>大模型</b>，所以不需要 API Key，也不会调用任何模型。两个视频的字幕是为评测写的原创样例，画面是占位。
            </p>
            <ol>
              <li>右边卡片先显示的是“B 站 AI 总结”：B 站自己生成的总结，装了扩展不配 Key 也能看。</li>
              <li>点“分析这个视频”：模型一次读完整个视频，片段一段段出现在播放器的进度条上，粉色越深越重要，灰色是寒暄、广告、重复。</li>
              <li>播放视频：放到注水段时，播放器右下角会出现“跳过”按钮；也可以勾上上面的“自动跳过”。</li>
              <li>在卡片的“问答”里提问，回答里的时间可以点；在“知识库”里可以跨视频搜索和提问。</li>
              <li>点播放器右下角的网页全屏：右栏没了，卡片会变成播放器里的抽屉，点右上角的按钮打开。</li>
            </ol>
            <p className="muted">问到没准备过的问题时，模拟模型会直接列出字幕里最相关的几句。</p>
          </section>
        </main>

        {/* Bilibili's right column, with the class names the content script looks for. */}
        <aside className="right-container">
          <div className="right-container-inner">
            <div className="up-panel-container">
              <span className="up-avatar">{video.owner.slice(0, 1)}</span>
              <span className="up-info">
                <span className="up-name">{video.owner}</span>
                <span className="muted">演示用的 UP 主</span>
              </span>
            </div>
            <div className="video-pod-above-modules">
              <div id="danmukuBox" className="danmaku-box">
                弹幕列表<span className="muted">演示里没有弹幕</span>
              </div>
            </div>
            <section className="next">
              <div className="next-head">演示里的另一个视频</div>
              <a className="next-card" href={videoPageUrl(other.bvid)}>
                <span className="next-thumb" data-kind={other.bvid === 'BV1dryPork01' ? 'pork' : 'agent'}>
                  {formatTime(other.built.video.durationSec)}
                </span>
                <span className="next-body">
                  <span className="next-title">{other.built.video.title}</span>
                  <span className="muted">{other.owner}</span>
                </span>
              </a>
              <div className="next-status muted">
                {otherStatus === 'done' ? (
                  '已分析，可以在卡片的“知识库”里跨视频检索和提问。'
                ) : otherStatus === 'running' ? (
                  '正在后台分析…'
                ) : (
                  <>
                    还没分析。
                    <button className="linkish" onClick={() => void send({ type: 'ANALYZE', bvid: other.bvid, page: 1 }).catch(() => undefined)}>
                      在后台分析它
                    </button>
                    ，知识库里就有两个视频了。
                  </>
                )}
              </div>
            </section>
          </div>
        </aside>
      </div>

      {optionsOpen && (
        <div className="modal" role="dialog" aria-modal="true" onClick={() => setOptionsOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>设置</h3>
            <p>真实扩展里，这里会打开设置页：选一个服务商（推荐 DeepSeek，也支持通义千问、Kimi、智谱、硅基流动、Gemini、OpenAI、OpenRouter、Ollama 或自定义），填 API Key，点“保存并测试”。Key 只保存在你自己的浏览器里。</p>
            <p className="muted">演示固定使用模拟模型，所以这里不能改。</p>
            <div className="modal-actions">
              <a className="btn" href={`${REPO}/releases`} target="_blank" rel="noreferrer">
                安装扩展
              </a>
              <button className="btn primary" onClick={() => setOptionsOpen(false)}>
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

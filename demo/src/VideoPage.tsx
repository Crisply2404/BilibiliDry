import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime } from '../../src/core/transcript/captions';
import { send, type VideoBundle } from '../../src/shared/protocol';
import { useSettings } from '../../src/ui/hooks';
import { SITE_BASE, videoPageUrl } from './boot';
import { clearDemoStorage } from './chromeShim';
import type { DemoVideo } from './videos';

const REPO = 'https://github.com/Crisply2404/BilibiliDry';

function useOtherStatus(other: DemoVideo): 'none' | 'running' | 'done' {
  const [status, setStatus] = useState<'none' | 'running' | 'done'>('none');
  useEffect(() => {
    let stop = false;
    const id = `${other.bvid}_${other.cid}`;
    const poll = async () => {
      try {
        const b = await send<VideoBundle>({ type: 'GET_VIDEO', videoId: id });
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
  const ref = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [settings, save] = useSettings();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const otherStatus = useOtherStatus(other);
  const { title, durationSec } = video.built.video;

  useEffect(() => {
    const open = () => setOptionsOpen(true);
    window.addEventListener('bdry-demo:options', open);
    return () => window.removeEventListener('bdry-demo:options', open);
  }, []);

  // `?t=` from a citation or search result in another tab: jump there once the video is ready.
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

  const caption = useMemo(() => video.built.lines.find((l) => time >= l.from && time <= l.to + 0.2)?.text ?? '', [time, video]);

  const reset = async () => {
    if (!confirm('清空这个演示里的分析结果、对话和设置，回到初始状态？')) return;
    await send({ type: 'CLEAR_ALL' }).catch(() => undefined);
    clearDemoStorage();
    location.href = videoPageUrl(video.bvid);
  };

  const analyzeOther = () => void send({ type: 'ANALYZE', bvid: other.bvid, page: 1 }).catch(() => undefined);

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

      <main className="page">
        <section className="intro">
          <h2>不用装扩展，先看看它怎么用</h2>
          <p>
            这一页把 BilibiliDry 扩展的代码原样跑在你的浏览器里：分析流水线、检索、问答 Agent、知识库和右侧面板都是真的。只有两处换成了预先准备的回应：<b>B 站接口</b>和<b>大模型</b>。所以不需要 API Key，也不会调用任何模型。下面两个视频的字幕是为评测写的原创样例，画面是占位。
          </p>
          <ol>
            <li>点右侧面板里的“分析这个视频”，看热力条一块块出来。</li>
            <li>播放视频：播放器底部的细条粉色越深越重要，灰色是寒暄、广告、重复。试试“跳过注水”，或者勾上下面的“自动跳过”。</li>
            <li>在“问答”里点建议问题或者自己问。回答里的时间戳可以点，找不到字幕证据的会标黄。</li>
            <li>两个视频都分析完以后，在“搜索”里选“知识库”跨视频找，或者打开知识库工作台看每次调用的记录。</li>
          </ol>
          <p className="muted">问到没准备过的问题时，模拟模型会直接列出检索到的原文。手机上面板默认收起，点右上角的“Dry”展开；在电脑上体验最完整。</p>
        </section>

        <div className="player">
          <video ref={ref} src={new URL(video.media, SITE_BASE).href} controls playsInline preload="metadata" onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onSeeked={(e) => setTime(e.currentTarget.currentTime)} />
          <div className="player-label">示例画面</div>
          <div className="player-title">{title}</div>
          {caption && <div className="caption">{caption}</div>}
        </div>

        <section className="meta">
          <h1>{title}</h1>
          <div className="meta-row">
            <span>{video.owner}</span>
            <span>{formatTime(durationSec)}</span>
            <span>AI 字幕（原创示例）</span>
            <label className="toggle">
              <input type="checkbox" checked={Boolean(settings?.autoSkip)} disabled={!settings} onChange={(e) => void save({ autoSkip: e.target.checked })} />
              自动跳过注水（广告、寒暄、重复）
            </label>
          </div>
        </section>

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
              '已分析，可以在“搜索 → 知识库”里跨视频检索。'
            ) : otherStatus === 'running' ? (
              '正在后台分析…'
            ) : (
              <>
                还没分析。
                <button className="linkish" onClick={analyzeOther}>
                  在后台分析它
                </button>
                ，知识库里就有两个视频了。
              </>
            )}
          </div>
        </section>
      </main>

      {optionsOpen && (
        <div className="modal" role="dialog" aria-modal="true" onClick={() => setOptionsOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>设置</h3>
            <p>
              真实扩展里，这里会打开设置页：选一个服务商（DeepSeek、通义千问、Kimi、智谱、硅基流动、Gemini、OpenAI、OpenRouter、Ollama 或自定义），填 API Key，点“保存并测试”。Key 只保存在你自己的浏览器里。
            </p>
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

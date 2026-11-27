import { createRoot } from 'react-dom/client';
import { boot } from './boot';
import './demo.css';
import { VideoPage } from './VideoPage';
import { DEMO_VIDEOS } from './videos';

const bvid = /\/video\/(BV[0-9A-Za-z]{10})/.exec(location.pathname)?.[1];
const video = DEMO_VIDEOS.find((v) => v.bvid === bvid) ?? DEMO_VIDEOS[0];
const other = DEMO_VIDEOS.find((v) => v !== video)!;

// On a phone the 380px panel would cover the player, so it starts collapsed there.
try {
  if (innerWidth < 760 && localStorage.getItem('bdry.collapsed') === null) localStorage.setItem('bdry.collapsed', 'true');
} catch {
  // storage blocked: the panel just starts open
}

void (async () => {
  await boot({ tabBvid: video.bvid, onOpenOptions: () => window.dispatchEvent(new Event('bdry-demo:options')) });
  document.title = `${video.built.video.title} · BilibiliDry 在线演示`;
  createRoot(document.getElementById('app')!).render(<VideoPage video={video} other={other} />);
  // The extension's real content script: mounts the panel in a Shadow DOM and finds the <video> above.
  await import('../../src/content/index');
})();

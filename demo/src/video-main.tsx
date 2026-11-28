import { createRoot } from 'react-dom/client';
import { boot } from './boot';
import './demo.css';
import { VideoPage } from './VideoPage';
import { DEMO_VIDEOS } from './videos';

const bvid = /\/video\/(BV[0-9A-Za-z]{10})/.exec(location.pathname)?.[1];
const video = DEMO_VIDEOS.find((v) => v.bvid === bvid) ?? DEMO_VIDEOS[0];
const other = DEMO_VIDEOS.find((v) => v !== video)!;

const root = createRoot(document.getElementById('app')!);

void (async () => {
  await boot({
    tabBvid: video.bvid,
    onOpenOptions: () => window.dispatchEvent(new Event('bdry-demo:options'))
  });
  document.title = `${video.built.video.title} · BilibiliDry 在线演示`;
  root.render(<VideoPage video={video} other={other} />);
  // The extension's real content script: finds the player, its progress bar and the right column.
  await import('../../src/content/index');
})();

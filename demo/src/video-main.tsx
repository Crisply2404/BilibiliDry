import { createRoot } from 'react-dom/client';
import { boot } from './boot';
import './demo.css';
import { VideoPage } from './VideoPage';
import { DEMO_VIDEOS } from './videos';

const bvid = /\/video\/(BV[0-9A-Za-z]{10})/.exec(location.pathname)?.[1];
const video = DEMO_VIDEOS.find((v) => v.bvid === bvid) ?? DEMO_VIDEOS[0];
const other = DEMO_VIDEOS.find((v) => v !== video)!;

let flash = 0;
const root = createRoot(document.getElementById('app')!);
const render = () => root.render(<VideoPage video={video} other={other} flash={flash} />);

void (async () => {
  await boot({
    tabBvid: video.bvid,
    onOpenOptions: () => window.dispatchEvent(new Event('bdry-demo:options')),
    // The player's "open side panel" button: the panel is already on the page, so point at it.
    onOpenSidePanel: () => {
      flash += 1;
      render();
      document.querySelector('.sidepanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  document.title = `${video.built.video.title} · BilibiliDry 在线演示`;
  render();
  // The extension's real content script: finds the player container and its progress bar.
  await import('../../src/content/index');
})();

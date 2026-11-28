import { createRoot, type Root } from 'react-dom/client';
import css from '../styles.css?inline';
import { findPlayer } from './page';
import { PlayerLayer } from './PlayerLayer';

/**
 * The in-player layer (skip button, auto-skip notice, side-panel entry) lives in a Shadow DOM
 * inside Bilibili's player container: Bilibili's CSS cannot restyle it, our Tailwind reset cannot
 * leak out, and it goes fullscreen with the player. The progress-bar strip is portalled into the
 * progress bar itself. Bilibili rebuilds the player on SPA navigation, so the host is re-attached
 * whenever it falls out of the current container.
 */
const host = document.createElement('div');
host.id = 'bilibilidry-host';
host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:80;';
const shadow = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = css;
const mount = document.createElement('div');
mount.style.cssText = 'position:absolute;inset:0;';
shadow.append(style, mount);
let root: Root | null = null;

function attach() {
  const player = findPlayer();
  if (!player) return;
  if (host.parentElement !== player) {
    if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
    player.appendChild(host);
  }
  if (!root) {
    root = createRoot(mount);
    root.render(<PlayerLayer />);
  }
}

attach();
setInterval(attach, 1500);

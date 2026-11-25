import { createRoot } from 'react-dom/client';
import css from '../styles.css?inline';
import { Overlay } from './Overlay';

/**
 * Mount inside a Shadow DOM so Bilibili's CSS cannot restyle the panel and
 * our Tailwind reset cannot leak into the page. The host follows the player
 * into fullscreen so the strip and panel stay visible there.
 */
function mount() {
  if (document.getElementById('bilibilidry-host')) return;
  const host = document.createElement('div');
  host.id = 'bilibilidry-host';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483600;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
  shadow.append(style, root);
  document.documentElement.appendChild(host);
  document.addEventListener('fullscreenchange', () => {
    (document.fullscreenElement ?? document.documentElement).appendChild(host);
  });
  createRoot(root).render(<Overlay />);
}

mount();

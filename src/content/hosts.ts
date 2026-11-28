import { useSyncExternalStore } from 'react';
import css from '../styles.css?inline';
import { columnBesidePlayer, findCardSlot, findPlayer, findProgressBar } from './page';

/**
 * Two Shadow DOM hosts, so Bilibili's CSS cannot restyle ours and our Tailwind reset cannot leak:
 *
 * - inside the player container: progress-bar strip, skip button, entry button, and the drawer used
 *   when the right column is gone. It goes fullscreen with the player.
 * - in the right column, above the danmaku list: the panel card.
 *
 * Bilibili is an SPA and rebuilds both the player and the right column, so the hosts are put back
 * whenever they fall out of the page.
 */
function shadowHost(id: string, hostCss: string, mountCss: string, stop: string[]) {
  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = hostCss;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const mount = document.createElement('div');
  mount.style.cssText = mountCss;
  shadow.append(style, mount);
  // Events leaving the shadow root are retargeted to the host, so Bilibili's shortcuts (space,
  // arrows, f, d…) would see a <div>, not our <textarea>, and fire while the user types. Our UI's
  // events stop here; React has already handled them inside.
  for (const type of stop) shadow.addEventListener(type, (e) => e.stopPropagation());
  return { host, mount };
}

const KEYS = ['keydown', 'keyup', 'keypress'];
export const playerHost = shadowHost('bilibilidry-host', 'position:absolute;inset:0;pointer-events:none;z-index:80;', 'position:absolute;inset:0;', [
  ...KEYS,
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'wheel',
  'contextmenu'
]);
// Bilibili sets `pointer-events: none` on the right column and turns it back on per module, so the
// card has to turn it on for itself or it can be seen but not clicked.
export const cardHost = shadowHost('bilibilidry-card', 'display:block;margin-bottom:12px;pointer-events:auto;', '', KEYS);

export interface HostState {
  /** The player container our layer is attached to. */
  player: HTMLElement | null;
  playerHeight: number;
  /** Space at the bottom of the player taken by the progress bar and controls; the drawer stops above it. */
  controlsHeight: number;
  /** The card host sits in the right column and that column is beside the player. */
  card: boolean;
}

let state: HostState = { player: null, playerHeight: 0, controlsHeight: 64, card: false };

/**
 * From the player's bottom edge to just above the progress bar (and our strip, 7px over it).
 * Bilibili fades the controls out but keeps their layout, so this does not jump while playing.
 */
function controlsHeight(player: HTMLElement | null): number {
  const bar = player && findProgressBar(player);
  if (!player || !bar) return 64;
  const p = player.getBoundingClientRect();
  const b = bar.getBoundingClientRect();
  if (!b.height || b.top < p.top || b.top > p.bottom) return 64;
  return Math.max(48, Math.round(p.bottom - b.top + 16));
}
const listeners = new Set<() => void>();
let observed: HTMLElement | null = null;
const resize = new ResizeObserver(() => refresh());

/**
 * Bilibili's video page is server-rendered Vue 2: `#app` carries `data-server-rendered` until the
 * client takes the markup over, and Vue removes the attribute when it is done. A node inserted
 * into the right column before that makes hydration fail (HierarchyRequestError inside Bilibili's
 * own script), which leaves the page half-wired: web fullscreen, for one, stops working. So
 * nothing is inserted until hydration is over, with a fallback for a page that never finishes.
 */
const startedAt = Date.now();
function hydrated(): boolean {
  return !document.querySelector('[data-server-rendered]') || Date.now() - startedAt > 20000;
}

function refresh() {
  if (!hydrated()) return;
  const player = findPlayer();
  if (player && playerHost.host.parentElement !== player) {
    if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
    player.appendChild(playerHost.host);
  }
  if (player !== observed) {
    if (observed) resize.unobserve(observed);
    if (player) resize.observe(player);
    observed = player;
  }
  const slot = findCardSlot();
  if (slot && (cardHost.host.parentElement !== slot.parent || cardHost.host.nextElementSibling !== slot.before) && slot.before !== cardHost.host) {
    slot.parent.insertBefore(cardHost.host, slot.before);
  }
  // The column is measured even while the card is hidden; the card's own height does not move it sideways.
  const card = Boolean(slot) && columnBesidePlayer(player, slot!.parent);
  cardHost.host.style.display = card ? 'block' : 'none';
  const next: HostState = { player, playerHeight: Math.round(player?.getBoundingClientRect().height ?? 0), controlsHeight: controlsHeight(player), card };
  if (next.player !== state.player || next.playerHeight !== state.playerHeight || next.controlsHeight !== state.controlsHeight || next.card !== state.card) {
    state = next;
    for (const l of listeners) l();
  }
}

export function startHosts(): void {
  refresh();
  setInterval(refresh, 1000);
  document.addEventListener('fullscreenchange', refresh);
}

export function useHosts(): HostState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state
  );
}

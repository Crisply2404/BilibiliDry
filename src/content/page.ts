/** Read the current video identity from the URL; Bilibili is an SPA, so this is polled. */
export function readLocation(href = location.href): { bvid: string; page: number } | null {
  const url = new URL(href);
  const m = url.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/);
  if (!m) return null;
  const p = Number(url.searchParams.get('p') ?? '1');
  return { bvid: m[1], page: Number.isFinite(p) && p > 0 ? Math.floor(p) : 1 };
}

/** The main player's <video>; ignores small preview/ad videos elsewhere on the page. */
export function findVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const v of Array.from(document.querySelectorAll('video'))) {
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) {
      best = v;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Bilibili's player container (it is what goes fullscreen) and its progress bar. Selectors are
 * the current "bpx" player's; when they stop matching, callers fall back to the <video>.
 */
export function findPlayer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.bpx-player-container') ?? document.querySelector<HTMLElement>('#bilibili-player') ?? findVideo()?.parentElement ?? null;
}

export function findProgressBar(container: ParentNode = document): HTMLElement | null {
  return (
    container.querySelector<HTMLElement>('.bpx-player-progress-schedule-wrap') ??
    container.querySelector<HTMLElement>('.bpx-player-progress-schedule') ??
    container.querySelector<HTMLElement>('.bpx-player-progress')
  );
}

/**
 * Where the panel card goes: in the right column, just above the danmaku list, which puts its top
 * level with the top of the player. Falls back to the top of the right column; null when the page
 * has no right column at all (the panel then lives in a drawer inside the player).
 */
export function findCardSlot(): { parent: Element; before: Element | null } | null {
  const above = document.querySelector('.right-container-inner > .video-pod-above-modules') ?? document.querySelector('#danmukuBox');
  if (above?.parentElement) return { parent: above.parentElement, before: above };
  const column = document.querySelector('.right-container-inner') ?? document.querySelector('.right-container');
  if (!column) return null;
  const up = column.querySelector(':scope > .up-panel-container');
  return { parent: column, before: up ? up.nextElementSibling : column.firstElementChild };
}

/**
 * Whether the right column is actually beside the player. Decided from the layout rather than the
 * player's `data-screen` attribute: in wide mode, web fullscreen and fullscreen the player covers
 * or pushes away the column, and on the real site `data-screen` was seen to say "web" while the
 * page still showed the normal layout.
 */
export function columnBesidePlayer(player: Element | null, column: Element | null): boolean {
  if (!player || !column || document.fullscreenElement) return false;
  const p = player.getBoundingClientRect();
  const c = column.getBoundingClientRect();
  return c.width > 0 && p.width > 0 && c.left >= p.right - 1 && c.top < p.bottom && c.bottom > p.top;
}

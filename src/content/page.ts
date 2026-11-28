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

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
  const candidates = Array.from(document.querySelectorAll('video'));
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const v of candidates) {
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) {
      best = v;
      bestArea = area;
    }
  }
  return best;
}

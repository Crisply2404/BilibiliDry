import type { PortIn, Push } from '../shared/protocol';

/**
 * Fan-out of background events to open UIs (overlay, dashboard, popup) over
 * long-lived ports. Each port subscribes to one video or to everything ("*").
 */
const subs = new Map<chrome.runtime.Port, Set<string>>();

export function attachEventsPort(port: chrome.runtime.Port): void {
  subs.set(port, new Set());
  port.onMessage.addListener((msg: PortIn) => {
    if (msg?.type === 'SUBSCRIBE') subs.get(port)?.add(msg.videoId);
  });
  port.onDisconnect.addListener(() => subs.delete(port));
}

export function publish(msg: Push, videoId?: string): void {
  for (const [port, topics] of subs) {
    if (topics.has('*') || (videoId && topics.has(videoId))) {
      try {
        port.postMessage(msg);
      } catch {
        subs.delete(port);
      }
    }
  }
}

/**
 * MV3 stops an idle service worker after ~30s even while a fetch is in
 * flight. Any extension API call resets that timer, so long analyses ping a
 * cheap API every 20s until they finish.
 */
let keepAliveCount = 0;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
export function holdKeepAlive(): () => void {
  keepAliveCount += 1;
  keepAliveTimer ??= setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    keepAliveCount -= 1;
    if (keepAliveCount <= 0 && keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      keepAliveCount = 0;
    }
  };
}

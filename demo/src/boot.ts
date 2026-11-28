import { saveSettings } from '../../src/shared/settings';
import { installChromeShim } from './chromeShim';
import { DEMO_MODEL_BASE, installFakeNetwork } from './fakeNetwork';

/** Absolute URL of the demo site root (works under GitHub Pages' /<repo>/ prefix). */
export const SITE_BASE = new URL(import.meta.env.BASE_URL, location.origin).href;

export function videoPageUrl(bvid: string, t?: number): string {
  return new URL(`video/${bvid}/${t !== undefined && Number.isFinite(t) ? `?t=${Math.floor(t)}` : ''}`, SITE_BASE).href;
}

/**
 * Start the extension's real background code inside this page: fake network
 * first, then the `chrome.*` shim, then demo settings pointing at the
 * scripted model, then the background module itself.
 */
export async function boot(opts: { tabBvid?: string; onOpenOptions: () => void }): Promise<void> {
  installFakeNetwork();
  const shim = installChromeShim({
    baseUrl: SITE_BASE,
    tabUrl: opts.tabBvid ? `https://www.bilibili.com/video/${opts.tabBvid}` : undefined,
    mapUrl: (url) => {
      const m = /bilibili\.com\/video\/(BV[0-9A-Za-z]{10})(?:\?(.*))?/.exec(url);
      if (m) {
        const t = new URLSearchParams(m[2] ?? '').get('t');
        return videoPageUrl(m[1], t ? Number(t) : undefined);
      }
      return url.startsWith(SITE_BASE) ? url : null;
    },
    onOpenOptions: opts.onOpenOptions
  });
  // The model settings are fixed to the scripted model; viewing preferences (auto-skip, strip) are kept.
  await saveSettings({ provider: 'custom', baseUrl: DEMO_MODEL_BASE, apiKey: 'demo', model: 'demo-flash', reasoning: 'off', embeddingModel: '', autoAnalyze: false, developerMode: true });
  await shim.loadBackground(() => import('../../src/background/index'));
}

/**
 * Just enough of the `chrome.*` extension API for the real background code
 * and the real UI to run together in one ordinary web page.
 *
 * Chrome keeps the service worker and the content script apart: a
 * `runtime.sendMessage` from the page reaches only background listeners, and
 * a `tabs.sendMessage` reaches only the page. The shim keeps that split by
 * tagging every listener with the side that registered it: listeners added
 * while the background module is being evaluated belong to the background,
 * everything added later belongs to the page.
 */

type Side = 'background' | 'page';
type Fn = (...args: any[]) => any;

let registering: Side = 'page';

class Ev<F extends Fn> {
  private listeners: Array<{ fn: F; side: Side }> = [];
  addListener(fn: F) {
    this.listeners.push({ fn, side: registering });
  }
  removeListener(fn: F) {
    this.listeners = this.listeners.filter((l) => l.fn !== fn);
  }
  hasListener(fn: F) {
    return this.listeners.some((l) => l.fn === fn);
  }
  of(side: Side): F[] {
    return this.listeners.filter((l) => l.side === side).map((l) => l.fn);
  }
  emit(...args: Parameters<F>) {
    for (const l of this.listeners.slice()) l.fn(...args);
  }
}

/** Messages cross a structured-clone boundary in Chrome; keep that, so nothing works here that would not work there. */
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

class DemoPort {
  peer!: DemoPort;
  connected = true;
  readonly onMessage = new Ev<(msg: unknown, port: DemoPort) => void>();
  readonly onDisconnect = new Ev<(port: DemoPort) => void>();
  constructor(readonly name: string) {}
  postMessage(msg: unknown) {
    if (!this.connected) throw new Error('Attempting to use a disconnected port object');
    const data = clone(msg);
    setTimeout(() => {
      if (this.peer.connected) this.peer.onMessage.emit(data, this.peer);
    }, 0);
  }
  disconnect() {
    if (!this.connected) return;
    this.connected = false;
    const peer = this.peer;
    if (peer.connected) {
      peer.connected = false;
      setTimeout(() => peer.onDisconnect.emit(peer), 0);
    }
  }
}

export interface ShimOptions {
  /** Absolute URL that `runtime.getURL('')` resolves to (the demo site root). */
  baseUrl: string;
  /** The Bilibili URL this page stands in for, so `tabs.query` can find "the video tab". */
  tabUrl?: string;
  /** Turn a URL the background wants to open into a demo URL (or null to ignore it). */
  mapUrl: (url: string) => string | null;
  onOpenOptions: () => void;
}

const STORAGE_PREFIX = 'bdry-demo:storage:';

function storageArea(onChanged: Ev<Fn>) {
  const read = (key: string) => {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  const keysOf = (q: unknown): string[] | null => {
    if (q === null || q === undefined) return null;
    if (typeof q === 'string') return [q];
    if (Array.isArray(q)) return q.map(String);
    return Object.keys(q as object);
  };
  const allKeys = () =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith(STORAGE_PREFIX))
      .map((k) => k.slice(STORAGE_PREFIX.length));
  return {
    async get(q?: unknown) {
      const out: Record<string, unknown> = typeof q === 'object' && q && !Array.isArray(q) ? { ...(q as object) } : {};
      for (const k of keysOf(q) ?? allKeys()) {
        const v = read(k);
        if (v !== undefined) out[k] = v;
      }
      return out;
    },
    async set(items: Record<string, unknown>) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: read(k), newValue: clone(v) };
        try {
          localStorage.setItem(STORAGE_PREFIX + k, JSON.stringify(v));
        } catch {
          // storage blocked (private mode): the change still reaches listeners for this page view
        }
      }
      onChanged.emit(changes, 'local');
    },
    async remove(q: string | string[]) {
      const changes: Record<string, { oldValue?: unknown }> = {};
      for (const k of keysOf(q) ?? []) {
        changes[k] = { oldValue: read(k) };
        localStorage.removeItem(STORAGE_PREFIX + k);
      }
      onChanged.emit(changes, 'local');
    },
    async clear() {
      for (const k of allKeys()) localStorage.removeItem(STORAGE_PREFIX + k);
    }
  };
}

export function clearDemoStorage(): void {
  for (const k of Object.keys(localStorage)) if (k.startsWith(STORAGE_PREFIX) || k.startsWith('bdry.')) localStorage.removeItem(k);
}

export function installChromeShim(opts: ShimOptions) {
  const onMessage = new Ev<(msg: any, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void>();
  const onConnect = new Ev<(port: DemoPort) => void>();
  const onChanged = new Ev<Fn>();
  const TAB_ID = 1;

  /** Deliver to listeners of one side and resolve with the first response, like Chrome does. */
  const deliver = (side: Side, msg: unknown, sender: unknown) =>
    new Promise((resolve) => {
      const listeners = onMessage.of(side);
      let pending = false;
      let answered = false;
      const sendResponse = (r: unknown) => {
        if (answered) return;
        answered = true;
        resolve(clone(r));
      };
      for (const fn of listeners) if (fn(clone(msg), sender, sendResponse) === true) pending = true;
      if (!pending && !answered) resolve(undefined);
    });

  const matches = (pattern: string, url: string) => (pattern.endsWith('*') ? url.startsWith(pattern.slice(0, -1)) : url === pattern);

  const openUrl = (url: string) => {
    const target = opts.mapUrl(url);
    if (!target) return;
    if (!window.open(target, '_blank')) location.assign(target);
  };

  const chromeShim = {
    runtime: {
      id: 'bilibilidry-demo',
      lastError: undefined,
      onMessage,
      onConnect,
      onInstalled: new Ev<Fn>(),
      sendMessage: (msg: unknown) => deliver('background', msg, { id: 'bilibilidry-demo', tab: { id: TAB_ID, url: opts.tabUrl } }),
      connect: ({ name }: { name: string }) => {
        const client = new DemoPort(name);
        const server = new DemoPort(name);
        client.peer = server;
        server.peer = client;
        queueMicrotask(() => {
          for (const fn of onConnect.of('background')) fn(server);
        });
        return client;
      },
      getURL: (path: string) => new URL(path.replace(/^\//, ''), opts.baseUrl).href,
      getPlatformInfo: async () => ({ os: 'web' }),
      openOptionsPage: async () => opts.onOpenOptions()
    },
    storage: { local: storageArea(onChanged), onChanged },
    tabs: {
      query: async (q: { url?: string }) => {
        if (!opts.tabUrl || (q.url && !matches(q.url, opts.tabUrl))) return [];
        return [{ id: TAB_ID, windowId: 1, url: opts.tabUrl, active: true }];
      },
      sendMessage: (_tabId: number, msg: unknown) => deliver('page', msg, { id: 'bilibilidry-demo' }),
      create: async ({ url }: { url: string }) => {
        openUrl(url);
        return { id: TAB_ID + 1 };
      },
      update: async () => ({ id: TAB_ID })
    },
    windows: { update: async () => ({}) },
    permissions: { contains: async () => true, request: async () => true }
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeShim;

  return {
    /** Evaluate the background module with its listeners tagged as background ones. */
    async loadBackground(load: () => Promise<unknown>) {
      registering = 'background';
      try {
        await load();
      } finally {
        registering = 'page';
      }
    }
  };
}

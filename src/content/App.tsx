import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Panel } from '../panel/Panel';
import { send, type TabCommand, type VideoBundle } from '../shared/protocol';
import { useSettings, useVideo } from '../ui/hooks';
import { cardHost, playerHost, useHosts } from './hosts';
import { findVideo } from './page';
import { PlayerLayer, useLocation, usePlayback } from './PlayerLayer';

const COLLAPSED_KEY = 'ui.cardCollapsed';

/**
 * One React tree for the whole page, so the player layer and the panel share the video state.
 * The panel is a card in the right column when that column is beside the player, and a drawer
 * inside the player when it is not (wide mode, web fullscreen, fullscreen).
 */
export function App() {
  const hosts = useHosts();
  const loc = useLocation();
  const { video, time, paused } = usePlayback();
  const [settings] = useSettings();
  const [videoId, setVideoId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const { bundle, setBundle, traces } = useVideo(videoId);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mode = hosts.card ? 'card' : 'drawer';

  useEffect(() => {
    void chrome.storage.local.get(COLLAPSED_KEY).then((r) => setCollapsed(Boolean(r[COLLAPSED_KEY])));
  }, []);
  const setCollapsedSaved = useCallback((v: boolean) => {
    setCollapsed(v);
    void chrome.storage.local.set({ [COLLAPSED_KEY]: v });
  }, []);

  useEffect(() => {
    setVideoId(null);
    setResolveError(null);
    if (!loc) return;
    send<VideoBundle>({ type: 'RESOLVE_VIDEO', bvid: loc.bvid, page: loc.page })
      .then((b) => {
        setVideoId(b.video?.videoId ?? null);
        setBundle(b);
      })
      .catch((err) => setResolveError(String((err as Error).message ?? err)));
  }, [loc?.bvid, loc?.page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving drawer mode (back to normal) closes the drawer; the card takes over.
  useEffect(() => {
    if (mode === 'card') setDrawerOpen(false);
  }, [mode]);

  const seek = useCallback((t: number) => {
    const v = findVideo();
    if (!v) return;
    v.currentTime = Math.max(0, t);
    if (v.paused) void v.play().catch(() => undefined);
  }, []);

  const seekAny = useCallback(
    (t: number, bvid?: string) => {
      if (bvid && loc && bvid !== loc.bvid) void send({ type: 'SEEK', bvid, page: 1, time: t });
      else seek(t);
    },
    [loc, seek]
  );

  /** The player's entry button: show the panel wherever it currently lives. */
  const reveal = useCallback(() => {
    if (mode === 'drawer') return setDrawerOpen((o) => !o);
    setCollapsedSaved(false);
    requestAnimationFrame(() => cardHost.host.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }, [mode, setCollapsedSaved]);

  /** The toolbar button: open or close it. */
  const toggle = useCallback(() => {
    if (mode === 'drawer') return setDrawerOpen((o) => !o);
    if (collapsed) reveal();
    else setCollapsedSaved(true);
  }, [mode, collapsed, reveal, setCollapsedSaved]);

  useEffect(() => {
    const on = (m: TabCommand, _s: unknown, reply: (r: unknown) => void) => {
      if (m?.type === 'SEEK_TO') seek(m.time);
      if (m?.type === 'TOGGLE_PANEL') {
        toggle();
        reply(true);
      }
    };
    chrome.runtime.onMessage.addListener(on);
    return () => chrome.runtime.onMessage.removeListener(on);
  }, [seek, toggle]);

  if (!loc) return null;
  const panel = (variant: 'card' | 'drawer') => (
    <Panel
      bvid={loc.bvid}
      videoId={videoId}
      bundle={bundle}
      setBundle={setBundle}
      traces={traces}
      settings={settings}
      resolveError={resolveError}
      time={time}
      onSeek={seekAny}
      variant={variant}
      height={hosts.playerHeight}
      collapsed={variant === 'card' && collapsed}
      onToggle={variant === 'card' ? () => setCollapsedSaved(!collapsed) : () => setDrawerOpen(false)}
    />
  );

  return (
    <>
      {hosts.player &&
        createPortal(
          <>
            <PlayerLayer bundle={bundle} settings={settings} video={video} time={time} paused={paused} seek={seek} drawerOpen={mode === 'drawer' && drawerOpen} onOpenPanel={reveal} />
            {mode === 'drawer' && drawerOpen && (
              <div
                data-bdry-drawer=""
                className="pointer-events-auto absolute right-0 top-0 w-[420px] max-w-[45%]"
                style={{ bottom: hosts.controlsHeight }}
                onKeyDown={(e) => e.key === 'Escape' && setDrawerOpen(false)}
              >
                {panel('drawer')}
              </div>
            )}
          </>,
          playerHost.mount
        )}
      {mode === 'card' && createPortal(panel('card'), cardHost.mount)}
    </>
  );
}

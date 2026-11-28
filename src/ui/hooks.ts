import { useCallback, useEffect, useRef, useState } from 'react';
import type { Trace } from '../core/trace/tracer';
import type { ChatEvent, ChatIn, ChatOut, ChatTurnRecord, Push, VideoBundle } from '../shared/protocol';
import { send } from '../shared/protocol';
import { onSettingsChanged, type Settings } from '../shared/settings';

/** Subscribe to background pushes for a video (or '*' for everything). Reconnects if the worker restarts. */
export function useEvents(topic: string | null, onPush: (p: Push) => void): void {
  const cb = useRef(onPush);
  cb.current = onPush;
  useEffect(() => {
    if (!topic) return;
    let port: chrome.runtime.Port | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      try {
        port = chrome.runtime.connect({ name: 'events' });
      } catch {
        return; // extension reloaded; this page is orphaned
      }
      port.onMessage.addListener((m: Push) => cb.current(m));
      port.onDisconnect.addListener(() => {
        port = null;
        if (!closed) retry = setTimeout(connect, 1000);
      });
      port.postMessage({ type: 'SUBSCRIBE', videoId: topic });
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      port?.disconnect();
    };
  }, [topic]);
}

export function useSettings(): [Settings | null, (patch: Partial<Settings>) => Promise<void>] {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    send<Settings>({ type: 'GET_SETTINGS' }).then(setSettings).catch(() => undefined);
    return onSettingsChanged(setSettings);
  }, []);
  const save = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await send<Settings>({ type: 'SAVE_SETTINGS', patch }));
  }, []);
  return [settings, save];
}

export function useVideo(videoId: string | null) {
  const [bundle, setBundle] = useState<VideoBundle | null>(null);
  const [traces, setTraces] = useState<Trace[]>([]);
  const reload = useCallback(async () => {
    if (!videoId) return;
    setBundle(await send<VideoBundle>({ type: 'GET_VIDEO', videoId }));
  }, [videoId]);
  useEffect(() => {
    setBundle(null);
    setTraces([]);
    void reload();
  }, [reload]);
  useEvents(videoId, (p) => {
    if (p.type === 'JOB' && p.job.videoId === videoId) setBundle((b) => (b ? { ...b, job: p.job } : b));
    if (p.type === 'VIDEO' && p.video.videoId === videoId) setBundle((b) => (b ? { ...b, video: p.video } : b));
    if (p.type === 'SEGMENTS' && p.videoId === videoId) {
      setBundle((b) => (b ? { ...b, segments: p.segments, ...(p.digest !== undefined ? { digest: p.digest } : {}) } : b));
      if (p.digest) void reload();
    }
    if (p.type === 'TRACE' && p.trace.videoId === videoId) setTraces((ts) => [p.trace, ...ts.filter((t) => t.id !== p.trace.id)]);
  });
  return { bundle, setBundle, reload, traces };
}

export interface LiveTurn {
  question: string;
  answer: string;
  tools: Array<{ id: string; name: string; args: Record<string, unknown>; summary?: string }>;
}

/** One chat thread: a videoId, or 'library' for questions across all videos. */
export function useChat(key: string | null) {
  const [turns, setTurns] = useState<ChatTurnRecord[]>([]);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    setTurns([]);
    if (!key) return;
    send<ChatTurnRecord[]>({ type: 'GET_CHAT', key }).then(setTurns).catch(() => undefined);
    return () => {
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, [key]);

  const onEvent = (e: ChatEvent) => {
    setLive((l) => {
      if (!l) return l;
      if (e.type === 'tool_call') return { ...l, answer: '', tools: [...l.tools, { id: e.id, name: e.name, args: e.args }] };
      if (e.type === 'tool_result') return { ...l, tools: l.tools.map((t) => (t.id === e.id ? { ...t, summary: e.summary } : t)) };
      if (e.type === 'delta') return { ...l, answer: l.answer + e.text };
      return l;
    });
  };

  const ask = useCallback(
    (question: string, currentTime?: number) => {
      if (!key || !question.trim()) return;
      setError(null);
      setLive({ question, answer: '', tools: [] });
      let port = portRef.current;
      if (!port) {
        port = chrome.runtime.connect({ name: 'chat' });
        port.onMessage.addListener((m: ChatOut) => {
          if (m.type === 'EVENT') onEvent(m.event);
          if (m.type === 'ERROR') setError(m.error);
          if (m.type === 'SAVED') {
            setTurns(m.turns);
            setLive(null);
          }
        });
        port.onDisconnect.addListener(() => {
          portRef.current = null;
          setLive(null);
        });
        portRef.current = port;
      }
      port.postMessage({ type: 'ASK', key, question, currentTime } satisfies ChatIn);
    },
    [key]
  );

  const stop = useCallback(() => {
    portRef.current?.disconnect();
    portRef.current = null;
    setLive(null);
  }, []);

  const clear = useCallback(async () => {
    if (!key) return;
    setTurns(await send<ChatTurnRecord[]>({ type: 'CLEAR_CHAT', key }));
  }, [key]);

  return { turns, live, error, ask, stop, clear };
}

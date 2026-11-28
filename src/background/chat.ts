import { askLibrary, type LibraryEnv } from '../core/qa/libraryAgent';
import { askVideo } from '../core/qa/videoQa';
import { Tracer, tracedClient } from '../core/trace/tracer';
import type { ChatIn, ChatOut, ChatTurnRecord } from '../shared/protocol';
import { loadSettings, type Settings } from '../shared/settings';
import { ensureCaptions } from './bilibili';
import { getCaptions, getChat, getSegments, getVideo, listVideos, putChat, putTrace } from './db';
import { holdKeepAlive } from './hub';
import { searchLibrary } from './library';
import { clientFor } from './llm';

function libraryEnv(settings: Settings): LibraryEnv {
  return {
    async listVideos() {
      return (await listVideos())
        .filter((v) => v.captionCount > 0)
        .map((v) => ({ videoId: v.videoId, bvid: v.bvid, title: v.title, durationSec: v.durationSec, tldr: v.tldr ?? v.official?.summary }));
    },
    async search(query, k) {
      return (await searchLibrary(query, k, settings)).map((h) => ({
        videoId: h.passage.videoId,
        bvid: h.bvid,
        title: h.videoTitle,
        fromLine: h.passage.fromLine,
        toLine: h.passage.toLine,
        start: h.passage.start,
        end: h.passage.end,
        text: h.passage.text,
        context: h.passage.context
      }));
    },
    async lines(bvid) {
      const v = (await listVideos()).find((x) => x.bvid === bvid);
      return v ? ((await getCaptions(v.videoId)) ?? undefined) : undefined;
    }
  };
}

/**
 * One "chat" port per open chat view. Closing the view disconnects the port, which aborts the
 * answer in flight so no tokens are spent on something nobody will read.
 */
export function attachChatPort(port: chrome.runtime.Port): void {
  let controller: AbortController | null = null;
  port.onDisconnect.addListener(() => controller?.abort());
  const post = (m: ChatOut) => {
    try {
      port.postMessage(m);
    } catch {
      controller?.abort();
    }
  };

  port.onMessage.addListener(async (msg: ChatIn) => {
    if (msg?.type !== 'ASK') return;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const release = holdKeepAlive();
    const turns = await getChat(msg.key);
    const userTurn: ChatTurnRecord = { role: 'user', content: msg.question, at: Date.now() };
    const tools: NonNullable<ChatTurnRecord['tools']> = [];
    const history = turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content }));
    try {
      const settings = await loadSettings();
      const isLibrary = msg.key === 'library';
      const video = isLibrary ? null : await getVideo(msg.key);
      const tracer = new Tracer({ kind: 'chat', videoId: video?.videoId ?? 'library', title: msg.question.slice(0, 60) });
      const llm = tracedClient(clientFor(settings), tracer);
      let answer: string;
      let citations: ChatTurnRecord['citations'];
      if (isLibrary) {
        const out = await askLibrary({
          llm,
          env: libraryEnv(settings),
          question: msg.question,
          history,
          tracer,
          signal,
          onEvent: (event) => {
            if (event.type === 'tool_call') tools.push({ name: event.name, summary: '…', args: event.args });
            if (event.type === 'tool_result') {
              const t = [...tools].reverse().find((x) => x.name === event.name && x.summary === '…');
              if (t) t.summary = event.summary;
            }
            post({ type: 'EVENT', event });
          }
        });
        answer = out.answer;
        citations = out.citations;
      } else {
        if (!video) throw new Error('还没有这个视频的记录，请刷新页面');
        const lines = await ensureCaptions(video);
        const out = await askVideo(
          { video, lines, segments: await getSegments(video.videoId), official: video.official, history, question: msg.question, currentTime: msg.currentTime },
          { llm },
          { signal, onDelta: (text) => post({ type: 'EVENT', event: { type: 'delta', text } }) }
        );
        answer = out.answer;
        citations = out.citations;
      }
      await putTrace(tracer.finish());
      const next = [...turns, userTurn, { role: 'assistant' as const, content: answer, at: Date.now(), citations, tools }];
      await putChat(msg.key, next);
      post({ type: 'SAVED', turns: next });
    } catch (err) {
      if (signal.aborted) return;
      const error = String((err as Error)?.message ?? err);
      const next = [...turns, userTurn, { role: 'assistant' as const, content: '', at: Date.now(), error, tools }];
      await putChat(msg.key, next);
      post({ type: 'ERROR', error });
      post({ type: 'SAVED', turns: next });
    } finally {
      release();
    }
  });
}

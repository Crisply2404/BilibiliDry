import { runAgent } from '../core/agent/agent';
import { Tracer, tracedClient } from '../core/trace/tracer';
import type { ChatIn, ChatOut, ChatTurnRecord } from '../shared/protocol';
import { loadSettings } from '../shared/settings';
import { getCaptions, getChat, getDigest, getSegments, getVideo, listVideos, putChat, putTrace } from './db';
import { holdKeepAlive } from './hub';
import { searchLibrary, searchVideo } from './library';
import { clientFor } from './llm';

/**
 * One "chat" port per open chat panel. Closing the panel disconnects the
 * port, which aborts the in-flight agent run so no tokens are spent on an
 * answer nobody will read.
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
    const turns = await getChat(msg.videoId);
    const userTurn: ChatTurnRecord = { role: 'user', content: msg.question, at: Date.now() };
    const tools: NonNullable<ChatTurnRecord['tools']> = [];
    try {
      const settings = await loadSettings();
      const video = await getVideo(msg.videoId);
      const lines = await getCaptions(msg.videoId);
      if (!video || !lines) throw new Error('这个视频还没有读取字幕：先点“分析”，或者至少等字幕读取完成');
      const tracer = new Tracer({ kind: 'chat', videoId: msg.videoId, title: msg.question.slice(0, 60) });
      const llm = tracedClient(clientFor(settings), tracer);
      const hasLibrary = (await listVideos()).length > 1;
      const final = await runAgent({
        llm,
        tracer,
        question: msg.question,
        history: turns.map((t) => ({ role: t.role, content: t.content })),
        signal,
        env: {
          video,
          lines,
          segments: await getSegments(msg.videoId),
          digest: await getDigest(msg.videoId),
          currentTime: msg.currentTime,
          searchVideo: (q, k) => searchVideo(msg.videoId, q, k, settings),
          ...(hasLibrary ? { searchLibrary: (q: string, k: number) => searchLibrary(q, k, settings, msg.videoId) } : {})
        },
        onEvent: (event) => {
          if (event.type === 'tool_call') tools.push({ name: event.name, summary: '…', args: event.args });
          if (event.type === 'tool_result') {
            const t = [...tools].reverse().find((x) => x.name === event.name && x.summary === '…');
            if (t) t.summary = event.summary;
          }
          post({ type: 'EVENT', event });
        }
      });
      await putTrace(tracer.finish());
      const next = [...turns, userTurn, { role: 'assistant' as const, content: final.answer, at: Date.now(), citations: final.citations, tools, mode: final.mode }];
      await putChat(msg.videoId, next);
      post({ type: 'SAVED', turns: next });
    } catch (err) {
      if (signal.aborted) return;
      const error = String((err as Error)?.message ?? err);
      const next = [...turns, userTurn, { role: 'assistant' as const, content: '', at: Date.now(), error, tools }];
      await putChat(msg.videoId, next);
      post({ type: 'ERROR', error });
      post({ type: 'SAVED', turns: next });
    } finally {
      release();
    }
  });
}

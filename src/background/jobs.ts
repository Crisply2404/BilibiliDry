import { runAnalysis } from '../core/analysis/pipeline';
import { Tracer, tracedClient } from '../core/trace/tracer';
import { cleanCaptions } from '../core/transcript/captions';
import type { Segment, VideoInfo } from '../core/types';
import type { JobState, VideoRecord } from '../shared/protocol';
import { loadSettings, type Settings } from '../shared/settings';
import { CaptionError, fetchCaptions, fetchVideoInfo } from './bilibili';
import { getCaptions, getJob, getSegments, getVideo, listJobs, putCaptions, putDigest, putJob, putSegments, putTrace, putVideo, type JobRecord } from './db';
import { holdKeepAlive, publish } from './hub';
import { ensureVectors, invalidate } from './library';
import { clientFor } from './llm';

const running = new Map<string, { controller: AbortController; promise: Promise<void> }>();

function configKey(s: Settings): string {
  return `${s.baseUrl}|${s.cheapModel || s.model}|${s.chunkSec}`;
}

function publicJob(j: JobRecord): JobState {
  const { done: _d, configKey: _c, ...rest } = j;
  return rest;
}

/** Throttled persistence: traces change on every span, but disk writes happen at most every 1.5s. */
function throttle(fn: () => void, ms: number): { call: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      fn();
    }
  };
}

export async function ensureVideo(bvid: string, page: number): Promise<VideoRecord> {
  const info = await fetchVideoInfo(bvid, page);
  const existing = await getVideo(info.videoId);
  const record: VideoRecord = { ...(existing ?? { addedAt: Date.now(), captionCount: 0 }), ...info };
  await putVideo(record);
  return record;
}

export function isRunning(videoId: string): boolean {
  return running.has(videoId);
}

export function cancelJob(videoId: string): boolean {
  const r = running.get(videoId);
  if (!r) return false;
  r.controller.abort();
  return true;
}

/** On service-worker start, any job left "running" was killed with the worker: mark it resumable. */
export async function recoverInterruptedJobs(): Promise<void> {
  for (const j of await listJobs()) {
    if (['queued', 'fetching', 'running'].includes(j.status)) {
      await putJob({ ...j, status: 'interrupted', message: '分析被中断，可以继续', updatedAt: Date.now() });
    }
  }
}

export async function startJob(params: { bvid: string; page: number; priorityTime?: number; fresh?: boolean }): Promise<JobState> {
  const settings = await loadSettings();
  clientFor(settings); // throws early with a readable message when not configured
  const video = await ensureVideo(params.bvid, params.page);
  const existing = running.get(video.videoId);
  if (existing) return publicJob((await getJob(video.videoId))!);

  const prev = await getJob(video.videoId);
  const key = configKey(settings);
  const canResume = !params.fresh && prev && prev.configKey === key && ['interrupted', 'partial', 'cancelled', 'failed'].includes(prev.status);
  const job: JobRecord = {
    videoId: video.videoId,
    status: 'fetching',
    phase: 'captions',
    chunksDone: canResume ? Object.keys(prev!.done).length : 0,
    chunksTotal: canResume ? prev!.chunksTotal : 0,
    failedChunks: [],
    message: '读取字幕',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    done: canResume ? prev!.done : {},
    configKey: key
  };
  await putJob(job);
  publish({ type: 'JOB', job: publicJob(job) }, video.videoId);

  const controller = new AbortController();
  const promise = runJob(video, job, settings, controller.signal, params.priorityTime).finally(() => running.delete(video.videoId));
  running.set(video.videoId, { controller, promise });
  return publicJob(job);
}

async function runJob(video: VideoInfo, job: JobRecord, settings: Settings, signal: AbortSignal, priorityTime?: number): Promise<void> {
  const release = holdKeepAlive();
  const update = async (patch: Partial<JobRecord>) => {
    Object.assign(job, patch, { updatedAt: Date.now() });
    await putJob(job);
    publish({ type: 'JOB', job: publicJob(job) }, video.videoId);
  };
  const tracer = new Tracer({ kind: 'analysis', videoId: video.videoId, title: video.title }, () => saveTrace.call());
  const saveTrace = throttle(() => {
    void putTrace(tracer.trace);
    publish({ type: 'TRACE', trace: tracer.trace }, video.videoId);
  }, 1500);

  try {
    let lines = await getCaptions(video.videoId);
    if (!lines) {
      const { raw, lang } = await tracer.run('captions', 'stage', () => fetchCaptions(video));
      lines = cleanCaptions(raw);
      await putCaptions(video.videoId, lines);
      const v = await getVideo(video.videoId);
      if (v) await putVideo({ ...v, captionCount: lines.length, captionLang: lang });
      invalidate(video.videoId);
    }
    await update({ status: 'running', phase: 'map', message: '开始分析' });

    const llm = tracedClient(clientFor(settings), tracer);
    // Re-analysing a video that already has results: keep showing the old ones until the new run
    // completes, instead of replacing a usable result with a half-finished one.
    const keepOld = Object.keys(job.done).length === 0 && (await getSegments(video.videoId)).length > 0;
    const doneChunks = new Map(Object.entries(job.done).map(([k, v]) => [Number(k), v] as const));
    const partial = () =>
      Object.values(job.done)
        .flat()
        .sort((a, b) => a.start - b.start);
    if (doneChunks.size > 0) publish({ type: 'SEGMENTS', videoId: video.videoId, segments: partial() }, video.videoId);

    const result = await runAnalysis(
      { video, lines, checkpoint: { doneChunks } },
      { llm, tracer, signal },
      {
        chunkSec: settings.chunkSec,
        concurrency: settings.concurrency,
        cheapModel: settings.cheapModel || settings.model,
        strongModel: settings.model,
        priorityTime
      },
      {
        onChunk: async (chunk, segs: Segment[]) => {
          job.done[chunk.index] = segs;
          await putJob(job);
          if (keepOld) return;
          const all = partial();
          await putSegments(video.videoId, all);
          publish({ type: 'SEGMENTS', videoId: video.videoId, segments: all }, video.videoId);
        },
        onProgress: (p) =>
          void update({
            phase: p.phase,
            chunksDone: p.chunksDone,
            chunksTotal: p.chunksTotal,
            failedChunks: p.failedChunks,
            message: p.message,
            error: p.lastError
          })
      }
    );

    if (result.segments.length === 0) {
      await update({ status: 'failed', message: '分析失败', error: result.lastError ?? '所有分块都失败了' });
      return;
    }
    await putSegments(video.videoId, result.segments);
    if (result.digest) await putDigest(video.videoId, result.digest);
    const v = await getVideo(video.videoId);
    if (v) {
      await putVideo({
        ...v,
        analyzedAt: Date.now(),
        segmentCount: result.segments.length,
        waterSec: result.segments.filter((s) => s.kind === 'water').reduce((a, s) => a + s.end - s.start, 0),
        tldr: result.digest?.tldr
      });
    }
    invalidate(video.videoId);
    publish({ type: 'SEGMENTS', videoId: video.videoId, segments: result.segments, digest: result.digest }, video.videoId);
    publish({ type: 'LIBRARY_CHANGED' });
    const failed = result.failedChunks.length;
    await update({
      status: failed ? 'partial' : 'done',
      phase: 'done',
      message: failed ? `完成，但有 ${failed} 段失败，可点“继续”重试` : '分析完成',
      error: failed ? result.lastError : undefined,
      chunksDone: result.chunks.length - failed,
      chunksTotal: result.chunks.length
    });

    if (settings.embeddingModel) {
      await tracer.run('embed-passages', 'stage', () => ensureVectors(video.videoId, settings)).catch(() => undefined);
      invalidate(video.videoId);
    }
  } catch (err) {
    if (signal.aborted) {
      await update({ status: 'cancelled', message: '已停止，可以继续' });
    } else {
      const message = String((err as Error)?.message ?? err);
      await update({ status: 'failed', message: err instanceof CaptionError ? '无法获取字幕' : '分析失败', error: message });
    }
  } finally {
    tracer.finish();
    saveTrace.flush();
    release();
  }
}

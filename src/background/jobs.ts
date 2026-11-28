import { analyzeVideo } from '../core/analysis/analyze';
import { Tracer, tracedClient } from '../core/trace/tracer';
import type { Segment } from '../core/types';
import type { JobState, VideoRecord } from '../shared/protocol';
import { loadSettings, type Settings } from '../shared/settings';
import { BilibiliError, ensureCaptions, ensureVideo } from './bilibili';
import { getJob, getSegments, getVideo, listJobs, putDigest, putJob, putSegments, putTrace, putVideo, type JobRecord } from './db';
import { holdKeepAlive, publish } from './hub';
import { ensureVectors, invalidate } from './library';
import { charBudget, clientFor } from './llm';

const running = new Map<string, AbortController>();

function publicJob(j: JobRecord): JobState {
  const { partial: _p, ...rest } = j;
  return rest;
}

/** Traces change on every span; persist at most every 1.5s. */
function throttle(fn: () => void, ms: number): { call: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call() {
      timer ??= setTimeout(() => {
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

export function cancelJob(videoId: string): boolean {
  const c = running.get(videoId);
  if (!c) return false;
  c.abort();
  return true;
}

/** On service-worker start, a job left "running" died with the previous worker: mark it resumable. */
export async function recoverInterruptedJobs(): Promise<void> {
  for (const j of await listJobs()) {
    if (['queued', 'fetching', 'running'].includes(j.status)) await putJob({ ...j, status: 'interrupted', message: '分析被中断，可以继续', updatedAt: Date.now() });
  }
}

export async function startJob(params: { bvid: string; page: number; fresh?: boolean }): Promise<JobState> {
  const settings = await loadSettings();
  clientFor(settings); // throws a readable message when no model is configured
  const video = await ensureVideo(params.bvid, params.page);
  if (running.has(video.videoId)) return publicJob((await getJob(video.videoId))!);

  const prev = await getJob(video.videoId);
  const resume = !params.fresh && prev && ['interrupted', 'cancelled', 'failed'].includes(prev.status) ? prev.partial : [];
  const job: JobRecord = {
    videoId: video.videoId,
    status: 'fetching',
    linesDone: resume.length ? resume[resume.length - 1].toLine + 1 : 0,
    linesTotal: video.captionCount,
    message: '读取字幕',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    partial: resume
  };
  await putJob(job);
  publish({ type: 'JOB', job: publicJob(job) }, video.videoId);
  const controller = new AbortController();
  running.set(video.videoId, controller);
  void runJob(video, job, settings, controller.signal).finally(() => running.delete(video.videoId));
  return publicJob(job);
}

async function runJob(video: VideoRecord, job: JobRecord, settings: Settings, signal: AbortSignal): Promise<void> {
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
    const lines = await tracer.run('captions', 'stage', () => ensureCaptions(video));
    const current = (await getVideo(video.videoId)) ?? video;
    await update({ status: 'running', linesTotal: lines.length, message: job.partial.length ? '从中断处继续分析' : '模型正在通读全片' });

    // Re-analysing a video that already has results keeps showing the old ones until the new run finishes.
    const keepOld = job.partial.length === 0 && (await getSegments(video.videoId)).length > 0;
    const result = await analyzeVideo(
      { video: current, lines, official: current.official, resumeFrom: job.partial },
      { llm: tracedClient(clientFor(settings), tracer) },
      { maxChars: charBudget(settings), signal },
      {
        onSegments: async (segments: Segment[]) => {
          job.partial = segments;
          await update({ linesDone: segments[segments.length - 1].toLine + 1, message: `已分析到 ${segments.length} 段` });
          if (keepOld) return;
          await putSegments(video.videoId, segments);
          publish({ type: 'SEGMENTS', videoId: video.videoId, segments }, video.videoId);
        }
      }
    );

    await putSegments(video.videoId, result.segments);
    await putDigest(video.videoId, result.digest);
    const latest = (await getVideo(video.videoId)) ?? current;
    await putVideo({
      ...latest,
      analyzedAt: Date.now(),
      segmentCount: result.segments.length,
      waterSec: result.segments.filter((s) => s.kind === 'water').reduce((a, s) => a + s.end - s.start, 0),
      tldr: result.digest.tldr || latest.official?.summary
    });
    invalidate(video.videoId);
    publish({ type: 'SEGMENTS', videoId: video.videoId, segments: result.segments, digest: result.digest }, video.videoId);
    publish({ type: 'LIBRARY_CHANGED' });
    await update({ status: 'done', partial: [], linesDone: lines.length, message: '分析完成', error: undefined });

    if (settings.embeddingModel) {
      await tracer.run('embed-passages', 'stage', () => ensureVectors(video.videoId, settings)).catch(() => undefined);
      invalidate(video.videoId);
    }
  } catch (err) {
    if (signal.aborted) {
      await update({ status: 'cancelled', message: '已停止，可以继续' });
    } else {
      const message = String((err as Error)?.message ?? err);
      await update({ status: 'failed', message: err instanceof BilibiliError ? '无法获取字幕' : '分析失败', error: message });
    }
  } finally {
    tracer.finish();
    saveTrace.flush();
    release();
  }
}

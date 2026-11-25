import type { LlmClient } from '../llm/types';
import type { Tracer } from '../trace/tracer';
import { chunkCaptions, type Chunk } from '../transcript/captions';
import type { CaptionLine, Segment, VideoDigest, VideoInfo } from '../types';
import { runPool } from '../util/pool';
import { scoreGrounding } from './grounding';
import { highlightBudget, selectHighlights } from './highlights';
import { analyzeChunk, buildDigest, refineSegment, verifySegment } from './steps';

export type AnalysisPhase = 'map' | 'digest' | 'verify' | 'refine' | 'done';

export interface AnalysisProgress {
  phase: AnalysisPhase;
  chunksDone: number;
  chunksTotal: number;
  failedChunks: number[];
  /** Last error message per failed chunk, so the UI can say *why* (bad key, unknown model...). */
  lastError?: string;
  message: string;
}

export interface AnalysisOptions {
  chunkSec?: number;
  concurrency?: number;
  /** Model for the many cheap per-chunk calls; defaults to the client's model. */
  cheapModel?: string;
  /** Model for digest/verify/refine; refine only runs when this differs from the cheap model. */
  strongModel?: string;
  /** Grounding below this triggers an LLM judge for highlight candidates. */
  verifyBelow?: number;
  /** Start analysing from the chunk containing this time, so what the viewer is watching comes first. */
  priorityTime?: number;
}

export interface AnalysisCheckpoint {
  /** Segments of chunks finished in an earlier, interrupted run. */
  doneChunks: Map<number, Segment[]>;
}

export interface AnalysisHooks {
  onChunk?: (chunk: Chunk, segments: Segment[]) => Promise<void> | void;
  onProgress?: (p: AnalysisProgress) => void;
  onSegmentsUpdated?: (segments: Segment[]) => Promise<void> | void;
}

export interface AnalysisResult {
  segments: Segment[];
  digest: VideoDigest | null;
  failedChunks: number[];
  lastError?: string;
  chunks: Chunk[];
}

export function orderChunks(chunks: Chunk[], priorityTime?: number): Chunk[] {
  if (priorityTime === undefined || !Number.isFinite(priorityTime)) return chunks;
  const pivot = chunks.findIndex((c) => c.end > priorityTime);
  if (pivot <= 0) return chunks;
  return [...chunks.slice(pivot), ...chunks.slice(0, pivot)];
}

/**
 * Map → reduce → select → verify → refine.
 *
 * - map: each chunk is segmented independently (parallel, checkpointed per
 *   chunk, starting at the playhead) so the heatmap fills in while the user
 *   watches and an interrupted run resumes instead of restarting.
 * - reduce: one call turns segment summaries into chapters and a TL;DR.
 * - select: highlights by importance × grounding with time diversity.
 * - verify: an LLM judge only for highlight candidates whose summaries are
 *   weakly grounded in the captions; unsupported ones are demoted and the
 *   selection is redone.
 * - refine: the strong model rewrites only the final highlights.
 *
 * A failed chunk does not fail the run: it is reported so the UI can offer a
 * retry, and the rest of the video is still usable.
 */
export async function runAnalysis(
  input: { video: VideoInfo; lines: CaptionLine[]; checkpoint?: AnalysisCheckpoint },
  deps: { llm: LlmClient; tracer: Tracer; signal?: AbortSignal },
  options: AnalysisOptions = {},
  hooks: AnalysisHooks = {}
): Promise<AnalysisResult> {
  const { video, lines } = input;
  const { llm, tracer, signal } = deps;
  const chunks = chunkCaptions(lines, options.chunkSec ?? 120);
  const done = new Map(input.checkpoint?.doneChunks ?? []);
  const failed: number[] = [];
  let lastError: string | undefined;
  const total = chunks.length;
  const progress = (phase: AnalysisPhase, message: string) =>
    hooks.onProgress?.({ phase, chunksDone: done.size, chunksTotal: total, failedChunks: failed.slice(), lastError, message });

  const pending = orderChunks(chunks, options.priorityTime).filter((c) => !done.has(c.index));
  progress('map', pending.length < total ? `继续分析，剩余 ${pending.length}/${total} 段` : `开始分析，共 ${total} 段`);

  await tracer.run(
    'map',
    'stage',
    async () => {
      await runPool(
        pending,
        options.concurrency ?? 3,
        async (chunk) => {
          if (signal?.aborted) return;
          try {
            const segs = await analyzeChunk({ llm, title: video.title, videoId: video.videoId, chunk, lines, model: options.cheapModel, signal });
            for (const s of segs) s.grounding = { lexical: scoreGrounding(s, lines) };
            done.set(chunk.index, segs);
            await hooks.onChunk?.(chunk, segs);
          } catch (err) {
            if (signal?.aborted) return;
            failed.push(chunk.index);
            lastError = String((err as Error)?.message ?? err).slice(0, 300);
          }
          progress('map', `已分析 ${done.size}/${total} 段`);
        },
        signal
      );
    },
    { chunks: pending.length }
  );
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  let segments = Array.from(done.values())
    .flat()
    .sort((a, b) => a.start - b.start);
  if (segments.length === 0) return { segments, digest: null, failedChunks: failed, lastError, chunks };

  const strongModel = options.strongModel || undefined;

  progress('digest', '生成章节与总结');
  let digestCore: Omit<VideoDigest, 'highlightIds'> | null = null;
  try {
    digestCore = await buildDigest({ llm, title: video.title, segments, durationSec: video.durationSec, model: strongModel, signal });
  } catch (err) {
    if (signal?.aborted) throw err;
  }

  // Verify only candidates that could become highlights and whose wording drifts from the captions.
  const threshold = options.verifyBelow ?? 0.55;
  const budget = highlightBudget(video.durationSec);
  const candidates = selectHighlights(segments, video.durationSec, budget * 2).filter((s) => (s.grounding?.lexical ?? 1) < threshold);
  if (candidates.length > 0) {
    progress('verify', `核对 ${candidates.length} 个重点片段的字幕证据`);
    await tracer.run('verify', 'stage', async () => {
      await runPool(
        candidates,
        options.concurrency ?? 3,
        async (seg) => {
          try {
            const v = await verifySegment({ llm, segment: seg, lines, model: strongModel, signal });
            seg.grounding = { ...(seg.grounding ?? { lexical: 0 }), verdict: v.verdict, reason: v.reason, evidence: v.evidence };
            if (v.verdict === 'unsupported') seg.importance = Math.min(seg.importance, 2);
          } catch (err) {
            if (signal?.aborted) throw err;
          }
        },
        signal
      );
    });
  }

  const highlights = selectHighlights(segments, video.durationSec, budget);

  const cheap = options.cheapModel ?? llm.model;
  if (strongModel && strongModel !== cheap && highlights.length > 0) {
    progress('refine', `用 ${strongModel} 精修 ${highlights.length} 个重点`);
    await tracer.run('refine', 'stage', async () => {
      await runPool(
        highlights,
        options.concurrency ?? 3,
        async (seg) => {
          try {
            const r = await refineSegment({ llm, segment: seg, lines, model: strongModel, signal });
            Object.assign(seg, r, { refined: true });
            seg.grounding = { ...(seg.grounding ?? { lexical: 0 }), lexical: scoreGrounding(seg, lines) };
          } catch (err) {
            if (signal?.aborted) throw err;
          }
        },
        signal
      );
    });
    // Selection is deliberately not redone here: refining only rewrites wording, and re-ranking
    // on the new text could drop the very highlights just paid to refine.
  }

  segments = segments.slice();
  await hooks.onSegmentsUpdated?.(segments);
  const digest: VideoDigest | null = digestCore
    ? { ...digestCore, highlightIds: highlights.map((h) => h.id) }
    : { tldr: '', takeaways: [], chapters: [], highlightIds: highlights.map((h) => h.id) };
  progress('done', failed.length ? `完成，${failed.length} 段失败可重试` : '分析完成');
  return { segments, digest, failedChunks: failed, lastError, chunks };
}

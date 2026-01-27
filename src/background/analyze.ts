import type { ContentType } from '../../types';
import { fetchSubtitleLines, fetchVideoView, SubtitleLoginRequiredError } from './bilibili';
import { getEmbedding, listSegments, putEmbedding, putSegments, upsertVideo, type SegmentRecord } from './db';
import { getConfig } from '../shared/storage';
import { getActiveLlm } from './llm';

function toId(videoId: string, startTime: number, endTime: number): string {
  const s = startTime.toFixed(3);
  const e = endTime.toFixed(3);
  return `${videoId}:${s}-${e}`;
}

function clamp(num: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num));
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildTranscript(lines: { from: number; to: number; content: string }[]): string {
  return lines
    .map((l) => `[${formatTime(l.from)}] ${l.content}`)
    .join('\n')
    .slice(0, 12000);
}

export interface AnalysisJob {
  cancel: () => void;
  done: Promise<void>;
}

export function startIncrementalAnalysis(params: {
  bvid: string;
  currentTimeSec?: number;
  tabId: number;
  push: (msg: any) => void;
}): AnalysisJob {
  const controller = new AbortController();

  const done = (async () => {
    const config = await getConfig();
    const llm = getActiveLlm(config);

    const view = await fetchVideoView(params.bvid);
    const videoId = view.bvid;

    let lines: Awaited<ReturnType<typeof fetchSubtitleLines>>;
    try {
      lines = await fetchSubtitleLines(view.aid, view.cid);
    } catch (err) {
      if (err instanceof SubtitleLoginRequiredError) throw err;
      throw err;
    }
    const hasCC = lines.length > 0;
    await upsertVideo({
      videoId,
      aid: view.aid,
      cid: view.cid,
      title: view.title,
      durationSec: view.durationSec,
      hasCC,
      lastAnalyzedAt: new Date().toISOString(),
      analysisVersion: 'v1'
    });

    if (!hasCC) {
      params.push({ type: 'ANALYSIS_ERROR', videoId, error: '该视频无可用 CC/字幕' });
      return;
    }

    const chunkSec = clamp(Number(config.analysis.chunkSec) || 90, 30, 300);
    const existing = await listSegments(videoId);
    const doneChunkIndexes = new Set<number>(
      existing.filter((s) => s.source === llm.source).map((s) => Math.floor(s.startTime / chunkSec))
    );
    const chunksMap = new Map<number, typeof lines>();
    for (const line of lines) {
      const idx = Math.floor(line.from / chunkSec);
      const list = chunksMap.get(idx) ?? [];
      list.push(line);
      chunksMap.set(idx, list);
    }
    const chunkIndexes = Array.from(chunksMap.keys()).sort((a, b) => a - b);
    if (chunkIndexes.length === 0) {
      params.push({ type: 'ANALYSIS_ERROR', videoId, error: '字幕解析为空' });
      return;
    }

    const currentIdx =
      typeof params.currentTimeSec === 'number' && Number.isFinite(params.currentTimeSec)
        ? Math.floor(params.currentTimeSec / chunkSec)
        : chunkIndexes[0];
    const ordered = [...chunkIndexes.filter((i) => i >= currentIdx), ...chunkIndexes.filter((i) => i < currentIdx)];

    const total = ordered.length;
    let completed = 0;
    const embeddingTasks: Promise<void>[] = [];

    for (const idx of ordered) {
      if (controller.signal.aborted) return;
      if (doneChunkIndexes.has(idx)) {
        completed += 1;
        params.push({ type: 'ANALYSIS_UPDATE', videoId, progress: completed / total });
        continue;
      }

      const chunkLines = (chunksMap.get(idx) ?? []).sort((a, b) => a.from - b.from);
      const chunkStartSec = idx * chunkSec;
      const chunkEndSec = Math.min(view.durationSec, (idx + 1) * chunkSec);
      const transcript = buildTranscript(chunkLines);

      const chunkResult = await llm.analyzeChunk({
        bvid: view.bvid,
        title: view.title,
        chunkStartSec,
        chunkEndSec,
        transcript,
        signal: controller.signal
      });

      const segs: SegmentRecord[] = chunkResult.segments.map((s) => {
        const startTime = clamp(s.startTime, 0, view.durationSec);
        const endTime = clamp(s.endTime, 0, view.durationSec);
        return {
          id: toId(videoId, startTime, endTime),
          videoId,
          startTime,
          endTime,
          type: s.type as ContentType,
          confidence: clamp(Number(s.confidence), 0, 1),
          summary: s.summary,
          source: llm.source
        };
      });

      await putSegments(segs);

      completed += 1;
      params.push({
        type: 'ANALYSIS_UPDATE',
        videoId,
        progress: completed / total,
        segments: segs.map((s) => ({
          id: s.id,
          startTime: s.startTime,
          endTime: s.endTime,
          type: s.type,
          confidence: s.confidence,
          summary: s.summary
        }))
      });

      // Fire-and-forget embedding generation for DRY segments (used by cross-video semantic search).
      for (const seg of segs) {
        if (seg.type !== 'DRY') continue;
        if (seg.summary.trim().length === 0) continue;
        embeddingTasks.push(
          (async () => {
            const existed = await getEmbedding(seg.id);
            if (existed) return;
            const vector = await llm.embedText({ text: seg.summary, signal: controller.signal });
            await putEmbedding({
              id: seg.id,
              videoId,
              startTime: seg.startTime,
              vector,
              text: seg.summary,
              model: llm.embeddingModelTag
            });
          })().catch(() => {})
        );
      }
    }

    await Promise.allSettled(embeddingTasks);
    params.push({ type: 'ANALYSIS_DONE', videoId });
  })().catch((err: any) => {
    const videoId = params.bvid;
    const message = String(err?.message ?? err);
    params.push({ type: 'ANALYSIS_ERROR', videoId, error: message });
  });

  return {
    cancel: () => controller.abort(),
    done
  };
}

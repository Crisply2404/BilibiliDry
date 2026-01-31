import { ContentType } from '../../types';
import { fetchSubtitleLines, fetchVideoView, SubtitleLoginRequiredError } from './bilibili';
import { listSegments, putSegments, upsertVideo, type SegmentRecord } from './db';
import { getConfig } from '../shared/storage';
import { getActiveLlm } from './llm';
import type { CaptionLine, VideoMeta } from '../shared/messages';

function toId(videoId: string, startTime: number, endTime: number): string {
  const s = startTime.toFixed(3);
  const e = endTime.toFixed(3);
  return `${videoId}:${s}-${e}`;
}

function clamp(num: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num));
}

function redactSecrets(text: string): string {
  return (
    text
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***REDACTED***')
      .replace(/sk-\.\.\.[A-Za-z0-9_-]{2,}/g, 'sk-***REDACTED***')
      .replace(/Bearer\s+[A-Za-z0-9._~-]{8,}/gi, 'Bearer ***REDACTED***')
  );
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

function buildEvidenceLines(params: {
  lines: Array<{ from: number; to: number; content: string }>;
  startTime: number;
  endTime: number;
  padSec: number;
  maxLines: number;
  maxChars: number;
}): string[] {
  const start = Math.max(0, params.startTime - params.padSec);
  const end = Math.max(start, params.endTime + params.padSec);
  const picked = params.lines
    .filter((l) => Number.isFinite(l.from) && Number.isFinite(l.to) && l.to >= start && l.from <= end)
    .sort((a, b) => a.from - b.from)
    .map((l) => `[${formatTime(l.from)}] ${String(l.content ?? '').trim()}`.trim())
    .filter((t) => t.length > 0);

  const out: string[] = [];
  let chars = 0;
  for (const line of picked) {
    if (out.length >= params.maxLines) break;
    if (chars + line.length > params.maxChars) break;
    out.push(line.length > 120 ? `${line.slice(0, 120)}…` : line);
    chars += line.length;
  }
  return out;
}

function adjustConfidence(confidence: number, verdict: 'pass' | 'weak' | 'fail'): number {
  if (verdict === 'pass') return confidence;
  if (verdict === 'weak') return clamp(confidence * 0.7, 0, 1);
  return clamp(confidence * 0.4, 0, 1);
}

export interface AnalysisJob {
  cancel: () => void;
  done: Promise<void>;
}

export function startIncrementalAnalysis(params: {
  videoId: string;
  bvid: string;
  currentTimeSec?: number;
  video?: VideoMeta;
  captions?: CaptionLine[];
  tabId: number;
  push: (msg: any) => void;
}): AnalysisJob {
  const controller = new AbortController();

  const done = (async () => {
    const config = await getConfig();
    const llm = getActiveLlm(config);

    const view = params.video ?? (await fetchVideoView(params.bvid));
    const videoId = params.videoId || params.video?.videoId || `${view.bvid}_${view.cid}`;
    const bvid = view.bvid;

    let lines: Awaited<ReturnType<typeof fetchSubtitleLines>>;
    try {
      lines = params.captions ?? (await fetchSubtitleLines(view.aid, view.cid));
    } catch (err) {
      if (err instanceof SubtitleLoginRequiredError) throw err;
      throw err;
    }
    const hasCC = lines.length > 0;
    await upsertVideo({
      videoId,
      bvid,
      aid: view.aid,
      cid: view.cid,
      page: params.video?.page,
      partTitle: params.video?.partTitle,
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
        bvid,
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
    }

    params.push({ type: 'ANALYSIS_DONE', videoId });

    // Reflection Gate (post-check): do NOT block showing results, but still run in this job
    // so cancellation works and we can push incremental verification updates.
    try {
      if (controller.signal.aborted) return;
      const all = await listSegments(videoId);
      const candidates = all
        .filter((s) => s.source === llm.source && s.type === ContentType.DRY)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 6);
      if (candidates.length === 0) return;

      const totalRef = candidates.length;
      let completedRef = 0;
      params.push({ type: 'REFLECTION_UPDATE', videoId, progress: 0, completed: 0, total: totalRef });

      const batchSize = 3;
      for (let i = 0; i < candidates.length; i += batchSize) {
        if (controller.signal.aborted) return;
        const batch = candidates.slice(i, i + batchSize);
        const reflectInput = batch.map((s) => ({
          id: s.id,
          startTime: s.startTime,
          endTime: s.endTime,
          summary: s.summary,
          evidence: buildEvidenceLines({
            lines,
            startTime: s.startTime,
            endTime: s.endTime,
            padSec: 10,
            maxLines: 40,
            maxChars: 2200
          })
        }));

        const resp = await llm.reflectSegments({ title: view.title, segments: reflectInput, signal: controller.signal });
        const byId = new Map(resp.items.map((x) => [x.id, x] as const));
        const evidenceById = new Map(reflectInput.map((x) => [x.id, x.evidence] as const));

        const updated: SegmentRecord[] = [];
        for (const seg of batch) {
          const item = byId.get(seg.id);
          if (!item) continue;
          const verdict =
            item.verdict === 'pass' || item.verdict === 'weak' || item.verdict === 'fail' ? item.verdict : 'weak';
          const originalEvidence = evidenceById.get(seg.id) ?? [];
          const evidence = (Array.isArray(item.evidenceIndexes) ? item.evidenceIndexes : [])
            .map((n) => Math.floor(Number(n)))
            .filter((n) => Number.isFinite(n) && n >= 1 && n <= originalEvidence.length)
            .filter((n, idx, arr) => arr.indexOf(n) === idx)
            .slice(0, 3)
            .map((n) => originalEvidence[n - 1])
            .filter(Boolean);
          const reason = String(item.reason ?? '').trim();
          if (!reason) continue;

          const next: SegmentRecord = {
            ...seg,
            confidence: adjustConfidence(seg.confidence, verdict),
            verification: {
              verdict,
              alignmentScore: clamp(Number(item.alignmentScore), 0, 1),
              reason: reason.length > 40 ? `${reason.slice(0, 40)}…` : reason,
              evidence: evidence.length > 0 ? evidence : originalEvidence.slice(0, 3),
              checkedAt: new Date().toISOString(),
              modelTag: llm.modelTag
            }
          };
          updated.push(next);
        }

        if (updated.length > 0) await putSegments(updated);

        completedRef += batch.length;
        params.push({
          type: 'REFLECTION_UPDATE',
          videoId,
          progress: clamp(completedRef / totalRef, 0, 1),
          completed: completedRef,
          total: totalRef,
          segments:
            updated.length > 0
              ? updated.map((s) => ({
                  id: s.id,
                  startTime: s.startTime,
                  endTime: s.endTime,
                  type: s.type,
                  confidence: s.confidence,
                  summary: s.summary,
                  verification: s.verification
                }))
              : undefined
        });
      }
    } catch {
      // Reflection is best-effort; never fail the main analysis.
    }
  })().catch((err: any) => {
    const videoId = params.videoId || params.bvid;
    const message = redactSecrets(String(err?.message ?? err));
    params.push({ type: 'ANALYSIS_ERROR', videoId, error: message });
  });

  return {
    cancel: () => controller.abort(),
    done
  };
}

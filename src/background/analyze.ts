import { ContentType } from '../../types';
import { fetchSubtitleLines, fetchVideoView, SubtitleLoginRequiredError } from './bilibili';
import { listSegments, putAnalysisRun, putSegments, upsertVideo, type AnalysisRunRecord, type SegmentRecord } from './db';
import { getConfig } from '../shared/storage';
import { getActiveLlm } from './llm';
import { refineDrySegmentsWithOpenAI } from './openai';
import type { CaptionLine, VideoMeta } from '../shared/messages';
import type { AnalysisRun, LlmCallMetric, LlmStage } from '../../types';

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
  perLineMaxChars?: number;
}): string[] {
  const start = Math.max(0, params.startTime - params.padSec);
  const end = Math.max(start, params.endTime + params.padSec);
  const perLineMax = Math.max(30, Math.floor(Number(params.perLineMaxChars ?? 120)));
  const pickedAll = params.lines
    .filter((l) => Number.isFinite(l.from) && Number.isFinite(l.to) && l.to >= start && l.from <= end)
    .sort((a, b) => a.from - b.from)
    .map((l) => `[${formatTime(l.from)}] ${String(l.content ?? '').trim()}`.trim())
    .filter((t) => t.length > 0);

  const picked =
    pickedAll.length > params.maxLines
      ? Array.from(
          new Set(
            Array.from({ length: Math.max(1, params.maxLines) }, (_, i) => {
              if (pickedAll.length === 1) return 0;
              const idx = Math.round((i * (pickedAll.length - 1)) / Math.max(1, params.maxLines - 1));
              return clamp(idx, 0, pickedAll.length - 1);
            })
          )
        )
          .sort((a, b) => a - b)
          .map((i) => pickedAll[i])
      : pickedAll;

  const out: string[] = [];
  let chars = 0;
  for (const line of picked) {
    if (out.length >= params.maxLines) break;
    const trimmed = line.length > perLineMax ? `${line.slice(0, perLineMax)}…` : line;
    if (chars + trimmed.length > params.maxChars) {
      const remain = params.maxChars - chars;
      if (remain > 24) out.push(`${trimmed.slice(0, Math.max(20, remain - 1))}…`);
      break;
    }
    out.push(trimmed);
    chars += trimmed.length;
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
    const baseLlm = getActiveLlm(config);

    const cascadeEnabled = baseLlm.source === 'openai' && Boolean(config.cascade?.enabled);
    const cheapModel = cascadeEnabled ? String(config.cascade?.cheapModel ?? '').trim() : '';
    const strongModel = cascadeEnabled ? String(config.cascade?.strongModel ?? '').trim() : '';
    const strongTopK = cascadeEnabled ? clamp(Number(config.cascade?.strongTopK ?? 6), 1, 8) : 0;

    const llmCheap = cascadeEnabled && cheapModel ? getActiveLlm({ ...config, openaiModel: cheapModel }) : baseLlm;
    const llmStrong = cascadeEnabled && strongModel ? getActiveLlm({ ...config, openaiModel: strongModel }) : baseLlm;

    const view = params.video ?? (await fetchVideoView(params.bvid));
    const videoId = params.videoId || params.video?.videoId || `${view.bvid}_${view.cid}`;
    const bvid = view.bvid;

    const runId =
      typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function'
        ? (crypto as any).randomUUID()
        : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const run: AnalysisRunRecord = {
      runId,
      videoId,
      startedAt: new Date().toISOString(),
      cascadeEnabled,
      provider: baseLlm.source,
      ...(cascadeEnabled
        ? {
            cheapModel: cheapModel || undefined,
            strongModel: strongModel || undefined,
            strongTopK
          }
        : {}),
      metrics: []
    } satisfies AnalysisRun;

    const recordMetric = async (metric: LlmCallMetric) => {
      run.metrics.push(metric);
      await putAnalysisRun(run);
    };

    const timed = async <T>(args: {
      stage: LlmStage;
      kind: string;
      modelTag: string;
      requestText: string;
      fn: () => Promise<T>;
    }): Promise<T> => {
      const startedAt = new Date().toISOString();
      const startedAtMs = Date.now();
      try {
        const out = await args.fn();
        const respText = (() => {
          try {
            return JSON.stringify(out);
          } catch {
            return '';
          }
        })();
        await recordMetric({
          stage: args.stage,
          kind: args.kind,
          modelTag: args.modelTag,
          startedAt,
          latencyMs: Math.max(0, Date.now() - startedAtMs),
          requestChars: args.requestText.length,
          responseChars: respText.length
        });
        return out;
      } catch (err: any) {
        await recordMetric({
          stage: args.stage,
          kind: `${args.kind}_error`,
          modelTag: args.modelTag,
          startedAt,
          latencyMs: Math.max(0, Date.now() - startedAtMs),
          requestChars: args.requestText.length,
          responseChars: 0,
          note: redactSecrets(String(err?.message ?? err)).slice(0, 160)
        });
        throw err;
      }
    };

    try {
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
        analysisVersion: 'v2'
      });

      if (!hasCC) {
        params.push({ type: 'ANALYSIS_ERROR', videoId, error: '该视频无可用 CC/字幕' });
        return;
      }

      const chunkSec = clamp(Number(config.analysis.chunkSec) || 90, 30, 300);
      const existing = await listSegments(videoId);
      const doneChunkIndexes = new Set<number>(
        existing.filter((s) => s.source === llmCheap.source).map((s) => Math.floor(s.startTime / chunkSec))
      );
      const existingByChunk = new Map<number, SegmentRecord[]>();
      for (const seg of existing) {
        if (seg.source !== llmCheap.source) continue;
        const idx = Math.floor(seg.startTime / chunkSec);
        const list = existingByChunk.get(idx) ?? [];
        list.push(seg);
        existingByChunk.set(idx, list);
      }
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
      const totalSteps = total + (cascadeEnabled ? 1 : 0);

      await putAnalysisRun(run);

      for (const idx of ordered) {
        if (controller.signal.aborted) return;
        if (doneChunkIndexes.has(idx)) {
          completed += 1;
          const segs = (existingByChunk.get(idx) ?? []).map((s) => ({
            id: s.id,
            startTime: s.startTime,
            endTime: s.endTime,
            type: s.type,
            confidence: s.confidence,
            summary: s.summary,
            waterReasonType: s.waterReasonType,
            waterReasonText: s.waterReasonText,
            verification: s.verification
          }));
          params.push({
            type: 'ANALYSIS_UPDATE',
            videoId,
            progress: clamp(completed / totalSteps, 0, 1),
            ...(segs.length > 0 ? { segments: segs } : {})
          });
          continue;
        }

      const chunkLines = (chunksMap.get(idx) ?? []).sort((a, b) => a.from - b.from);
      const chunkStartSec = idx * chunkSec;
      const chunkEndSec = Math.min(view.durationSec, (idx + 1) * chunkSec);
      const transcript = buildTranscript(chunkLines);

      const chunkStage: LlmStage = cascadeEnabled ? 'cheap' : 'strong';
      const chunkResult = await timed({
        stage: chunkStage,
        kind: 'chunk_analyze',
        modelTag: llmCheap.modelTag,
        requestText: transcript,
        fn: () =>
          llmCheap.analyzeChunk({
            bvid,
            title: view.title,
            chunkStartSec,
            chunkEndSec,
            transcript,
            signal: controller.signal
          })
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
          waterReasonType: s.waterReasonType,
          waterReasonText: s.waterReasonText,
          source: llmCheap.source
        };
      });

      await putSegments(segs);

        completed += 1;
        params.push({
          type: 'ANALYSIS_UPDATE',
          videoId,
          progress: clamp(completed / totalSteps, 0, 1),
          segments: segs.map((s) => ({
            id: s.id,
            startTime: s.startTime,
            endTime: s.endTime,
            type: s.type,
            confidence: s.confidence,
            summary: s.summary,
            waterReasonType: s.waterReasonType,
            waterReasonText: s.waterReasonText
          }))
        });
      }

      // Model Cascade (strong stage): refine TopK DRY summaries before we announce ANALYSIS_DONE,
      // so progress=100% matches what users see.
      if (cascadeEnabled && baseLlm.source === 'openai') {
        try {
          if (controller.signal.aborted) return;
          const baseUrl = String(config.openaiBaseUrl ?? '').trim();
          const apiKey = String(config.openaiApiKey ?? '').trim();
          const model = (strongModel || String(config.openaiModel ?? '').trim()).trim();
          if (baseUrl && apiKey && model) {
            const all = await listSegments(videoId);
            const candidates = all
              .filter((s) => s.source === llmCheap.source && s.type === ContentType.DRY)
              .sort((a, b) => b.confidence - a.confidence)
              .slice(0, strongTopK);

            if (candidates.length > 0) {
              const input = candidates.map((s) => ({
                id: s.id,
                startTime: s.startTime,
                endTime: s.endTime,
                summary: s.summary,
                evidence: buildEvidenceLines({
                  lines,
                  startTime: s.startTime,
                  endTime: s.endTime,
                  padSec: 10,
                  maxLines: 24,
                  maxChars: 1400,
                  perLineMaxChars: 100
                })
              }));

              const refineResp = await timed({
                stage: 'strong',
                kind: 'dry_refine',
                modelTag: llmStrong.modelTag,
                requestText: JSON.stringify(input),
                fn: () =>
                  refineDrySegmentsWithOpenAI({
                    baseUrl,
                    apiKey,
                    model,
                    title: view.title,
                    segments: input,
                    signal: controller.signal
                  })
              });

              const byId = new Map(refineResp.items.map((x) => [x.id, x.summary] as const));
              const updated: SegmentRecord[] = [];
              for (const seg of candidates) {
                const nextSummary = byId.get(seg.id);
                if (!nextSummary || nextSummary === seg.summary) continue;
                updated.push({ ...seg, summary: nextSummary });
              }
              if (updated.length > 0) {
                await putSegments(updated);
                params.push({
                  type: 'ANALYSIS_UPDATE',
                  videoId,
                  progress: 1,
                  segments: updated.map((s) => ({
                    id: s.id,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    type: s.type,
                    confidence: s.confidence,
                    summary: s.summary,
                    waterReasonType: s.waterReasonType,
                    waterReasonText: s.waterReasonText
                  }))
                });
              }
            }
          }
        } catch {
          // best-effort: refine stage should never block the main result
        }
      }

      params.push({ type: 'ANALYSIS_DONE', videoId });

    // Reflection Gate (post-check): do NOT block showing results, but still run in this job
    // so cancellation works and we can push incremental verification updates.
    try {
      if (controller.signal.aborted) return;
      const all = await listSegments(videoId);
      const candidates = all
        .filter((s) => s.source === baseLlm.source && s.type === ContentType.DRY)
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
        const baseConfidenceById = new Map(batch.map((s) => [s.id, s.confidence] as const));

        const verifyInput = batch.map((s) => ({
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

        const pickEvidence = (originalEvidence: string[], evidenceIndexes: unknown): string[] => {
          const picked = (Array.isArray(evidenceIndexes) ? evidenceIndexes : [])
            .map((n) => Math.floor(Number(n)))
            .filter((n) => Number.isFinite(n) && n >= 1 && n <= originalEvidence.length)
            .filter((n, idx, arr) => arr.indexOf(n) === idx)
            .slice(0, 3)
            .map((n) => originalEvidence[n - 1])
            .filter(Boolean);
          return picked.length > 0 ? picked : originalEvidence.slice(0, 3);
        };

        const reflectionLlm = cascadeEnabled ? llmStrong : baseLlm;
        const verifyResp = await timed({
          stage: 'strong',
          kind: 'verify',
          modelTag: reflectionLlm.modelTag,
          requestText: JSON.stringify(verifyInput),
          fn: () => reflectionLlm.verifySegments({ title: view.title, segments: verifyInput, signal: controller.signal })
        });
        const verifyById = new Map(verifyResp.items.map((x) => [x.id, x] as const));
        const verifyEvidenceById = new Map(verifyInput.map((x) => [x.id, x.evidence] as const));

        const updated: SegmentRecord[] = [];
        const toRepair: SegmentRecord[] = [];
        for (const seg of batch) {
          const item = verifyById.get(seg.id);
          if (!item) continue;
          const verdict =
            item.verdict === 'pass' || item.verdict === 'weak' || item.verdict === 'fail' ? item.verdict : 'weak';
          const originalEvidence = verifyEvidenceById.get(seg.id) ?? [];
          const evidence = pickEvidence(originalEvidence, item.evidenceIndexes);
          const reason = String(item.reason ?? '').trim();
          if (!reason) continue;

          const baseConfidence = baseConfidenceById.get(seg.id) ?? seg.confidence;
          const next: SegmentRecord = {
            ...seg,
            confidence: adjustConfidence(baseConfidence, verdict),
            verification: {
              verdict,
              alignmentScore: clamp(Number(item.alignmentScore), 0, 1),
              reason: reason.length > 40 ? `${reason.slice(0, 40)}…` : reason,
              evidence,
              checkedAt: new Date().toISOString(),
              modelTag: reflectionLlm.modelTag
            }
          };
          updated.push(next);
          if (verdict === 'fail') toRepair.push(next);
        }

        // Stage 1: store verification result immediately so UI has something to show.
        if (updated.length > 0) await putSegments(updated);

        // Stage 2 (repair): only for failed segments, in a larger evidence window.
        const repaired: SegmentRecord[] = [];
        if (toRepair.length > 0) {
          const repairPadSec = 90;
          const repairInput = toRepair.map((s) => {
            const windowStartTime = clamp(s.startTime - repairPadSec, 0, view.durationSec);
            const windowEndTime = clamp(s.endTime + repairPadSec, 0, view.durationSec);
            return {
              id: s.id,
              startTime: s.startTime,
              endTime: s.endTime,
              summary: s.summary,
              windowStartTime,
              windowEndTime,
              evidence: buildEvidenceLines({
                lines,
                startTime: s.startTime,
                endTime: s.endTime,
                padSec: repairPadSec,
                maxLines: 28,
                maxChars: 2400,
                perLineMaxChars: 80
              })
            };
          });

          const repairResp = await timed({
            stage: 'strong',
            kind: 'repair',
            modelTag: reflectionLlm.modelTag,
            requestText: JSON.stringify(repairInput),
            fn: () => reflectionLlm.repairSegments({ title: view.title, segments: repairInput, signal: controller.signal })
          });
          const repairById = new Map(repairResp.items.map((x) => [x.id, x] as const));
          const repairEvidenceById = new Map(repairInput.map((x) => [x.id, x.evidence] as const));
          const windowById = new Map(repairInput.map((x) => [x.id, { windowStartTime: x.windowStartTime, windowEndTime: x.windowEndTime }] as const));

          for (const seg of toRepair) {
            const item = repairById.get(seg.id);
            if (!item) continue;
            const verdict =
              item.verdict === 'pass' || item.verdict === 'weak' || item.verdict === 'fail' ? item.verdict : 'weak';
            const originalEvidence = repairEvidenceById.get(seg.id) ?? [];
            const evidence = pickEvidence(originalEvidence, item.evidenceIndexes);
            const reason = String(item.reason ?? '').trim();
            if (!reason) continue;

            const baseConfidence = baseConfidenceById.get(seg.id) ?? seg.confidence;
            const win = windowById.get(seg.id);
            const ws = win ? win.windowStartTime : 0;
            const we = win ? win.windowEndTime : view.durationSec;

            const suggestedStartTime = Number(item.suggestedStartTime);
            const suggestedEndTime = Number(item.suggestedEndTime);

            const canApplyRepair =
              verdict !== 'fail' &&
              Number.isFinite(suggestedStartTime) &&
              Number.isFinite(suggestedEndTime) &&
              suggestedEndTime > suggestedStartTime;

            const nextStart = canApplyRepair ? clamp(suggestedStartTime, ws, we) : seg.startTime;
            const nextEnd = canApplyRepair ? clamp(suggestedEndTime, ws, we) : seg.endTime;

            if (canApplyRepair && nextEnd <= nextStart) continue;

            const next: SegmentRecord = {
              ...seg,
              startTime: nextStart,
              endTime: nextEnd,
              confidence: adjustConfidence(baseConfidence, verdict),
              verification: {
                verdict,
                alignmentScore: clamp(Number(item.alignmentScore), 0, 1),
                reason: reason.length > 40 ? `${reason.slice(0, 40)}…` : reason,
                evidence,
                checkedAt: new Date().toISOString(),
                modelTag: reflectionLlm.modelTag,
                ...(canApplyRepair
                  ? {
                      repairedFrom: { startTime: seg.startTime, endTime: seg.endTime },
                      repairedAt: new Date().toISOString()
                    }
                  : {})
              }
            };
            repaired.push(next);
          }
        }

        if (repaired.length > 0) await putSegments(repaired);

        completedRef += batch.length;
        const mergedById = new Map(updated.map((s) => [s.id, s] as const));
        for (const s of repaired) mergedById.set(s.id, s);
        const merged = Array.from(mergedById.values());
        params.push({
          type: 'REFLECTION_UPDATE',
          videoId,
          progress: clamp(completedRef / totalRef, 0, 1),
          completed: completedRef,
          total: totalRef,
          segments:
            merged.length > 0
              ? merged.map((s) => ({
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
    } finally {
      run.finishedAt = new Date().toISOString();
      await putAnalysisRun(run).catch(() => {});
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

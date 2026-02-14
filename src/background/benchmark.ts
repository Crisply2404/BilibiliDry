import { ContentType } from '../../types';
import { fetchSubtitleLines } from './bilibili';
import { putAnalysisRun, type AnalysisRunRecord, type VideoRecord } from './db';
import { getConfig } from '../shared/storage';
import { getActiveLlm } from './llm';
import { refineDrySegmentsWithOpenAI } from './openai';
import type { LlmCallMetric, LlmStage } from '../../types';

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
    if (chars + line.length > params.maxChars) break;
    out.push(line);
    chars += line.length;
  }
  return out;
}

function adjustConfidence(confidence: number, verdict: 'pass' | 'weak' | 'fail'): number {
  if (verdict === 'pass') return confidence;
  if (verdict === 'weak') return clamp(confidence * 0.7, 0, 1);
  return clamp(confidence * 0.4, 0, 1);
}

export type BenchmarkMode = 'cascade' | 'strong_only';

export async function runModelCascadeBenchmark(params: {
  video: VideoRecord;
  mode: BenchmarkMode;
  emit: (msg: any) => void;
  signal?: AbortSignal;
}): Promise<{ runId: string }> {
  const config = await getConfig();
  if (config.llmProvider !== 'openai') throw new Error('当前仅支持 OpenAI-compatible 的 Model Cascade 对比');

  const durationSec = Math.max(0, Number(params.video.durationSec) || 0);
  if (!durationSec) throw new Error('视频时长缺失，无法跑对比');

  const strongModel =
    (typeof config.cascade?.strongModel === 'string' && config.cascade.strongModel.trim()) || String(config.openaiModel ?? '').trim();
  if (!strongModel) throw new Error('未配置 strong model');

  const cascadeEnabled = params.mode === 'cascade';
  const cheapModel = cascadeEnabled ? String(config.cascade?.cheapModel ?? '').trim() : '';
  const strongTopK = clamp(Number(config.cascade?.strongTopK ?? 6), 1, 8);
  if (cascadeEnabled && !cheapModel) throw new Error('未配置 cheap model（无法跑 cheap+strong 对照组）');

  const baseUrl = String(config.openaiBaseUrl ?? '').trim();
  const apiKey = String(config.openaiApiKey ?? '').trim();
  if (!baseUrl) throw new Error('未配置 OpenAI Base URL');
  if (!apiKey) throw new Error('未配置 OpenAI API Key');

  const strongConfig = {
    ...config,
    llmProvider: 'openai' as const,
    openaiModel: strongModel,
    cascade: { ...(config.cascade ?? {}), enabled: false }
  };

  const baseLlm = getActiveLlm(strongConfig);
  const llmStrong = baseLlm;
  const llmCheap = cascadeEnabled
    ? getActiveLlm({ ...strongConfig, openaiModel: cheapModel })
    : baseLlm;

  const bvid = params.video.bvid;
  const videoId = params.video.videoId;

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
      : {
          strongModel: strongModel || undefined
        }),
    metrics: []
  };

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

  const lines = await fetchSubtitleLines(params.video.aid, params.video.cid);
  if (lines.length === 0) throw new Error('字幕为空，无法跑对比');

  const chunkSec = clamp(Number(config.analysis.chunkSec) || 90, 30, 300);
  const chunksMap = new Map<number, typeof lines>();
  for (const line of lines) {
    const idx = Math.floor(line.from / chunkSec);
    const list = chunksMap.get(idx) ?? [];
    list.push(line);
    chunksMap.set(idx, list);
  }
  const chunkIndexes = Array.from(chunksMap.keys()).sort((a, b) => a - b);
  if (chunkIndexes.length === 0) throw new Error('字幕分块为空，无法跑对比');

  const totalSteps = chunkIndexes.length + (cascadeEnabled ? 1 : 0) + 2; // +verify +repair(best-effort)
  let completed = 0;

  const segmentsOut: Array<{
    id: string;
    startTime: number;
    endTime: number;
    type: ContentType;
    confidence: number;
    summary: string;
  }> = [];

  await putAnalysisRun(run);
  params.emit({
    type: 'BENCHMARK_UPDATE',
    videoId,
    runId,
    mode: params.mode,
    progress: 0,
    message: '开始跑对照组…'
  });

  for (const idx of chunkIndexes) {
    if (params.signal?.aborted) throw new Error('已取消');
    params.emit({
      type: 'BENCHMARK_UPDATE',
      videoId,
      runId,
      mode: params.mode,
      progress: clamp(completed / totalSteps, 0, 1),
      message: `正在请求模型分析字幕块…（${completed + 1}/${chunkIndexes.length}）`
    });
    const chunkLines = (chunksMap.get(idx) ?? []).sort((a, b) => a.from - b.from);
    const chunkStartSec = idx * chunkSec;
    const chunkEndSec = Math.min(durationSec, (idx + 1) * chunkSec);
    const transcript = buildTranscript(chunkLines);

    const stage: LlmStage = cascadeEnabled ? 'cheap' : 'strong';
    const llm = cascadeEnabled ? llmCheap : baseLlm;
    const chunkResult = await timed({
      stage,
      kind: 'chunk_analyze',
      modelTag: llm.modelTag,
      requestText: transcript,
      fn: () =>
        llm.analyzeChunk({
          bvid,
          title: params.video.title,
          chunkStartSec,
          chunkEndSec,
          transcript,
          signal: params.signal
        })
    });

    for (const s of chunkResult.segments) {
      const startTime = clamp(Number(s.startTime), 0, durationSec);
      const endTime = clamp(Number(s.endTime), 0, durationSec);
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) continue;
      const summary = String((s as any).summary ?? '').trim();
      if (!summary) continue;
      segmentsOut.push({
        id: `${runId}:${startTime.toFixed(3)}-${endTime.toFixed(3)}`,
        startTime,
        endTime,
        type: (s.type as ContentType) ?? ContentType.DRY,
        confidence: clamp(Number((s as any).confidence) || 0, 0, 1),
        summary
      });
    }

    completed += 1;
    params.emit({
      type: 'BENCHMARK_UPDATE',
      videoId,
      runId,
      mode: params.mode,
      progress: clamp(completed / totalSteps, 0, 1),
      message: `分块分析中…（${completed}/${chunkIndexes.length}）`
    });
  }

  // Cascade strong refine (best-effort, do not fail benchmark).
  if (cascadeEnabled) {
    try {
      const candidates = segmentsOut
        .filter((s) => s.type === ContentType.DRY)
        .slice()
        .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0))
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
            maxChars: 1400
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
              model: strongModel,
              title: params.video.title,
              segments: input,
              signal: params.signal
            })
        });

        const byId = new Map(refineResp.items.map((x) => [x.id, x.summary] as const));
        for (const s of segmentsOut) {
          const next = byId.get(s.id);
          if (typeof next === 'string' && next.trim()) s.summary = next.trim();
        }
      }
    } catch {
      // ignore
    } finally {
      completed += 1;
      params.emit({
        type: 'BENCHMARK_UPDATE',
        videoId,
        runId,
        mode: params.mode,
        progress: clamp(completed / totalSteps, 0, 1),
        message: '强模型精炼中…'
      });
    }
  }

  // Reflection Gate quality (best-effort)
  try {
    const candidates = segmentsOut
      .filter((s) => s.type === ContentType.DRY)
      .slice()
      .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0))
      .slice(0, 6);
    if (candidates.length > 0) {
      const verifyInput = candidates.map((s) => ({
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

      const verifyResp = await timed({
        stage: 'strong',
        kind: 'verify',
        modelTag: llmStrong.modelTag,
        requestText: JSON.stringify(verifyInput),
        fn: () => llmStrong.verifySegments({ title: params.video.title, segments: verifyInput, signal: params.signal })
      });
      completed += 1;
      params.emit({
        type: 'BENCHMARK_UPDATE',
        videoId,
        runId,
        mode: params.mode,
        progress: clamp(completed / totalSteps, 0, 1),
        message: '关键干货校验中…'
      });

      const verifyById = new Map(verifyResp.items.map((x) => [x.id, x] as const));
      const failed = candidates.filter((s) => (verifyById.get(s.id)?.verdict ?? 'weak') === 'fail');

      let pass = 0;
      let weak = 0;
      let fail = 0;
      let repaired = 0;
      let sum = 0;

      // Optional repair for fails.
      let repairedById = new Map<string, any>();
      if (failed.length > 0) {
        const repairPadSec = 90;
        const repairInput = failed.map((s) => {
          const windowStartTime = clamp(s.startTime - repairPadSec, 0, durationSec);
          const windowEndTime = clamp(s.endTime + repairPadSec, 0, durationSec);
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
              maxLines: 40,
              maxChars: 2600
            })
          };
        });

        const repairResp = await timed({
          stage: 'strong',
          kind: 'repair',
          modelTag: llmStrong.modelTag,
          requestText: JSON.stringify(repairInput),
          fn: () => llmStrong.repairSegments({ title: params.video.title, segments: repairInput, signal: params.signal })
        });
        repairedById = new Map(repairResp.items.map((x) => [x.id, x] as const));
        completed += 1;
        params.emit({
          type: 'BENCHMARK_UPDATE',
          videoId,
          runId,
          mode: params.mode,
          progress: clamp(completed / totalSteps, 0, 1),
          message: '失败项修正中…'
        });
      } else {
        completed += 1;
      }

      for (const s of candidates) {
        const base = verifyById.get(s.id);
        const patched = repairedById.get(s.id);
        const verdict = (patched?.verdict ?? base?.verdict ?? 'weak') as 'pass' | 'weak' | 'fail';
        const score = clamp(Number(patched?.alignmentScore ?? base?.alignmentScore ?? 0), 0, 1);
        sum += score;
        if (verdict === 'pass') pass += 1;
        else if (verdict === 'weak') weak += 1;
        else fail += 1;
        if (patched && verdict !== 'fail') repaired += 1;
        s.confidence = adjustConfidence(s.confidence, verdict);
      }

      run.quality = {
        total: candidates.length,
        pass,
        weak,
        fail,
        avgScore: candidates.length > 0 ? sum / candidates.length : 0,
        repaired
      };
    }
  } catch {
    // ignore
  }

  run.finishedAt = new Date().toISOString();
  await putAnalysisRun(run);

  params.emit({
    type: 'BENCHMARK_DONE',
    videoId,
    runId,
    mode: params.mode,
    message: '对照组完成'
  });

  return { runId };
}

import type { CaptionLine, Passage } from '../types';

export interface RawCaption {
  from: number;
  to: number;
  content: string;
}

/**
 * Normalise Bilibili subtitle JSON into indexed lines: drop empty/duplicate
 * lines (auto-generated subtitles often repeat a line verbatim across two
 * cues) and fix overlapping or inverted timestamps.
 */
export function cleanCaptions(raw: RawCaption[]): CaptionLine[] {
  const sorted = raw
    .map((r) => ({ from: Number(r.from), to: Number(r.to), text: String(r.content ?? '').replace(/\s+/g, ' ').trim() }))
    .filter((r) => r.text.length > 0 && Number.isFinite(r.from) && Number.isFinite(r.to))
    .sort((a, b) => a.from - b.from);

  const out: CaptionLine[] = [];
  for (const line of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.text === line.text && line.from - prev.to < 1.5) {
      prev.to = Math.max(prev.to, line.to);
      continue;
    }
    const from = Math.max(line.from, prev ? prev.from : 0);
    const to = Math.max(from + 0.2, line.to);
    out.push({ idx: out.length, from, to, text: line.text });
  }
  return out;
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

/** Parse "1:02:03", "12:34" or "75" into seconds. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':').map((p) => Number(p));
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export interface Chunk {
  index: number;
  fromLine: number;
  toLine: number;
  start: number;
  end: number;
}

/**
 * Split captions into analysis chunks of roughly `targetSec`, cutting at the
 * largest pause inside the last 25% of the window so a chunk rarely ends in
 * the middle of a sentence. Chunks never overlap: every line belongs to
 * exactly one chunk, which is what makes per-chunk checkpoints resumable.
 */
export function chunkCaptions(lines: CaptionLine[], targetSec = 120, maxChars = 2400): Chunk[] {
  const chunks: Chunk[] = [];
  let startIdx = 0;
  while (startIdx < lines.length) {
    const startTime = lines[startIdx].from;
    let endIdx = startIdx;
    let chars = 0;
    while (endIdx + 1 < lines.length) {
      const next = lines[endIdx + 1];
      if (next.to - startTime > targetSec || chars + next.text.length > maxChars) break;
      chars += next.text.length;
      endIdx += 1;
    }
    if (endIdx + 1 < lines.length && endIdx > startIdx) {
      const windowStart = startIdx + Math.floor((endIdx - startIdx) * 0.75);
      let bestCut = endIdx;
      let bestGap = -1;
      for (let i = windowStart; i < endIdx; i += 1) {
        const gap = lines[i + 1].from - lines[i].to;
        const sentenceEnd = /[。！？!?.…]$/.test(lines[i].text) ? 0.6 : 0;
        if (gap + sentenceEnd > bestGap) {
          bestGap = gap + sentenceEnd;
          bestCut = i;
        }
      }
      endIdx = bestCut;
    }
    chunks.push({ index: chunks.length, fromLine: startIdx, toLine: endIdx, start: lines[startIdx].from, end: lines[endIdx].to });
    startIdx = endIdx + 1;
  }
  return chunks;
}

/**
 * Overlapping retrieval windows (~`windowSec` long, stepping by half a
 * window). Overlap means an answer that straddles a boundary is still fully
 * inside at least one passage.
 */
export function buildPassages(videoId: string, lines: CaptionLine[], windowSec = 40): Passage[] {
  if (lines.length === 0) return [];
  const passages: Passage[] = [];
  const step = windowSec / 2;
  let i = 0;
  while (i < lines.length) {
    const start = lines[i].from;
    let j = i;
    while (j + 1 < lines.length && lines[j + 1].to - start <= windowSec) j += 1;
    passages.push({
      id: `${videoId}#${i}-${j}`,
      videoId,
      fromLine: i,
      toLine: j,
      start,
      end: lines[j].to,
      text: lines
        .slice(i, j + 1)
        .map((l) => l.text)
        .join(' ')
    });
    if (j === lines.length - 1) break;
    let next = i + 1;
    while (next < lines.length && lines[next].from - start < step) next += 1;
    i = Math.min(next, j);
    if (i <= passages[passages.length - 1].fromLine) i = passages[passages.length - 1].fromLine + 1;
  }
  return passages;
}

/** Render lines as `[idx|mm:ss] text` so the model can cite by index. */
export function renderLines(lines: CaptionLine[], maxChars = Infinity): string {
  const out: string[] = [];
  let used = 0;
  for (const l of lines) {
    const row = `[${l.idx}|${formatTime(l.from)}] ${l.text}`;
    if (used + row.length > maxChars) break;
    out.push(row);
    used += row.length + 1;
  }
  return out.join('\n');
}

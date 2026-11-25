import { contentWords } from '../text/tokenize';
import type { CaptionLine, Segment } from '../types';

/**
 * Deterministic grounding score: the share of a summary's content words that
 * literally occur in the captions it claims to summarise. It is free, runs on
 * every segment, and catches the common failure where the model drifts into
 * general knowledge the speaker never said. Only low scorers are escalated to
 * an LLM judge, which keeps verification cost proportional to doubt.
 */
export function lexicalGrounding(summary: string, source: string): number {
  const words = contentWords(summary);
  if (words.length === 0) return 1;
  const haystack = source.normalize('NFKC').toLowerCase();
  let hit = 0;
  for (const w of words) {
    if (haystack.includes(w)) {
      hit += 1;
      continue;
    }
    // Partial credit for CJK words whose characters mostly appear (e.g. "注意力机制" vs "注意力的机制").
    if (/[一-鿿]/.test(w) && w.length >= 3) {
      let pairs = 0;
      for (let i = 0; i < w.length - 1; i += 1) if (haystack.includes(w.slice(i, i + 2))) pairs += 1;
      hit += 0.8 * (pairs / (w.length - 1));
    }
  }
  return Math.min(1, hit / words.length);
}

export function segmentSource(seg: Pick<Segment, 'fromLine' | 'toLine'>, lines: CaptionLine[]): string {
  return lines
    .slice(seg.fromLine, seg.toLine + 1)
    .map((l) => l.text)
    .join(' ');
}

export function scoreGrounding(seg: Segment, lines: CaptionLine[]): number {
  const text = [seg.summary, ...seg.keyPoints].join('。');
  return lexicalGrounding(text, segmentSource(seg, lines));
}

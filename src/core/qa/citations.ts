import { lexicalGrounding } from '../analysis/grounding';
import type { CaptionLine } from '../types';

/**
 * Answers cite caption lines, not times: `[L123]`, a range `[L120-L125]`, or a line in another
 * library video `[BV1xx411c7mD L88]`. Line numbers are what the model actually saw, so a
 * citation can be checked against the text it points to, and the time is looked up afterwards.
 */
export interface Citation {
  raw: string;
  /** Set for citations into another video. */
  bvid?: string;
  fromLine: number;
  toLine: number;
  /** Start time of the cited line, filled in by `resolveCitations`. */
  time?: number;
  /** The sentence around the citation shares enough words with the cited lines. */
  supported?: boolean;
  /** Position in the answer text. */
  index: number;
}

const CITE_RE = /\[(?:(BV[0-9A-Za-z]{10})\s+)?L(\d{1,5})(?:\s*[-–~]\s*L?(\d{1,5}))?\]/g;

export function parseCitations(text: string): Citation[] {
  const out: Citation[] = [];
  for (const m of text.matchAll(CITE_RE)) {
    const a = Number(m[2]);
    const b = m[3] ? Number(m[3]) : a;
    out.push({ raw: m[0], bvid: m[1], fromLine: Math.min(a, b), toLine: Math.max(a, b), index: m.index ?? 0 });
  }
  return out;
}

/** The clause a citation is attached to: text since the previous citation or sentence end. */
export function claimBefore(text: string, index: number): string {
  const head = text.slice(0, index);
  const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('\n'), head.lastIndexOf(']'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('；'));
  return head.slice(cut + 1).replace(/[*#>`-]/g, ' ').trim();
}

/**
 * Fill in times and check support. A citation is supported when the clause before it shares
 * at least `threshold` of its content words with the cited lines (widened by `slack` lines,
 * since speakers often state a point a line before or after). Lines that do not exist are
 * unsupported by definition.
 */
export function resolveCitations(
  text: string,
  linesOf: (bvid: string | undefined) => CaptionLine[] | undefined,
  { threshold = 0.3, slack = 2 }: { threshold?: number; slack?: number } = {}
): Citation[] {
  return parseCitations(text).map((c) => {
    const lines = linesOf(c.bvid);
    if (!lines || c.fromLine >= lines.length) return { ...c, supported: false };
    const from = Math.max(0, c.fromLine - slack);
    const to = Math.min(lines.length - 1, c.toLine + slack);
    const source = lines
      .slice(from, to + 1)
      .map((l) => l.text)
      .join(' ');
    const claim = claimBefore(text, c.index);
    return { ...c, time: lines[c.fromLine].from, supported: claim.length < 2 || lexicalGrounding(claim, source) >= threshold };
  });
}

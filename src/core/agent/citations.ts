import { parseTime } from '../transcript/captions';

export interface ParsedCitation {
  raw: string;
  /** Present when the citation points to another video in the library, e.g. [BV1xx4y1z7 12:30]. */
  bvid?: string;
  time: number;
  index: number;
}

const CITE_RE = /\[(?:(BV[0-9A-Za-z]{10})\s*[ @#]?\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\]/g;

export function parseCitations(text: string): ParsedCitation[] {
  const out: ParsedCitation[] = [];
  for (const m of text.matchAll(CITE_RE)) {
    const t = parseTime(m[2]);
    if (t === null) continue;
    out.push({ raw: m[0], bvid: m[1], time: t, index: m.index ?? 0 });
  }
  return out;
}

export interface EvidenceSpan {
  bvid?: string;
  start: number;
  end: number;
}

/**
 * A citation is valid when its timestamp falls inside (or within `slackSec`
 * of) a transcript span the agent actually retrieved during this turn. This
 * is the agent's hallucination check: a timestamp it never looked at cannot
 * be evidence, however plausible it sounds.
 */
export function isCitationGrounded(c: ParsedCitation, spans: EvidenceSpan[], currentBvid: string, slackSec = 8): boolean {
  const bvid = c.bvid ?? currentBvid;
  return spans.some((s) => (s.bvid ?? currentBvid) === bvid && c.time >= s.start - slackSec && c.time <= s.end + slackSec);
}

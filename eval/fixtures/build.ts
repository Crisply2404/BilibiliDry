import { cleanCaptions, type RawCaption } from '../../src/core/transcript/captions';
import type { CaptionLine, VideoInfo } from '../../src/core/types';
import { agentIntro } from './agent-intro';
import { braisedPork } from './braised-pork';
import type { Fixture } from './types';

export const FIXTURES: Fixture[] = [agentIntro, braisedPork];

export interface BuiltFixture {
  fixture: Fixture;
  video: VideoInfo;
  lines: CaptionLine[];
  /** Time span of each block. */
  spans: Map<string, { start: number; end: number }>;
}

/** Split on Chinese clause punctuation, the way ASR subtitles break lines. */
function clauses(text: string): string[] {
  return text
    .split(/(?<=[，。！？；])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** ~4.2 chars/second is a typical Mandarin speaking rate. */
export function buildFixture(f: Fixture): BuiltFixture {
  const raw: RawCaption[] = [];
  const spans = new Map<string, { start: number; end: number }>();
  let t = 0.5;
  for (const block of f.blocks) {
    const start = t;
    for (const c of clauses(block.text)) {
      const dur = Math.max(1.2, c.length / 4.2);
      raw.push({ from: Number(t.toFixed(2)), to: Number((t + dur).toFixed(2)), content: c.replace(/[，。；]$/, '') });
      t += dur + 0.25;
    }
    spans.set(block.id, { start, end: t });
    t += 0.6;
  }
  const lines = cleanCaptions(raw);
  return {
    fixture: f,
    lines,
    spans,
    video: { videoId: `${f.id}_1`, bvid: `BV${f.id.replace(/[^a-z]/gi, '').slice(0, 10).padEnd(10, 'x')}`, aid: 1, cid: 1, page: 1, title: f.title, durationSec: Math.ceil(t) }
  };
}

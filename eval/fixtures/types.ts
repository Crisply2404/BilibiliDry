import type { WaterReason } from '../../src/core/types';

/**
 * Eval fixtures are written as labelled blocks of speech rather than raw
 * subtitle JSON, so gold labels (which stretch is filler, where each answer
 * lives) can never drift out of sync with the text. `build.ts` turns blocks
 * into timed caption lines the way Bilibili's auto-subtitles look: one short
 * clause per line, ~2–5 seconds each.
 *
 * The transcripts are original text written for this repo (no third-party
 * video content), styled after real Bilibili lectures: greetings, sponsor
 * reads, repetition, ASR-ish phrasing.
 */
export interface FixtureBlock {
  id: string;
  kind: 'dry' | 'water';
  reason?: WaterReason;
  /** Marks content a good summary must surface (used for highlight recall). */
  key?: boolean;
  text: string;
}

export interface FixtureQuery {
  q: string;
  /** Block ids whose time span contains the answer. */
  gold: string[];
  /** 'lexical' = question reuses the speaker's words; 'paraphrase' = different wording. */
  style: 'lexical' | 'paraphrase';
}

export interface Fixture {
  id: string;
  title: string;
  blocks: FixtureBlock[];
  queries: FixtureQuery[];
}

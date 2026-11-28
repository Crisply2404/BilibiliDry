import { BilibiliError, createBilibiliClient } from '../core/bilibili/api';
import { cleanCaptions } from '../core/transcript/captions';
import type { CaptionLine } from '../core/types';
import type { VideoRecord } from '../shared/protocol';
import { getCaptions, getVideo, putCaptions, putVideo } from './db';

export { BilibiliError };

/** One client per service worker: it caches the WBI signing key. */
const bili = createBilibiliClient();

/** Bilibili's AI summary is fetched once per video and cached; re-asking would only risk rate limits. */
const OFFICIAL_TTL = 7 * 24 * 3600_000;

/**
 * Make sure the library has this video's record: metadata, Bilibili's own summary (shown even
 * without an API key), and the transcript whenever the summary API delivered one.
 */
export async function ensureVideo(bvid: string, page: number): Promise<VideoRecord> {
  const info = await bili.videoInfo(bvid, page);
  const existing = await getVideo(info.videoId);
  const fresh = existing?.officialCheckedAt && Date.now() - existing.officialCheckedAt < OFFICIAL_TTL;
  const record: VideoRecord = { ...(existing ?? { addedAt: Date.now(), captionCount: 0 }), ...info };
  if (!fresh) {
    try {
      const off = await bili.official(info);
      record.official = off?.summary ?? null;
      record.officialCheckedAt = Date.now();
      if (off && off.raw.length > 0 && !existing?.captionCount) {
        const lines = cleanCaptions(off.raw);
        await putCaptions(info.videoId, lines);
        record.captionCount = lines.length;
        record.transcriptSource = 'official';
      }
    } catch (err) {
      // Not logged in or rate limited: the video still works, just without the official summary for now.
      if (!(err instanceof BilibiliError)) throw err;
    }
  }
  await putVideo(record);
  return record;
}

/** Captions for analysis and Q&A: the stored ones, else the player's subtitle track (checked against the video). */
export async function ensureCaptions(video: VideoRecord): Promise<CaptionLine[]> {
  const stored = await getCaptions(video.videoId);
  if (stored?.length) return stored;
  const t = await bili.playerSubtitle(video);
  const lines = cleanCaptions(t.raw);
  await putCaptions(video.videoId, lines);
  await putVideo({ ...video, captionCount: lines.length, transcriptSource: t.source });
  return lines;
}

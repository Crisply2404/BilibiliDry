import { ContentType, type Segment } from '../types';

export function getUnionDurationSec(params: { segments: Segment[]; type: ContentType }): number {
  const list = (params.segments ?? [])
    .filter((s) => s.type === params.type)
    .map((s) => ({
      start: Number(s.startTime),
      end: Number(s.endTime)
    }))
    .filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start)
    .sort((a, b) => a.start - b.start);

  if (list.length === 0) return 0;

  let total = 0;
  let curStart = list[0].start;
  let curEnd = list[0].end;

  for (let i = 1; i < list.length; i++) {
    const seg = list[i];
    if (seg.start <= curEnd) {
      curEnd = Math.max(curEnd, seg.end);
      continue;
    }
    total += Math.max(0, curEnd - curStart);
    curStart = seg.start;
    curEnd = seg.end;
  }

  total += Math.max(0, curEnd - curStart);
  return total;
}

export function getDryPercent(params: { segments: Segment[]; totalDurationSec: number }): number {
  const total = Number(params.totalDurationSec);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const dry = getUnionDurationSec({ segments: params.segments, type: ContentType.DRY });
  return Math.round((dry / total) * 100);
}


import type { SegmentRecord, VideoRecord } from './db';
import { ContentType } from '../../types';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function timeLinkForVideo(video: VideoRecord, seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const p = typeof video.page === 'number' && Number.isFinite(video.page) && video.page > 1 ? `p=${Math.floor(video.page)}&` : '';
  const bvid = video.bvid || video.videoId;
  return `https://www.bilibili.com/video/${encodeURIComponent(bvid)}?${p}t=${t}`;
}

export function buildMarkdown(params: { video: VideoRecord; segments: SegmentRecord[] }): string {
  const segs = [...params.segments].sort((a, b) => a.startTime - b.startTime);
  const dry = segs.filter((s) => s.type === ContentType.DRY);
  const water = segs.filter((s) => s.type === ContentType.WATER);

  const keyPoints = dry
    .slice(0, 12)
    .map((s) => `- ${formatTime(s.startTime)}-${formatTime(s.endTime)} ${s.summary}（${timeLinkForVideo(params.video, s.startTime)}）`)
    .join('\n');

  const waterPoints = water
    .slice(0, 12)
    .map((s) => `- ${formatTime(s.startTime)}-${formatTime(s.endTime)} ${s.summary}（${timeLinkForVideo(params.video, s.startTime)}）`)
    .join('\n');

  return `# ${params.video.title}

- 视频：${timeLinkForVideo(params.video, 0)}
- BV：${params.video.bvid || params.video.videoId}
- 分析时间：${params.video.lastAnalyzedAt ?? ''}

## 核心摘要（自动生成）

${dry.slice(0, 5).map((s) => `- ${s.summary}`).join('\n') || '- 暂无'}

## 干货片段（时间索引）

${keyPoints || '- 暂无'}

## 注水片段（可跳过）

${waterPoints || '- 暂无'}
`;
}

import type { SegmentRecord, VideoRecord } from './db';
import { ContentType } from '../../types';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function timeLink(bvid: string, seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return `https://www.bilibili.com/video/${encodeURIComponent(bvid)}?t=${t}`;
}

export function buildMarkdown(params: { video: VideoRecord; segments: SegmentRecord[] }): string {
  const segs = [...params.segments].sort((a, b) => a.startTime - b.startTime);
  const dry = segs.filter((s) => s.type === ContentType.DRY);
  const water = segs.filter((s) => s.type === ContentType.WATER);

  const keyPoints = dry
    .slice(0, 12)
    .map((s) => `- ${formatTime(s.startTime)}-${formatTime(s.endTime)} ${s.summary}（${timeLink(params.video.videoId, s.startTime)}）`)
    .join('\n');

  const waterPoints = water
    .slice(0, 12)
    .map((s) => `- ${formatTime(s.startTime)}-${formatTime(s.endTime)} ${s.summary}（${timeLink(params.video.videoId, s.startTime)}）`)
    .join('\n');

  return `# ${params.video.title}

- 视频：${timeLink(params.video.videoId, 0)}
- BV：${params.video.videoId}
- 分析时间：${params.video.lastAnalyzedAt ?? ''}

## 核心摘要（自动生成）

${dry.slice(0, 5).map((s) => `- ${s.summary}`).join('\n') || '- 暂无'}

## 干货片段（时间索引）

${keyPoints || '- 暂无'}

## 注水片段（可跳过）

${waterPoints || '- 暂无'}
`;
}


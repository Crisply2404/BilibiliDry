import { formatTime } from '../transcript/captions';
import { WATER_REASON_LABEL, type Segment, type VideoDigest, type VideoInfo } from '../types';

export function videoUrl(video: Pick<VideoInfo, 'bvid' | 'page'>, t?: number): string {
  const params = new URLSearchParams();
  if (video.page > 1) params.set('p', String(video.page));
  if (t !== undefined) params.set('t', String(Math.floor(t)));
  const qs = params.toString();
  return `https://www.bilibili.com/video/${video.bvid}${qs ? `?${qs}` : ''}`;
}

/** Notes that paste cleanly into Notion/Obsidian; every timestamp links back to the moment in the video. */
export function toMarkdown(video: VideoInfo, segments: Segment[], digest: VideoDigest | null): string {
  const link = (t: number) => `[${formatTime(t)}](${videoUrl(video, t)})`;
  const dry = segments.filter((s) => s.kind === 'dry');
  const water = segments.filter((s) => s.kind === 'water');
  const waterSec = water.reduce((a, s) => a + (s.end - s.start), 0);
  const highlightIds = new Set(digest?.highlightIds ?? []);
  const out: string[] = [];
  out.push(`# ${video.title}${video.partTitle ? ` · ${video.partTitle}` : ''}`);
  out.push('');
  out.push(`> 来源：${videoUrl(video)}${video.owner ? ` · UP 主：${video.owner}` : ''} · 时长 ${formatTime(video.durationSec)} · 可跳过约 ${formatTime(waterSec)}`);
  out.push('');
  if (digest?.tldr) {
    out.push('## 一句话总结', '', digest.tldr, '');
  }
  if (digest?.takeaways.length) {
    out.push('## 要点', '', ...digest.takeaways.map((t) => `- ${t}`), '');
  }
  const highlights = segments.filter((s) => highlightIds.has(s.id));
  if (highlights.length) {
    out.push('## 重点片段', '');
    for (const s of highlights) {
      out.push(`- ${link(s.start)} **${s.title}**：${s.summary}`);
      for (const k of s.keyPoints) out.push(`  - ${k}`);
    }
    out.push('');
  }
  if (digest?.chapters.length) {
    out.push('## 章节', '');
    for (const c of digest.chapters) {
      out.push(`### ${link(c.start)} ${c.title}`, '');
      if (c.summary) out.push(c.summary, '');
      for (const s of dry.filter((x) => x.start >= c.start && x.start < c.end)) {
        out.push(`- ${link(s.start)} ${s.title}：${s.summary}`);
      }
      out.push('');
    }
  } else if (dry.length) {
    out.push('## 干货片段', '', ...dry.map((s) => `- ${link(s.start)} ${s.title}：${s.summary}`), '');
  }
  if (water.length) {
    out.push('## 可跳过片段', '');
    for (const s of water) out.push(`- ${link(s.start)}–${formatTime(s.end)} ${s.waterReason ? WATER_REASON_LABEL[s.waterReason] : '注水'}：${s.summary || s.title}`);
    out.push('');
  }
  out.push('---', '', '*由 BilibiliDry 生成*');
  return out.join('\n');
}

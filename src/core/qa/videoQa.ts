import type { ChatMessage, LlmClient, ReasoningLevel } from '../llm/types';
import { formatTime, renderLines } from '../transcript/captions';
import type { CaptionLine, OfficialSummary, Segment, VideoInfo } from '../types';
import { resolveCitations, type Citation } from './citations';

/**
 * Questions about the video being watched, answered with the whole transcript in context.
 *
 * A one-hour Bilibili video is ~15k Chinese characters, far below a modern context window, so
 * there is nothing to retrieve: the model reads everything and cannot miss the passage the
 * way a top-k retriever can. The transcript sits at the start of the prompt and never
 * changes, so follow-up questions hit the provider's prefix cache.
 */

export interface VideoQaInput {
  video: Pick<VideoInfo, 'title' | 'durationSec' | 'bvid' | 'owner'>;
  lines: CaptionLine[];
  segments?: Segment[];
  official?: OfficialSummary | null;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  question: string;
  currentTime?: number;
}

export interface VideoQaResult {
  answer: string;
  citations: Citation[];
}

function systemPrompt(input: VideoQaInput): string {
  return `你是 BilibiliDry 的视频助手，帮用户理解 B 站视频《${input.video.title}》（${formatTime(input.video.durationSec)}${input.video.owner ? `，UP 主：${input.video.owner}` : ''}）。下面是这个视频的完整字幕，每行格式为 [行号|时间] 文本，字幕是语音识别的，可能有同音错字。

回答规则：
- 只根据字幕回答。视频里没讲的就直接说“视频里没讲到”；需要补充常识时，单独一句并标明“视频外补充”。
- 每个来自视频的结论后面用 [L行号] 标出处，例如 [L128]；跨几行就写 [L128-L131]。只引用真正说了这件事的行。
- 先给结论再展开，简洁，用中文，适当用列表。

字幕：
${renderLines(input.lines)}`;
}

function contextNote(input: VideoQaInput): string {
  const parts: string[] = [];
  if (input.currentTime !== undefined) {
    const line = input.lines.findIndex((l) => l.to >= input.currentTime!);
    parts.push(`用户现在播放到 ${formatTime(input.currentTime)}${line >= 0 ? `（约第 ${line} 行）` : ''}。`);
  }
  return parts.length ? `（${parts.join(' ')}）\n` : '';
}

export async function askVideo(
  input: VideoQaInput,
  deps: { llm: LlmClient },
  opts: { model?: string; reasoning?: ReasoningLevel; signal?: AbortSignal; onDelta?: (text: string) => void } = {}
): Promise<VideoQaResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(input) },
    ...(input.history ?? []).slice(-8).map((t) => ({ role: t.role, content: t.content.slice(0, 3000) }) as ChatMessage),
    { role: 'user', content: `${contextNote(input)}${input.question}` }
  ];
  const res = await deps.llm.chat(
    { purpose: 'qa', model: opts.model, reasoning: opts.reasoning, signal: opts.signal, temperature: 0.3, messages },
    opts.onDelta
  );
  const answer = res.content.trim();
  return { answer, citations: resolveCitations(answer, (bvid) => (!bvid || bvid === input.video.bvid ? input.lines : undefined)) };
}

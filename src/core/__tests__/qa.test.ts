import { describe, expect, it } from 'vitest';
import type { ChatRequest, ChatResult, LlmClient } from '../llm/types';
import { claimBefore, parseCitations, resolveCitations } from '../qa/citations';
import { askLibrary, type LibraryEnv } from '../qa/libraryAgent';
import { askVideo } from '../qa/videoQa';
import { cleanCaptions } from '../transcript/captions';

const lines = cleanCaptions([
  { from: 0, to: 3, content: '大家好欢迎来到频道' },
  { from: 3, to: 7, content: '今天讲红烧肉怎么做' },
  { from: 7, to: 12, content: '焯水一定要冷水下锅' },
  { from: 12, to: 16, content: '水开以后撇掉血沫' },
  { from: 16, to: 21, content: '炒糖色要用小火慢慢炒' },
  { from: 21, to: 26, content: '最后大火收汁就可以出锅了' }
]);
const base = { reasoning: '', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, estimated: false }, model: 'm', latencyMs: 1, finishReason: 'stop' };
const video = { title: '红烧肉', durationSec: 26, bvid: 'BV1aaaaaaaaa' };

describe('citations', () => {
  it('parses single lines, ranges and cross-video citations', () => {
    const cs = parseCitations('冷水下锅 [L2]，然后撇沫 [L3-L4]；另一个视频也说了 [BV1bbbbbbbbb L10]。');
    expect(cs.map((c) => [c.bvid, c.fromLine, c.toLine])).toEqual([
      [undefined, 2, 2],
      [undefined, 3, 4],
      ['BV1bbbbbbbbb', 10, 10]
    ]);
  });

  it('takes the clause right before a citation as the claim', () => {
    const text = '先说结论。焯水要冷水下锅 [L2]，糖色用小火 [L4]。';
    expect(claimBefore(text, text.indexOf('[L2]'))).toBe('焯水要冷水下锅');
    expect(claimBefore(text, text.indexOf('[L4]'))).toBe('，糖色用小火');
  });

  it('marks a citation supported only when the clause matches the cited lines', () => {
    const text = '焯水要冷水下锅 [L2]。炒糖色要用大火爆炒 [L0]。视频还提到了第十行 [L10]。';
    const cs = resolveCitations(text, () => lines);
    expect(cs.map((c) => c.supported)).toEqual([true, false, false]);
    expect(cs[0].time).toBe(7);
  });
});

describe('askVideo', () => {
  it('puts the whole transcript at the start of the prompt and resolves line citations', async () => {
    let req: ChatRequest | undefined;
    const llm: LlmClient = {
      model: 'm',
      async chat(r: ChatRequest, onDelta?: (t: string) => void): Promise<ChatResult> {
        req = r;
        onDelta?.('冷水下锅 [L2]。');
        return { ...base, content: '冷水下锅 [L2]。' };
      }
    };
    const deltas: string[] = [];
    const out = await askVideo({ video, lines, question: '焯水用冷水还是热水？', currentTime: 9, history: [{ role: 'user', content: '之前的问题' }] }, { llm }, { onDelta: (t) => deltas.push(t) });
    expect(req!.messages[0].role).toBe('system');
    expect(req!.messages[0].content).toContain('[2|0:07] 焯水一定要冷水下锅');
    expect(req!.messages[1].content).toBe('之前的问题');
    expect(req!.messages[req!.messages.length - 1].content).toContain('用户现在播放到 0:09');
    expect(deltas.join('')).toBe('冷水下锅 [L2]。');
    expect(out.citations[0]).toMatchObject({ fromLine: 2, time: 7, supported: true });
  });

  it('keeps the system prompt identical across questions so the provider can cache it', async () => {
    const prompts: string[] = [];
    const llm: LlmClient = { model: 'm', chat: async (r) => (prompts.push(String(r.messages[0].content)), { ...base, content: 'ok' }) };
    await askVideo({ video, lines, question: '一', currentTime: 1 }, { llm });
    await askVideo({ video, lines, question: '二', currentTime: 20 }, { llm });
    expect(prompts[0]).toBe(prompts[1]);
  });
});

describe('askLibrary', () => {
  const other = cleanCaptions([
    { from: 0, to: 5, content: '这期讲排骨' },
    { from: 5, to: 9, content: '排骨也要冷水下锅焯水' }
  ]);
  const env: LibraryEnv = {
    listVideos: async () => [
      { videoId: 'a', bvid: 'BV1aaaaaaaaa', title: '红烧肉', durationSec: 26 },
      { videoId: 'b', bvid: 'BV1bbbbbbbbb', title: '排骨', durationSec: 9 }
    ],
    search: async () => [{ videoId: 'b', bvid: 'BV1bbbbbbbbb', title: '排骨', fromLine: 0, toLine: 1, start: 0, end: 9, text: '这期讲排骨 排骨也要冷水下锅焯水' }],
    lines: async (bvid) => (bvid === 'BV1aaaaaaaaa' ? lines : bvid === 'BV1bbbbbbbbb' ? other : undefined)
  };

  it('searches, then answers with citations checked against what it read', async () => {
    const requests: ChatRequest[] = [];
    const llm: LlmClient = {
      model: 'm',
      async chat(r: ChatRequest): Promise<ChatResult> {
        requests.push(r);
        if (requests.length === 1)
          return { ...base, reasoning: '先检索一下', content: '', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'search_library', arguments: '{"query":"冷水下锅"}' } }], finishReason: 'tool_calls' };
        return { ...base, content: '排骨视频也要冷水下锅焯水 [BV1bbbbbbbbb L1]；红烧肉视频的焯水 [BV1aaaaaaaaa L2]。' };
      }
    };
    const events: string[] = [];
    const out = await askLibrary({ llm, env, question: '哪些视频讲了冷水下锅？', onEvent: (e) => events.push(e.type) });
    expect(events).toEqual(['tool_call', 'tool_result']);
    // The tool-calling turn's thinking is sent back, as DeepSeek requires.
    const assistantTurn = requests[1].messages.find((m) => m.role === 'assistant');
    expect(assistantTurn?.reasoning_content).toBe('先检索一下');
    expect(requests[1].messages.some((m) => m.role === 'tool' && String(m.content).includes('排骨也要冷水下锅'))).toBe(true);
    expect(out.citations.map((c) => [c.bvid, c.supported])).toEqual([
      ['BV1bbbbbbbbb', true],
      ['BV1aaaaaaaaa', false] // never read this video, so it does not count as evidence
    ]);
  });

  it('stops after the step limit with a forced final answer', async () => {
    let n = 0;
    const llm: LlmClient = {
      model: 'm',
      async chat(r: ChatRequest): Promise<ChatResult> {
        n += 1;
        if (r.tools) return { ...base, content: '', toolCalls: [{ id: `c${n}`, type: 'function', function: { name: 'list_videos', arguments: '{}' } }], finishReason: 'tool_calls' };
        return { ...base, content: '知识库里有两个视频。' };
      }
    };
    const out = await askLibrary({ llm, env, question: '有哪些视频？', maxSteps: 3 });
    expect(n).toBe(3);
    expect(out.answer).toBe('知识库里有两个视频。');
  });
});

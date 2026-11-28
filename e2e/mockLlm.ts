/**
 * A tiny OpenAI-compatible server that plays the model's part deterministically, so the E2E
 * test exercises the real extension (service worker, IndexedDB, ports, side panel, player
 * layer) without a network or an API key. It recognises requests by the extension's prompts.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
}

/** Whole-video analysis: JSON Lines, a filler segment at each end, dry segments of ~15 lines between. */
function analysis(user: string): string {
  const m = /行号 (\d+)–(\d+)/.exec(user)!;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const out: string[] = [];
  let from = a;
  if (a === 0) {
    out.push(JSON.stringify({ t: 'seg', from: 0, to: 4, kind: 'water', reason: 'smalltalk', importance: 1, title: '开场寒暄', summary: '打招呼' }));
    from = 5;
  }
  const endDry = b - 4;
  for (let i = from; i <= endDry; i += 15) {
    const to = Math.min(endDry, i + 14);
    out.push(JSON.stringify({ t: 'seg', from: i, to, kind: 'dry', importance: i === from ? 5 : 3, title: `第 ${i} 行起的要点`, summary: 'ReAct 就是推理加行动' }));
  }
  out.push(JSON.stringify({ t: 'seg', from: endDry + 1, to: b, kind: 'water', reason: 'smalltalk', importance: 1, title: '结尾', summary: '求三连' }));
  out.push(JSON.stringify({ t: 'digest', tldr: '这是一期讲 Agent 基础的视频', takeaways: ['Agent = 模型 + 循环 + 工具'], chapters: [{ from: 0, title: '开场' }, { from: 5, title: '正文' }], highlights: [5, 20] }));
  return out.join('\n');
}

function lineWith(text: string, word: string): number {
  const m = new RegExp(`^\\[(\\d+)\\|[\\d:]+\\][^\\n]*${word}`, 'm').exec(text);
  return m ? Number(m[1]) : 0;
}

function libraryStep(body: any): { content?: string; toolCall?: { name: string; arguments: string } } {
  const tool = (body.messages ?? []).find((m: any) => m.role === 'tool');
  if (!tool) return { toolCall: { name: 'search_library', arguments: JSON.stringify({ query: 'ReAct' }) } };
  const m = /(BV[0-9A-Za-z]{10})《[^》]*》 L(\d+)-L(\d+)/.exec(String(tool.content));
  return { content: m ? `知识库里《大模型 Agent 入门》讲过 ReAct 就是推理加行动 [${m[1]} L${m[2]}]。` : '知识库里没有找到。' };
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function stream(res: ServerResponse, pieces: Array<Record<string, unknown>>) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const p of pieces) res.write(`data: ${JSON.stringify(p)}\n\n`);
  res.end('data: [DONE]\n\n');
}

export function startMockLlm(port = 0): Promise<{ server: Server; baseUrl: string; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    if (!req.url?.endsWith('/chat/completions')) return void res.writeHead(404).end('{"error":"not found"}');
    const body = await readBody(req);
    const sys = String(body.messages?.[0]?.content ?? '');
    const user = String(body.messages?.find((m: any) => m.role === 'user')?.content ?? '');
    const usage = { prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 600 };
    let content = '';
    if (sys.includes('切成首尾相接的片段')) {
      calls.push('analysis');
      content = analysis(user);
    } else if (sys.includes('片段列表')) {
      calls.push('digest');
      content = JSON.stringify({ tldr: '这是一期讲 Agent 基础的视频', takeaways: ['循环'], chapters: [{ from: 0, title: '全部' }], highlights: [5] });
    } else if (sys.includes('BilibiliDry 的视频助手')) {
      calls.push('qa');
      content = `ReAct 就是推理加行动 [L${lineWith(sys, 'ReAct')}]。`;
    } else if (sys.includes('BilibiliDry 的知识库助手')) {
      calls.push('library');
      const step = libraryStep(body);
      if (step.toolCall) {
        const tool_calls = [{ index: 0, id: 'call_1', type: 'function', function: step.toolCall }];
        if (body.stream) return stream(res, [{ choices: [{ delta: { tool_calls }, finish_reason: 'tool_calls' }] }]);
        return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls }, finish_reason: 'tool_calls' }], usage }));
      }
      content = step.content!;
    } else {
      calls.push('other');
      content = '收到';
    }
    if (body.stream) return stream(res, [...(content.match(/[\s\S]{1,12}/g) ?? []).map((c) => ({ choices: [{ delta: { content: c } }] })), { choices: [{ delta: {}, finish_reason: 'stop' }], usage }]);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: body.model ?? 'mock', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage }));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, calls, baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1` })));
}

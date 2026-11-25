/**
 * A tiny OpenAI-compatible server that plays the model's part
 * deterministically, so the E2E test exercises the real extension (service
 * worker, IndexedDB, ports, UI) without a network or an API key.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
}

function reply(body: any): string {
  const sys = String(body.messages?.[0]?.content ?? '');
  const user = String(body.messages?.[body.messages.length - 1]?.content ?? '');
  if (sys.includes('切成若干连续片段')) {
    const m = /行号 (\d+)–(\d+)/.exec(user)!;
    const a = Number(m[1]);
    const b = Number(m[2]);
    const mid = Math.floor((a + b) / 2);
    const firstIsIntro = a === 0;
    return JSON.stringify({
      segments: [
        { from: a, to: mid, kind: firstIsIntro ? 'water' : 'dry', importance: firstIsIntro ? 1 : 4, title: firstIsIntro ? '开场寒暄' : `第${a}行起的要点`, summary: firstIsIntro ? '打招呼' : user.split('\n').slice(3, 5).join(' ').replace(/\[\d+\|[\d:]+\]/g, '').slice(0, 60), waterReason: 'smalltalk' },
        { from: mid + 1, to: b, kind: 'dry', importance: 5, title: `第${mid + 1}行起的重点`, summary: user.split('\n').slice(-2).join(' ').replace(/\[\d+\|[\d:]+\]/g, '').slice(0, 60), keyPoints: ['要点一'] }
      ]
    });
  }
  if (sys.includes('startSegment')) return JSON.stringify({ tldr: '这是一期讲 Agent 基础的视频', takeaways: ['Agent = 模型 + 循环 + 工具', '要做评测'], chapters: [{ startSegment: 0, title: '开场', summary: '介绍' }, { startSegment: 2, title: '正文', summary: 'ReAct 与工具调用' }] });
  if (sys.includes('事实核查员')) return '{"verdict":"supported","reason":"字幕一致","evidence":[]}';
  if (sys.includes('资深内容编辑')) return '{"title":"精修标题","summary":"精修后的摘要","keyPoints":["精修要点"]}';
  return '收到';
}

function agentStep(body: any): { content?: string; toolCall?: { name: string; arguments: string } } {
  const toolMsgs = (body.messages ?? []).filter((m: any) => m.role === 'tool');
  if (toolMsgs.length === 0) return { toolCall: { name: 'search_transcript', arguments: JSON.stringify({ query: 'ReAct' }) } };
  const m = /\[(\d+:\d{2})-/.exec(String(toolMsgs[0].content));
  return { content: `ReAct 就是推理加行动 [${m ? m[1] : '0:01'}]。` };
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function startMockLlm(port = 0): Promise<{ server: Server; baseUrl: string; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    if (!req.url?.endsWith('/chat/completions')) return void res.writeHead(404).end('{"error":"not found"}');
    const body = await readBody(req);
    const isAgent = String(body.messages?.[0]?.content ?? '').includes('BilibiliDry 的视频助手');
    calls.push(isAgent ? 'agent' : 'pipeline');
    if (isAgent) {
      const step = agentStep(body);
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (step.toolCall) res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: step.toolCall }] }, finish_reason: 'tool_calls' }] })}\n\n`);
        else for (const ch of step.content!.match(/.{1,6}/g)!) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`);
        return void res.end('data: [DONE]\n\n');
      }
      const message = step.toolCall ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: step.toolCall }] } : { role: 'assistant', content: step.content };
      return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'mock', choices: [{ message, finish_reason: 'stop' }] }));
    }
    const content = reply(body);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: body.model ?? 'mock', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, calls, baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1` })));
}

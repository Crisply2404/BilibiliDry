/**
 * End-to-end smoke test of the built extension (`npm run build` first):
 *
 *   PW_CHROMIUM=/path/to/chromium npm run e2e
 *
 * Bilibili's page and APIs are served from fixtures via request routing and
 * the model is a local mock, so the run is hermetic. It checks the real
 * paths: service worker boot, settings, caption fetch, chunked analysis with
 * IndexedDB checkpoints, live heatmap updates over ports, the tool-calling
 * chat agent with grounded citations, export, and the dashboard.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { buildFixture, FIXTURES } from '../eval/fixtures/build';
import { startMockLlm } from './mockLlm';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const BVID = 'BV1e2e4y1Tst';
const shot = (name: string) => path.join(ROOT, 'docs', 'screenshots', name);

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
}

async function shadowText(page: Page): Promise<string> {
  return page.evaluate(() => (document.getElementById('bilibilidry-host')?.shadowRoot?.querySelector('div')?.textContent ?? '') as string);
}

async function waitShadow(page: Page, text: string, timeout = 20000) {
  try {
    await page.waitForFunction((t) => (document.getElementById('bilibilidry-host')?.shadowRoot?.querySelector('div')?.textContent ?? '').includes(t), text, { timeout });
  } catch (err) {
    console.error(`overlay text while waiting for "${text}":\n${(await shadowText(page)).slice(0, 600)}`);
    throw err;
  }
}

async function clickShadow(page: Page, text: string) {
  // Playwright locators pierce open shadow roots; a real click goes through the same path as a user's.
  await page.locator('#bilibilidry-host button', { hasText: text }).first().click();
}

async function main() {
  const built = buildFixture(FIXTURES[0]);
  const mock = await startMockLlm();
  const userDir = mkdtempSync(path.join(tmpdir(), 'bdry-e2e-'));
  const executablePath = process.env.PW_CHROMIUM;
  const ctx = await chromium.launchPersistentContext(userDir, {
    executablePath,
    headless: false,
    viewport: { width: 1360, height: 820 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--headless=new', '--no-first-run']
  });
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
    const extId = new URL(sw.url()).host;
    assert(extId.length > 10, `service worker booted (${extId})`);

    // Fixtures for Bilibili: video page, view API, subtitle list, subtitle body.
    await ctx.route(`https://www.bilibili.com/video/**`, (r) =>
      r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body style="margin:0;background:#000"><video style="width:960px;height:540px" muted></video></body></html>` })
    );
    await ctx.route('https://api.bilibili.com/x/web-interface/view**', (r) =>
      r.fulfill({ json: { code: 0, data: { bvid: BVID, aid: 42, cid: 4242, title: built.video.title, duration: built.video.durationSec, owner: { name: '测试UP' }, pages: [{ cid: 4242, page: 1, part: 'P1', duration: built.video.durationSec }] } } })
    );
    await ctx.route('https://api.bilibili.com/x/player/**', (r) =>
      r.fulfill({ json: { code: 0, data: { subtitle: { subtitles: [{ lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/e2e.json' }] } } } })
    );
    await ctx.route('https://aisubtitle.hdslb.com/**', (r) =>
      r.fulfill({ json: { body: built.lines.map((l) => ({ from: l.from, to: l.to, content: l.text })) }, headers: { 'access-control-allow-origin': '*' } })
    );

    // Configure the extension through its own options page storage.
    // First install opens the options page by itself (onboarding); reuse it.
    const optionsUrl = `chrome-extension://${extId}/options.html`;
    await new Promise((r) => setTimeout(r, 1500));
    const onboarding = ctx.pages().some((p) => p.url().startsWith(optionsUrl));
    assert(onboarding, 'first install opens the onboarding/options page');
    const options = await ctx.newPage();
    await options.goto(optionsUrl);
    await options.waitForSelector('text=模型服务');
    await options.evaluate(
      (baseUrl) => chrome.storage.local.set({ 'settings.v1': { provider: 'custom', baseUrl, apiKey: 'test-key', model: 'mock-strong', cheapModel: 'mock-cheap', embeddingModel: '', concurrency: 3, chunkSec: 60, developerMode: true } }),
      mock.baseUrl
    );
    assert(true, 'options page renders and settings saved');

    const page = await ctx.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    if (process.env.E2E_DEBUG) page.on('console', (m) => console.log(`[page ${m.type()}]`, m.text().slice(0, 300)));
    await page.goto(`https://www.bilibili.com/video/${BVID}`);
    await waitShadow(page, '分析这个视频');
    assert(true, 'overlay mounted in shadow DOM with analyse button');

    await clickShadow(page, '分析这个视频');
    await new Promise((r) => setTimeout(r, 1200));
    if (process.env.E2E_DEBUG) {
      console.log('after click:', (await shadowText(page)).slice(0, 300));
      console.log('buttons:', await page.evaluate(() => Array.from(document.getElementById('bilibilidry-host')!.shadowRoot!.querySelectorAll('button')).map((b) => `${b.textContent}|${b.disabled}`).join(', ')));
      const sw = ctx.serviceWorkers()[0];
      console.log('job:', JSON.stringify(await sw.evaluate(() => new Promise((r) => { const req = indexedDB.open('bilibilidry'); req.onsuccess = () => { const tx = req.result.transaction('jobs'); const g = tx.objectStore('jobs').getAll(); g.onsuccess = () => r(g.result.map((j: any) => ({ s: j.status, m: j.message, e: j.error }))); }; }))));
    }
    await waitShadow(page, '只看这几段', 30000);
    const text = await shadowText(page);
    assert(text.includes('这是一期讲 Agent 基础的视频'), 'digest (TL;DR) rendered after analysis');
    assert(text.includes('可跳过'), 'filler stats rendered');
    assert(mock.calls.filter((c) => c === 'pipeline').length >= 4, `pipeline called the model ${mock.calls.length} times`);
    await page.screenshot({ path: shot('overlay-overview.png') });

    await clickShadow(page, '问答');
    await page.evaluate(() => {
      const root = document.getElementById('bilibilidry-host')!.shadowRoot!;
      const ta = root.querySelector('textarea')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, 'ReAct 是什么？');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await clickShadow(page, '发送');
    await waitShadow(page, '处引用有字幕证据', 20000);
    const chatText = await shadowText(page);
    assert(chatText.includes('ReAct 就是推理加行动'), 'agent answered via tool call');
    assert(/1\/1 处引用有字幕证据/.test(chatText), 'citation grounded in retrieved evidence');
    await page.screenshot({ path: shot('overlay-chat.png') });

    await clickShadow(page, '搜索');
    await page.evaluate(() => {
      const root = document.getElementById('bilibilidry-host')!.shadowRoot!;
      const input = root.querySelector('input[placeholder^="在这个视频"]') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '向量检索');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.form!.requestSubmit();
    });
    await waitShadow(page, 'bm25', 10000);
    assert(true, 'in-video hybrid search returns results');
    assert(pageErrors.length === 0, `no page errors (${pageErrors.join('; ')})`);

    const dash = await ctx.newPage();
    await dash.goto(`chrome-extension://${extId}/dashboard.html`);
    await dash.waitForSelector(`text=${built.video.title.slice(0, 10)}`, { timeout: 10000 });
    assert(true, 'dashboard library lists the analysed video');
    await dash.click(`text=${built.video.title.slice(0, 10)}`);
    await dash.waitForSelector('text=全部片段');
    await dash.screenshot({ path: shot('dashboard-video.png') });
    await dash.click('main nav >> text=调用记录');
    await dash.waitForSelector('text=次调用', { timeout: 10000 });
    assert(true, 'video detail shows segments and traces');
    const md = await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'EXPORT_MARKDOWN', videoId: id }), `${BVID}_4242`);
    assert(md.ok && md.data.includes('## 章节') && md.data.includes('https://www.bilibili.com/video/BV1e2e4y1Tst?t='), 'markdown export has chapters and timestamp links');

    await page.screenshot({ path: shot('overlay-search.png') });
    await dash.screenshot({ path: shot('dashboard-trace.png') });
    console.log('\nE2E passed');
  } finally {
    await ctx.close();
    mock.server.close();
    rmSync(userDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

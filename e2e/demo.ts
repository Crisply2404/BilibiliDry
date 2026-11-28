/**
 * Smoke test of the built online demo (`npm run demo:build` first):
 *
 *   PW_CHROMIUM=/path/to/chromium npm run e2e:demo
 *
 * The demo's scripted model recognises requests by the extension's own prompts, so a prompt
 * change the demo does not follow would leave it silently broken. This runs the visitor's path:
 * Bilibili's summary, analysis onto the progress bar, the skip button, a question, the library
 * agent, the dashboard.
 */
import { chromium, type Page } from 'playwright-core';
import { preview } from 'vite';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
}

const panelText = (page: Page) => page.evaluate(() => (document.querySelector('.sidepanel-body')?.shadowRoot?.querySelector('div') as HTMLElement | null)?.innerText ?? '');

async function waitPanel(page: Page, text: string, timeout = 30000) {
  try {
    await page.waitForFunction((t) => ((document.querySelector('.sidepanel-body')?.shadowRoot?.querySelector('div') as HTMLElement | null)?.innerText ?? '').includes(t), text, { timeout });
  } catch (err) {
    console.error(`side panel text while waiting for "${text}":\n${(await panelText(page)).slice(0, 800)}`);
    throw err;
  }
}

const panel = (page: Page) => page.locator('.sidepanel-body');

async function main() {
  const server = await preview({ configFile: 'vite.demo.config.ts', preview: { port: 0, strictPort: false } });
  const origin = server.resolvedUrls?.local[0];
  if (!origin) throw new Error('vite preview did not report a URL');
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin);
    await page.waitForURL(/\/video\/BV1dryAgent1\//);
    await page.waitForSelector('.bpx-player-container #bilibilidry-host', { state: 'attached', timeout: 15000 });
    assert(true, 'landing redirects to the first video and the real player layer mounts in the player');

    await waitPanel(page, 'B 站 AI 总结');
    assert(true, 'side panel shows Bilibili\'s own summary before any analysis');

    await panel(page).locator('button', { hasText: '分析这个视频' }).click();
    await waitPanel(page, 'Agent = 大模型 + 循环 + 工具');
    assert((await page.locator('.bdry-progress div div').count()) >= 10, 'whole-video analysis drew every segment on the progress bar');

    await page.waitForFunction(() => (document.getElementById('bilibilidry-host')?.shadowRoot?.textContent ?? '').includes('跳过寒暄'), null, { timeout: 10000 });
    assert(true, 'skip button shows inside the player during the intro filler');

    await panel(page).locator('nav button', { hasText: '问答' }).click();
    await panel(page).locator('button', { hasText: '有没有提到具体的数据或例子' }).click();
    await waitPanel(page, '处引用和字幕对得上');
    assert((await panelText(page)).includes('二零二二年'), 'question answered with line citations');

    await page.locator('.next-status button').click();
    await page.waitForFunction(() => document.querySelector('.next-status')?.textContent?.includes('已分析'), null, { timeout: 30000 });
    await panel(page).locator('nav button', { hasText: '知识库' }).click();
    await panel(page).locator('button', { hasText: '问知识库' }).click();
    await panel(page).locator('textarea').fill('哪个视频讲过焯水？');
    await panel(page).locator('textarea').press('Enter');
    await waitPanel(page, '调用了 1 次工具');
    assert((await panelText(page)).includes('十年老厨师教你做红烧肉'), 'library agent searched both videos and cited the right one');

    const dash = await context.newPage();
    await dash.goto(new URL('dashboard.html', page.url().replace(/video\/.*$/, '')).href);
    await dash.waitForFunction(() => /2 个视频/.test(document.body.innerText), null, { timeout: 10000 });
    assert(true, 'dashboard lists both videos');
    assert(errors.length === 0, `no page errors (${errors.join('; ')})`);
    console.log('\nDemo E2E passed');
  } finally {
    await browser.close();
    await new Promise((r) => server.httpServer.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

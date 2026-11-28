/**
 * Smoke test of the built online demo (`npm run demo:build` first):
 *
 *   PW_CHROMIUM=/path/to/chromium npm run e2e:demo
 *
 * The demo's scripted model recognises requests by the extension's own prompts, so a prompt
 * change the demo does not follow would leave it silently broken. This runs the visitor's path:
 * Bilibili's summary in the right-column card, analysis onto the progress bar, the skip button,
 * a question, the drawer in web fullscreen, the library agent, the dashboard.
 */
import { chromium, type Page } from 'playwright-core';
import { preview } from 'vite';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
}

const cardText = () => (document.getElementById('bilibilidry-card')?.shadowRoot?.querySelector('div') as HTMLElement | null)?.innerText ?? '';
const panelText = (page: Page) => page.evaluate(cardText);

async function waitPanel(page: Page, text: string, timeout = 30000) {
  try {
    await page.waitForFunction(`(${cardText})().includes(${JSON.stringify(text)})`, null, { timeout });
  } catch (err) {
    console.error(`panel text while waiting for "${text}":\n${(await panelText(page)).slice(0, 800)}`);
    throw err;
  }
}

/** The panel card the content script puts in the right column (Playwright locators pierce its shadow root). */
const panel = (page: Page) => page.locator('#bilibilidry-card');

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
    assert(await page.locator('.right-container-inner > #bilibilidry-card + .video-pod-above-modules').count(), 'panel card sits in the right column, above the danmaku list');
    assert(true, 'the card shows Bilibili\'s own summary before any analysis');

    await panel(page).locator('button', { hasText: '分析这个视频' }).click();
    await waitPanel(page, 'Agent = 大模型 + 循环 + 工具');
    assert((await page.locator('.bdry-progress div div').count()) >= 10, 'whole-video analysis drew every segment on the progress bar');

    await page.waitForFunction(() => (document.getElementById('bilibilidry-host')?.shadowRoot?.textContent ?? '').includes('跳过寒暄'), null, { timeout: 10000 });
    assert(true, 'skip button shows inside the player during the intro filler');

    await panel(page).locator('nav button', { hasText: '问答' }).click();
    await panel(page).locator('button', { hasText: '有没有提到具体的数据或例子' }).click();
    await waitPanel(page, '处引用和字幕对得上');
    assert((await panelText(page)).includes('二零二二年'), 'question answered with line citations');

    await page.locator('.bpx-player-container button[aria-label="网页全屏"]').click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('bilibilidry-card')!).display === 'none', null, { timeout: 5000 });
    await page.locator('#bilibilidry-host button[title="打开 BilibiliDry"]').click({ force: true });
    await page.waitForFunction(() => (document.getElementById('bilibilidry-host')?.shadowRoot?.textContent ?? '').includes('只看这几段'), null, { timeout: 5000 });
    assert(true, 'in web fullscreen the card gives way to a drawer inside the player');
    await page.locator('#bilibilidry-host button[title="关闭"]').click();
    await page.locator('.bpx-player-container button[aria-label="退出网页全屏"]').click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('bilibilidry-card')!).display === 'block', null, { timeout: 5000 });

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

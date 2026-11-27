/**
 * Smoke test of the built online demo (`npm run demo:build` first):
 *
 *   PW_CHROMIUM=/path/to/chromium npm run e2e:demo
 *
 * The demo's scripted model recognises requests by the extension's own
 * prompts, so a prompt change that the demo does not follow would leave the
 * demo silently broken. This runs the visitor's path: analyse, ask the
 * suggested questions, search across videos, open the dashboard.
 */
import { chromium, type Page } from 'playwright-core';
import { preview } from 'vite';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
}

const panelText = (page: Page) => page.evaluate(() => document.getElementById('bilibilidry-host')?.shadowRoot?.querySelector('div')?.textContent ?? '');

async function waitPanel(page: Page, text: string, timeout = 30000) {
  try {
    await page.waitForFunction((t) => (document.getElementById('bilibilidry-host')?.shadowRoot?.querySelector('div')?.textContent ?? '').includes(t), text, { timeout });
  } catch (err) {
    console.error(`panel text while waiting for "${text}":\n${(await panelText(page)).slice(0, 800)}`);
    throw err;
  }
}

const click = (page: Page, text: string) => page.locator('#bilibilidry-host button', { hasText: text }).first().click();

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
    await waitPanel(page, '分析这个视频');
    assert(true, 'landing redirects to the first video and the real panel mounts');

    await click(page, '分析这个视频');
    await waitPanel(page, '只看这几段');
    const overview = await panelText(page);
    assert(overview.includes('Agent = 大模型 + 循环 + 工具'), 'analysis pipeline ran against the scripted model (TL;DR shown)');
    assert(/12 个片段/.test(overview), 'every fixture block became a segment');

    await click(page, '问答');
    await click(page, '这个视频讲了哪几件事');
    await waitPanel(page, '处引用有字幕证据');
    assert(/(\d+)\/\1 处引用有字幕证据/.test(await panelText(page)), 'outline answer: every citation grounded');

    // Suggested questions only show on an empty chat; later questions go through the input box.
    await page.locator('#bilibilidry-host textarea').fill('有没有提到具体的数据或例子？');
    await page.locator('#bilibilidry-host textarea').press('Enter');
    await page.waitForFunction(() => (document.getElementById('bilibilidry-host')?.shadowRoot?.querySelector('div')?.textContent ?? '').split('处引用有字幕证据').length === 3, null, { timeout: 30000 });
    const chat = await panelText(page);
    assert(chat.includes('调用了 4 次工具') && chat.includes('二零二二年'), 'multi-step tool use answered the data question');

    await page.locator('.next-status button').click();
    await page.waitForFunction(() => document.querySelector('.next-status')?.textContent?.includes('已分析'), null, { timeout: 30000 });
    await click(page, '搜索');
    await page.locator('#bilibilidry-host label', { hasText: '知识库' }).locator('input').check();
    await page.locator('#bilibilidry-host input.input').fill('开水');
    await page.locator('#bilibilidry-host input.input').press('Enter');
    await waitPanel(page, '十年老厨师教你做红烧肉');
    assert(true, 'second video analysed in the background and found by library search');

    const dash = await context.newPage(); // same context, so the same IndexedDB as the video page
    await dash.goto(new URL('dashboard.html', page.url().replace(/video\/.*$/, '')).href);
    try {
      await dash.waitForFunction(() => /2 个视频/.test(document.body.innerText), null, { timeout: 10000 });
    } catch (err) {
      console.error(`dashboard text:\n${(await dash.evaluate(() => document.body.innerText)).slice(0, 600)}`);
      throw err;
    }
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

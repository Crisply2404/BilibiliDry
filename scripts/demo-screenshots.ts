/**
 * Retake the README screenshots from the built online demo (`npm run demo:build` first):
 *
 *   PW_CHROMIUM=/path/to/chromium npx tsx scripts/demo-screenshots.ts
 */
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { preview } from 'vite';

const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs', 'screenshots');
const panel = (page: Page) => page.locator('.sidepanel-body');
const waitPanel = (page: Page, text: string) =>
  page.waitForFunction((t) => ((document.querySelector('.sidepanel-body')?.shadowRoot?.querySelector('div') as HTMLElement | null)?.innerText ?? '').includes(t), text, { timeout: 30000 });

async function main() {
  const server = await preview({ configFile: 'vite.demo.config.ts', preview: { port: 0, strictPort: false } });
  const origin = server.resolvedUrls!.local[0];
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 })).newPage();
    await page.goto(`${origin}video/BV1dryAgent1/`);
    await waitPanel(page, 'B 站 AI 总结');
    await page.screenshot({ path: path.join(OUT, 'official-summary.png'), clip: { x: 1040, y: 56, width: 400, height: 560 } });

    await panel(page).locator('button', { hasText: '分析这个视频' }).click();
    await waitPanel(page, 'Agent = 大模型 + 循环 + 工具');
    // Park the playhead in the sponsor read so the skip button is on screen.
    await page.evaluate(() => {
      const v = document.querySelector('video')!;
      v.currentTime = 95;
    });
    await page.waitForFunction(() => (document.getElementById('bilibilidry-host')?.shadowRoot?.textContent ?? '').includes('跳过广告'), null, { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'player-and-panel.png'), clip: { x: 0, y: 56, width: 1440, height: 600 } });

    await panel(page).locator('nav button', { hasText: '问答' }).click();
    await panel(page).locator('button', { hasText: '有没有提到具体的数据或例子' }).click();
    await waitPanel(page, '处引用和字幕对得上');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, 'qa.png'), clip: { x: 1040, y: 56, width: 400, height: 640 } });
    console.log(`screenshots written to ${OUT}`);
  } finally {
    await browser.close();
    await new Promise((r) => server.httpServer.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

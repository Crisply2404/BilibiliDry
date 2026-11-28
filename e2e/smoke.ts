/**
 * End-to-end test of the built extension (`npm run build` first):
 *
 *   PW_CHROMIUM=/path/to/chromium npm run e2e
 *
 * Bilibili's page and APIs are served from fixtures via request routing (the page imitates the
 * "bpx" player's DOM, with a real video file), and the model is a local mock, so the run is
 * hermetic. It walks the real paths: service worker boot, settings, Bilibili's AI summary
 * without a key in the right-column card, whole-video analysis streamed into the card and onto
 * the progress bar, the in-player skip button, a question with a line citation (typing must not
 * reach Bilibili's shortcuts), the toolbar toggle, the drawer when the right column is gone, the
 * library agent, the dashboard and Markdown export.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { buildFixture, FIXTURES } from '../eval/fixtures/build';
import { startMockLlm } from './mockLlm';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'test-results', 'e2e');
const BVID = 'BV1e2e4y1Tst';
const CID = 4242;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
}

const shadowText = (page: Page) => page.evaluate(() => document.getElementById('bilibilidry-host')?.shadowRoot?.textContent ?? '');

async function waitFor(page: Page, fn: () => boolean | Promise<boolean>, what: string, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const built = buildFixture(FIXTURES[0]);
  const mock = await startMockLlm();
  const userDir = mkdtempSync(path.join(tmpdir(), 'bdry-e2e-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    executablePath: process.env.PW_CHROMIUM,
    headless: false,
    viewport: { width: 1360, height: 820 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--headless=new', '--no-first-run', '--autoplay-policy=no-user-gesture-required']
  });
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
    const extId = new URL(sw.url()).host;
    assert(extId.length > 10, `service worker booted (${extId})`);

    const lines = built.lines;
    const media = readFileSync(path.join(ROOT, 'demo/public/media/agent-intro.mp4'));
    await ctx.route('https://www.bilibili.com/video/**', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body style="margin:0;background:#fff"><div id="app" data-server-rendered="true" style="display:flex;gap:24px">
          <div class="left-container" style="padding-top:96px">
            <div class="bpx-player-container" data-screen="normal" style="position:relative;width:900px;height:506px;background:#000">
              <video src="https://media.e2e.test/agent-intro.mp4" muted style="width:900px;height:506px"></video>
              <div class="bpx-player-progress-wrap" style="position:absolute;left:12px;right:12px;bottom:70px;height:16px">
                <div class="bpx-player-progress"><div class="bpx-player-progress-schedule-wrap" style="position:relative;height:4px;background:rgba(255,255,255,.3)"></div></div>
              </div>
            </div>
          </div>
          <div class="right-container" style="width:350px;pointer-events:none">
            <div class="right-container-inner">
              <div class="up-panel-container" style="height:96px;pointer-events:all">UP</div>
              <div class="video-pod-above-modules"><div id="danmukuBox" class="danmaku-box">弹幕列表</div></div>
            </div>
          </div>
          </div>
          <script>
            window.__keys = 0;
            document.addEventListener('keydown', () => window.__keys++);
            // Stand-in for Vue's hydration: it fails if anything foreign got into the server-rendered markup first.
            setTimeout(() => {
              const app = document.getElementById('app');
              window.__hydrationClean = !app.querySelector('#bilibilidry-card, #bilibilidry-host, .bdry-progress');
              app.removeAttribute('data-server-rendered');
            }, 2500);
          </script>
          </body></html>`
      })
    );
    await ctx.route('https://media.e2e.test/**', (r) => r.fulfill({ contentType: 'video/mp4', body: media }));
    await ctx.route('https://api.bilibili.com/x/web-interface/view?**', (r) =>
      r.fulfill({ json: { code: 0, data: { bvid: BVID, aid: 42, cid: CID, title: built.video.title, duration: built.video.durationSec, owner: { name: '测试UP', mid: 7 }, pages: [{ cid: CID, page: 1, part: 'P1', duration: built.video.durationSec }] } } })
    );
    await ctx.route('https://api.bilibili.com/x/web-interface/nav**', (r) =>
      r.fulfill({ json: { code: -101, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } } })
    );
    await ctx.route('https://api.bilibili.com/x/web-interface/view/conclusion/get**', (r) =>
      r.fulfill({
        json: {
          code: 0,
          data: {
            code: 0,
            model_result: {
              summary: 'B站官方总结：Agent 等于大模型加循环加工具。',
              outline: [{ title: 'Agent 的定义', timestamp: 20, part_outline: [{ timestamp: 25, content: '大模型、循环、工具' }] }],
              subtitle: [{ part_subtitle: lines.map((l) => ({ start_timestamp: l.from, end_timestamp: l.to, content: l.text })) }]
            }
          }
        }
      })
    );

    // Settings, written the way the options page stores them.
    const optionsUrl = `chrome-extension://${extId}/options.html`;
    await new Promise((r) => setTimeout(r, 1500));
    assert(ctx.pages().some((p) => p.url().startsWith(optionsUrl)), 'first install opens the options page');
    const ext = await ctx.newPage();
    await ext.goto(optionsUrl);
    await ext.waitForSelector('text=模型服务');
    await ext.evaluate((baseUrl) => chrome.storage.local.set({ 'settings.v1': { provider: 'custom', baseUrl, apiKey: 'test-key', model: 'mock', reasoning: 'off', developerMode: true, showOnProgress: true } }), mock.baseUrl);

    const page = await ctx.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(`https://www.bilibili.com/video/${BVID}`);
    await waitFor(page, async () => (await page.locator('.bpx-player-container #bilibilidry-host').count()) > 0, 'player layer host');
    assert(await page.evaluate(() => (window as unknown as { __hydrationClean?: boolean }).__hydrationClean === true), 'nothing is inserted before the page finishes hydrating');
    assert(true, 'player layer mounted inside the player container');
    await waitFor(page, async () => (await page.locator('.bdry-progress div div').count()) > 0, 'outline marks on the progress bar');
    assert(true, 'without analysis the progress bar shows the official outline marks');

    // The panel card in the right column; Playwright locators pierce its shadow root.
    const panel = page.locator('#bilibilidry-card');
    await panel.locator('h4', { hasText: 'B 站 AI 总结' }).waitFor({ timeout: 15000 });
    assert(await page.locator('.right-container-inner > #bilibilidry-card + .video-pod-above-modules').count(), 'panel card sits in the right column, above the danmaku list');
    assert(await panel.locator('text=B站官方总结').count(), 'the card shows Bilibili\'s own summary');
    const [cardBox, playerBox] = await Promise.all([panel.boundingBox(), page.locator('.bpx-player-container').boundingBox()]);
    assert(cardBox && playerBox && Math.abs(cardBox.y - playerBox.y) <= 2 && Math.abs(cardBox.height - playerBox.height) <= 2, 'the card is level with the player and as tall');

    await panel.locator('button:has-text("分析这个视频")').click();
    await panel.locator('text=这是一期讲 Agent 基础的视频').waitFor({ timeout: 30000 });
    assert(await panel.locator('text=只看这几段').count(), 'whole-video analysis finished: TL;DR and highlights in the card');
    assert(mock.calls.filter((c) => c === 'analysis').length === 1, 'one model call for the whole video');

    await waitFor(page, async () => (await page.locator('.bdry-progress div div').count()) >= 3, 'segments on the progress bar');
    assert(true, 'segments drawn on Bilibili\'s progress bar');
    await page.evaluate(() => {
      const v = document.querySelector('video')!;
      v.currentTime = 1;
      void v.play();
    });
    await waitFor(page, async () => (await shadowText(page)).includes('跳过寒暄'), 'skip button during the intro filler');
    await page.locator('#bilibilidry-host button', { hasText: '跳过' }).click();
    await waitFor(page, async () => (await page.evaluate(() => document.querySelector('video')!.currentTime)) > lines[4].from, 'jump past the filler');
    assert(true, 'in-player skip button jumps past filler');
    await page.screenshot({ path: path.join(SHOTS, 'player-and-card.png') });

    await panel.locator('nav button:has-text("问答")').click();
    const keysBefore = await page.evaluate(() => (window as unknown as { __keys: number }).__keys);
    await panel.locator('textarea').pressSequentially('ReAct 是什么？');
    assert((await page.evaluate(() => (window as unknown as { __keys: number }).__keys)) === keysBefore, 'typing in the card does not reach the page\'s keyboard shortcuts');
    await panel.locator('textarea').press('Enter');
    await panel.locator('text=处引用和字幕对得上').waitFor({ timeout: 20000 });
    assert(await panel.locator('text=ReAct 就是推理加行动').count(), 'question answered from the full transcript');
    assert(await panel.locator('button.ts').count(), 'the [L…] citation renders as a time button');

    // The toolbar button: the service worker sends TOGGLE_PANEL to the tab.
    const tabId = await ext.evaluate(async (bvid) => (await chrome.tabs.query({ url: `https://www.bilibili.com/video/${bvid}*` }))[0]?.id, BVID);
    const toggle = () => ext.evaluate((id) => chrome.tabs.sendMessage(id!, { type: 'TOGGLE_PANEL' }), tabId);
    await toggle();
    await waitFor(page, async () => (await panel.locator('nav').count()) === 0, 'card collapsed to its header');
    await toggle();
    await waitFor(page, async () => (await panel.locator('nav').count()) === 1, 'card expanded again');
    assert(true, 'the toolbar button collapses and expands the card');

    // Web fullscreen: no right column, so the panel becomes a drawer inside the player.
    // Bilibili's web fullscreen lays the player over the whole window.
    await page.evaluate(() => {
      const p = document.querySelector<HTMLElement>('.bpx-player-container')!;
      p.setAttribute('data-screen', 'web');
      p.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;background:#000;z-index:10';
    });
    await waitFor(page, async () => (await page.evaluate(() => getComputedStyle(document.getElementById('bilibilidry-card')!).display)) === 'none', 'card hidden in web fullscreen');
    await page.locator('#bilibilidry-host button[title="打开 BilibiliDry"]').click({ force: true });
    const drawer = page.locator('#bilibilidry-host');
    const [drawerBox, barBox] = await Promise.all([drawer.locator('[data-bdry-drawer]').boundingBox(), page.locator('.bpx-player-progress-schedule-wrap').boundingBox()]);
    assert(drawerBox && barBox && drawerBox.y + drawerBox.height < barBox.y - 7, 'the drawer stops above the progress bar and our strip');
    await drawer.locator('nav button:has-text("知识库")').click();
    await drawer.locator('button:has-text("问知识库")').click();
    await drawer.locator('textarea').fill('哪个视频讲过 ReAct？');
    await drawer.locator('textarea').press('Enter');
    await drawer.locator('text=调用了 1 次工具').waitFor({ timeout: 20000 });
    assert(await drawer.locator(`text=知识库里《大模型 Agent 入门》讲过`).count(), 'in the drawer: library agent searched, then answered with a cross-video citation');
    await page.screenshot({ path: path.join(SHOTS, 'drawer-library.png') });

    const dash = await ctx.newPage();
    await dash.goto(`chrome-extension://${extId}/dashboard.html`);
    await dash.waitForSelector(`text=${built.video.title.slice(0, 10)}`, { timeout: 10000 });
    await dash.click(`text=${built.video.title.slice(0, 10)}`);
    await dash.waitForSelector('text=全部片段');
    await dash.click('main nav >> text=调用记录');
    await dash.waitForSelector('text=次调用', { timeout: 10000 });
    assert(true, 'dashboard shows the video, its segments and call records');
    const md = await dash.evaluate((id) => chrome.runtime.sendMessage({ type: 'EXPORT_MARKDOWN', videoId: id }), `${BVID}_${CID}`);
    assert(md.ok && md.data.includes('## 章节') && md.data.includes(`https://www.bilibili.com/video/${BVID}?t=`), 'markdown export has chapters and timestamp links');
    assert(pageErrors.length === 0, `no page errors (${pageErrors.join('; ')})`);
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

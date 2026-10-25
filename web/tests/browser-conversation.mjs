/* global window, document, CustomEvent */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startConversationServer } from './conversation-server.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const directory = process.env.AGENTDECK_WEB_TEST_DIR || '.tmp/web-conversation';
mkdirSync(directory, { recursive: true });
const { vite, state, origin } = await startConversationServer({
  cacheDir: join(process.cwd(), directory, 'vite-cache'),
});
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === 'win32' ? 'msedge' : undefined,
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const errors = [],
    remoteImages = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => {
    if (req.url().includes('example.invalid')) remoteImages.push(req.url());
  });
  await page.goto(origin);
  await page.locator('.rich-content h1').waitFor();
  assert.equal(await page.locator('.rich-content strong').innerText(), '加粗');
  assert.equal(await page.locator('.rich-content pre code').innerText(), 'const answer = 42;\n');
  assert.equal(await page.locator('.rich-content table').count(), 1);
  assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
  assert.equal(await page.locator('.rich-content script').count(), 0);
  assert.equal(await page.getByRole('button', { name: '其他项目会话', exact: true }).count(), 0);
  assert.equal(await page.locator('.tool-record').getAttribute('open'), null);
  const dimensions = await page.evaluate(() => ({
    body: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
    width: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    timeline: document.querySelector('.timeline').clientHeight,
  }));
  assert.ok(
    dimensions.body <= dimensions.viewport + 2,
    'long tools must not expand the entire page',
  );
  assert.ok(dimensions.width <= dimensions.viewportWidth, 'no horizontal document overflow');
  assert.ok(dimensions.timeline > 200);
  assert.equal(await page.locator('.tool-preview').innerText(), 'local acceptance command');
  await page.locator('.tool-record > summary').click();
  assert.equal(await page.locator('pre.command').innerText(), 'local acceptance command');
  assert.equal(await page.locator('.original-command').getAttribute('open'), null);
  await page.locator('.original-command > summary').click();
  assert.ok((await page.locator('.original-command pre').innerText()).includes('powershell.exe'));
  await page.locator('.original-command > summary').click();
  assert.ok(
    (await page.locator('.tool-body > pre').last().innerText()).includes('bounded tool output'),
  );
  await page.locator('.tool-record > summary').click();
  await page.screenshot({ path: join(directory, 'desktop.png') });

  // Full App pagination and updates, preserving native identity and viewport.
  await page.locator('[data-connection-state="connected"]').waitFor();
  await page.locator('.timeline').focus();
  await page.keyboard.press('Home');
  await page.getByText('较早的消息 0', { exact: false }).waitFor();
  await page.locator('.timeline').evaluate((node) => {
    node.scrollTop = 600;
  });
  await page.waitForTimeout(150);
  const anchor = await page.locator('[data-history-key]').first().boundingBox();
  state.extra.push({
    turnId: 'native-turn',
    item: { id: 'new', type: 'agentMessage', text: '持续输出的新消息' },
  });
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('test-packet', {
        detail: {
          type: 'event',
          sessionId: 's1',
          action: 'turn.progress',
          payload: {
            method: 'item/agentMessage/delta',
            turnId: 'native-turn',
            itemId: 'new',
            delta: '持续输出的新消息',
          },
        },
      }),
    ),
  );
  await page.getByText('持续输出的新消息', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-history-key]').length === 34);
  assert.equal(await page.locator('[data-history-key]').count(), 34);
  const after = await page.locator('[data-history-key]').first().boundingBox();
  assert.ok(Math.abs(anchor.y - after.y) < 2, 'updates retain old-page reading position');
  assert.equal(
    await page.getByRole('button', { name: '加载更早记录' }).count(),
    0,
    'latest refresh must not reset older cursor',
  );

  // Late reads cannot show old conversation under a new title.
  await page.getByRole('button', { name: '另一会话', exact: true }).click();
  await page.getByText('另一会话的正文', { exact: true }).waitFor();
  state.delay = true;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('test-packet', {
        detail: { type: 'event', sessionId: 's1', action: 'session.updated' },
      }),
    ),
  );
  await page.getByRole('button', { name: '渲染验收', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.empty')?.textContent.includes('正在读取'),
  );
  await page.getByRole('button', { name: '另一会话', exact: true }).click();
  state.delay = false;
  while (state.pending.length) state.pending.shift()();
  await page.getByText('另一会话的正文', { exact: true }).waitFor();
  assert.equal(await page.getByText('持续输出的新消息', { exact: true }).count(), 0);
  state.blocked = true;
  await page.getByRole('button', { name: '渲染验收', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.ok((await page.getByRole('alert').innerText()).includes('工作目录已变化'));
  assert.equal(await page.locator('.turn').count(), 0);
  assert.equal(await page.locator('textarea').isDisabled(), true);
  state.blocked = false;
  await page.getByRole('button', { name: '重试读取' }).click();
  await page.locator('.rich-content h1').waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByLabel('项目', { exact: true }).selectOption('p2');
  assert.equal(await page.locator('.turn').count(), 0);
  await page.getByRole('button', { name: '其他项目会话', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '渲染验收', exact: true }).count(), 0);
  await page.getByRole('button', { name: '其他项目会话', exact: true }).click();
  await page.getByText('另一会话的正文', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: join(directory, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(remoteImages, []);
  console.log(
    'Real App browser acceptance passed: Markdown, tools, safety, pagination, live updates, stale reads, workspace errors, project isolation, desktop/mobile layout. Controlled host responses; no production pairing/model claim.',
  );
} finally {
  await browser?.close();
  await vite.close();
}

/* global window, document */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startConversationServer } from './conversation-server.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const directory = resolve('artifacts/web-settings');
mkdirSync(directory, { recursive: true });
const { vite, origin } = await startConversationServer({
  cacheDir: resolve('.tmp/web-settings'),
  showNotice: false,
});
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === 'win32' ? 'msedge' : undefined,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator('.rich-content h1').waitFor();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const nav = page.getByRole('navigation', { name: '设置分类' });
  const box = async () =>
    dialog.evaluate((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      const close = node.querySelector('.modal-title button').getBoundingClientRect();
      return { x, y, width, height, closeX: close.x, closeY: close.y };
    });
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 390, height: 430 },
  ]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark']) {
      await nav.getByRole('button', { name: '常规', exact: true }).click();
      await page.getByLabel('外观', { exact: true }).selectOption(theme);
      const baseline = await box();
      const names = await nav.getByRole('button').allTextContents();
      assert.equal(names.length, 8);
      for (const name of names) {
        await nav.getByRole('button', { name, exact: true }).click();
        await page.locator('#settings-heading').filter({ hasText: name }).waitFor();
        assert.deepEqual(await box(), baseline, `${name}: fixed dialog and close position`);
        assert.equal(await nav.locator('[aria-current="page"]').innerText(), name);
        assert.ok(
          await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
          'no dialog overflow',
        );
      }
      await nav.getByRole('button', { name: '常规', exact: true }).click();
      await page.locator('.settings-body').evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      assert.deepEqual(await box(), baseline, 'content scrolling keeps chrome fixed');
      await dialog
        .getByRole('button', { name: '退出账户', exact: true })
        .waitFor({ state: 'visible' });
      const close = await dialog.getByRole('button', { name: '关闭', exact: true }).boundingBox();
      assert.ok(close.y >= 0 && close.y + close.height <= viewport.height, 'close remains visible');
      assert.ok(
        await page.evaluate(
          () => window.scrollY === 0 && document.documentElement.scrollWidth <= window.innerWidth,
        ),
      );
      await page.locator('.settings-body').evaluate((node) => {
        node.scrollTop = 0;
      });
      await page
        .locator('.settings-body')
        .evaluate((node) =>
          Promise.all(node.getAnimations().map((animation) => animation.finished)),
        );
      await page.screenshot({
        path: resolve(directory, `settings-${viewport.width}x${viewport.height}-${theme}.png`),
      });
    }
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log(
    'Settings passed: eight categories retain dialog height/position, independent scrolling, themes, narrow screens, landscape, short viewport and Escape. No model or real account changes.',
  );
} finally {
  await browser?.close();
  await vite.close();
}

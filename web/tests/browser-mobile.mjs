/* global window, document */
// Controlled host responses verify the real conversation layout, without a model call.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startConversationServer } from './conversation-server.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const directory = resolve('artifacts/web-pwa');
mkdirSync(directory, { recursive: true });
const { vite, origin } = await startConversationServer({ cacheDir: resolve('.tmp/web-mobile') });
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === 'win32' ? 'msedge' : undefined,
  });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(origin);
  await page.locator('.rich-content h1').waitFor();
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 390, height: 480 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('textbox', { name: '消息', exact: true }).focus();
    await page.waitForFunction(
      () =>
        Math.abs(
          parseFloat(document.documentElement.style.getPropertyValue('--app-height')) -
            window.visualViewport.height,
        ) < 2,
    );
    const box = await page.locator('.composer').boundingBox();
    assert.ok(
      box.y >= 0 && box.y + box.height <= viewport.height + 1,
      'composer stays inside the visible viewport',
    );
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'no sideways document scroll',
    );
    await page.screenshot({
      path: resolve(directory, `conversation-${viewport.width}x${viewport.height}.png`),
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开会话列表', exact: true }).click();
  assert.equal(await page.locator('.project-list select').count(), 0);
  await page.locator('.project-list').getByRole('button', { name: '项目二', exact: true }).click();
  await page.getByRole('button', { name: '其他项目会话', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '渲染验收', exact: true }).count(), 0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByText('添加到主屏幕', { exact: true }).click();
  await page.getByText(/iPhone \/ iPad/).waitFor();
  console.log(
    'Mobile layout passed: conversation portrait, short viewport, landscape, reachable composer and settings installation help. Desktop emulation; physical keyboard/safe-area behavior remains unverified.',
  );
} finally {
  await browser?.close();
  await vite.close();
}

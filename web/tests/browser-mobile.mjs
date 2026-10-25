/* global window, document, navigator, Event, EventTarget */
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
const { vite, origin } = await startConversationServer({
  cacheDir: resolve('.tmp/web-mobile'),
  showNotice: false,
});
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
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    const native = window.visualViewport;
    const viewport = new EventTarget();
    let state = {};
    for (const key of ['height', 'offsetTop', 'scale'])
      Object.defineProperty(viewport, key, { get: () => state[key] ?? native[key] });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
    window.setTestViewport = (next, event = 'resize') => {
      state = next;
      viewport.dispatchEvent(new Event(event));
    };
    native.addEventListener('resize', () => viewport.dispatchEvent(new Event('resize')));
  });
  const assertBottom = async (height, top = 0) => {
    await page.waitForFunction(
      ({ height, top }) => {
        const shell = document.querySelector('.shell').getBoundingClientRect();
        const composer = document.querySelector('.composer-wrap').getBoundingClientRect();
        const style = window.getComputedStyle(document.querySelector('.shell'));
        return (
          Math.abs(shell.top - top) < 1 &&
          Math.abs(shell.bottom - top - height) < 1 &&
          Math.abs(composer.bottom + parseFloat(style.paddingBottom) - shell.bottom) < 1 &&
          composer.top >= top &&
          window.scrollY === 0
        );
      },
      { height, top },
    );
  };
  await page.goto(origin);
  await page.locator('.rich-content h1').waitFor();
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 390, height: 480 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('textbox', { name: '消息', exact: true }).focus();
    await assertBottom(viewport.height);
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
  await assertBottom(844);
  assert.equal(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height')),
    '844px',
    'installed window uses its layout height independently of Safari dvh',
  );
  // iOS standalone may retain a toolbar-sized visual viewport reduction without a keyboard.
  await page.evaluate(() => window.setTestViewport({ height: 774, offsetTop: 0, scale: 1 }));
  await assertBottom(844);
  for (const empty of [false, true]) {
    if (empty) {
      await page.getByRole('button', { name: '新建会话', exact: true }).click();
      await page.getByRole('heading', { name: 'What can we build?', exact: true }).waitFor();
    }
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('保留输入草稿\n第二行');
    await page.evaluate(() => window.setTestViewport({ height: 430, offsetTop: 0, scale: 1 }));
    await assertBottom(430);
    // A pan-only event must move the shell with the visual viewport, without a second resize.
    await page.evaluate(() =>
      window.setTestViewport({ height: 430, offsetTop: 96, scale: 1 }, 'scroll'),
    );
    await assertBottom(430, 96);
    await page.screenshot({
      path: resolve(directory, `keyboard-${empty ? 'empty' : 'conversation'}.png`),
    });
    // Pinch zoom does not reflow the app to the zoomed viewport size.
    await page.evaluate(() => window.setTestViewport({ height: 215, offsetTop: 120, scale: 2 }));
    await assertBottom(430, 96);
    // Dismissing a keyboard can leave the textarea focused.
    await page.evaluate(() => window.setTestViewport({ height: 774, offsetTop: 0, scale: 1 }));
    await assertBottom(844);
    assert.equal(
      await page.getByLabel('消息', { exact: true }).inputValue(),
      '保留输入草稿\n第二行',
    );
  }
  await page.evaluate(() => window.setTestViewport({}));
  await page.getByRole('button', { name: '打开会话列表', exact: true }).click();
  assert.equal(await page.locator('.project-list select').count(), 0);
  await page.locator('.project-list').getByRole('button', { name: '项目二', exact: true }).click();
  await page.getByRole('button', { name: '其他项目会话', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '渲染验收', exact: true }).count(), 0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await page.getByText('添加到主屏幕', { exact: true }).count(), 0,
    'installed app hides the installation prompt');
  console.log(
    'Mobile layout passed: portrait/landscape, composer flush with viewport bottom, standalone viewport mismatch, keyboard resize/pan/dismissal, pinch zoom, empty conversation and retained drafts. Desktop emulation; physical keyboard/safe-area behavior remains unverified.',
  );
} finally {
  await browser?.close();
  await vite.close();
}

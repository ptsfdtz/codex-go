/* global document, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/sidebar-motion/', import.meta.url);
await mkdir(out, { recursive: true });
const origin = process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1495';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const checks = [],
  errors = [];
async function isolate(context) {
  await context.route('**/api/**', (route) =>
    route.fulfill({
      json: route.request().url().includes('/web/session')
        ? { accountId: 'motion-test', cloudDeviceId: 'browser' }
        : route.request().url().endsWith('/hosts')
          ? { hosts: [] }
          : {},
    }),
  );
}
try {
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1100, height: 750 },
  });
  await isolate(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator('.sidebar-brand').waitFor();
  const close = () => page.getByRole('button', { name: '收起会话列表', exact: true }).click();
  const mobileForward = () => page.locator('.sidebar-quick-compose').click();
  const open = () => page.getByRole('button', { name: '打开会话列表', exact: true }).click();
  const sample = (time) =>
    page.evaluate((time) => {
      const sidebar = document.querySelector('.sidebar');
      const content = document.querySelector('.conversation-layout');
      const scrim = document.querySelector('.sidebar-scrim');
      const animations = [sidebar, content, scrim].flatMap((node) => node.getAnimations());
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = time;
      }
      const rect = sidebar.getBoundingClientRect(),
        main = content.getBoundingClientRect();
      return {
        x: rect.x,
        sidebarWidth: rect.width,
        sidebarOpacity: Number(getComputedStyle(sidebar).opacity),
        left: main.left,
        width: main.width,
        visibility: getComputedStyle(sidebar).visibility,
        display: getComputedStyle(sidebar).display,
        opacity: Number(getComputedStyle(scrim).opacity),
        scrimDisplay: getComputedStyle(scrim).display,
        inert: sidebar.inert,
        durations: animations.map((animation) => animation.effect.getTiming().duration),
      };
    }, time);
  const finish = async () => {
    await page.evaluate(() => {
      for (const selector of ['.sidebar', '.conversation-layout', '.sidebar-scrim'])
        for (const animation of document.querySelector(selector).getAnimations())
          animation.finish();
    });
    await page.waitForTimeout(30);
  };
  await close();
  const start = await sample(0),
    middle = await sample(160),
    end = await sample(319);
  assert.deepEqual(start.durations, [320, 320]);
  assert.equal(start.left, start.sidebarWidth);
  assert(middle.x < 0 && middle.x > -middle.sidebarWidth);
  assert(middle.left > 0 && middle.left < start.left);
  assert(middle.width > start.width && middle.width < 1100);
  assert(
    Math.abs(middle.left + middle.width - 1100) < 1,
    'desktop content stays within the viewport throughout reflow',
  );
  assert(
    Math.abs(middle.sidebarWidth + middle.x - middle.left) < 1,
    'drawer edge and content gutter share one clock',
  );
  assert(
    end.inert && end.display === 'flex' && end.visibility === 'visible',
    'exiting drawer is drawn but cannot receive input',
  );
  await sample(160);
  await page.screenshot({ path: fileURLToPath(new URL('desktop-mid-close.png', out)) });
  // Reverse a partially completed close without snapping to either endpoint.
  await open();
  const reversed = await sample(0);
  assert(Math.abs(reversed.x - middle.x) < 1);
  assert(Math.abs(reversed.left - middle.left) < 1);
  await finish();
  assert.equal(
    await page.locator('.sidebar').evaluate((node) => node.getBoundingClientRect().x),
    0,
  );
  checks.push(
    'desktop: visible 320ms close/open, continuous content width, synchronized edges and interrupted reversal',
  );
  await close();
  await finish();
  assert.equal(
    await page.locator('.sidebar').evaluate((node) => getComputedStyle(node).visibility),
    'hidden',
  );
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await open();
    const initial = await sample(0),
      opening = await sample(160);
    assert(initial.x < 0 && opening.x > initial.x && opening.x < 0);
    assert(Math.abs(initial.x + initial.sidebarWidth / 3) < 1);
    assert(opening.sidebarOpacity > 0.8 && opening.sidebarOpacity < 1);
    assert(Math.abs(initial.left) < 1 && opening.left > 0 && opening.left < width);
    assert.equal(opening.scrimDisplay, 'none');
    await finish();
    await mobileForward();
    const closing = await sample(160);
    assert(closing.x < 0 && closing.x > -closing.sidebarWidth && closing.visibility === 'visible');
    assert(closing.left > 0 && closing.left < width);
    await page.screenshot({ path: fileURLToPath(new URL(`mobile-${width}-mid-close.png`, out)) });
    // Resizing during motion cancels stale desktop/mobile offsets.
    await page.setViewportSize({ width: width + 1, height: 844 });
    await page.waitForTimeout(30);
    assert.equal(await page.locator('.sidebar').evaluate((node) => node.getAnimations().length), 0);
  }
  checks.push(
    '320/390px: conversation pushes in and pops out over the project list; resize clears stale motion',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open();
  const reduced = await sample(50);
  assert(reduced.durations.every((duration) => duration <= 100));
  assert.equal(reduced.x, 0);
  await finish();
  await mobileForward();
  assert((await sample(50)).visibility === 'visible');
  await finish();
  checks.push('reduced motion uses a short fade without sliding');
  assert.deepEqual(errors, []);
  // A normal-speed recording, independent of the paused verification timeline.
  const videoContext = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1100, height: 750 },
    recordVideo: { dir: fileURLToPath(out), size: { width: 1100, height: 750 } },
  });
  await isolate(videoContext);
  const demo = await videoContext.newPage();
  await demo.goto(origin);
  await demo.locator('.sidebar-brand').waitFor();
  await demo.waitForTimeout(600);
  for (let i = 0; i < 2; i++) {
    await demo.getByRole('button', { name: '收起会话列表', exact: true }).click();
    await demo.waitForTimeout(650);
    await demo.getByRole('button', { name: '打开会话列表', exact: true }).click();
    await demo.waitForTimeout(650);
  }
  const video = demo.video();
  await videoContext.close();
  await rename(await video.path(), fileURLToPath(new URL('sidebar-toggle.webm', out)));
  await writeFile(
    new URL('verification.json', out),
    JSON.stringify({ checks, errors, realHost: false }, null, 2),
  );
  console.log('PASS:', checks.join('; '));
} finally {
  await browser.close();
}

/* global window, document, getComputedStyle, CustomEvent, Element */
// Real UI with controlled transport: never logs in or executes a model task.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startConversationServer } from './conversation-server.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const directory = resolve('artifacts/web-motion');
mkdirSync(directory, { recursive: true });
const { vite, state, origin } = await startConversationServer({
  cacheDir: resolve('.tmp/web-motion'),
});
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 820 },
    reducedMotion: 'no-preference',
    recordVideo: { dir: directory },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.messageAnimations = 0;
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.hasAttribute('data-history-key')) window.messageAnimations++;
      return original.apply(this, args);
    };
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const settle = () =>
    page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
  await page.goto(origin);
  await page.locator('.rich-content h1').waitFor();
  await settle();
  assert.equal(
    await page.evaluate(() => window.messageAnimations),
    0,
    'initial history never plays a bulk entrance',
  );
  assert.equal(
    await page
      .locator('[data-history-key]')
      .evaluateAll((nodes) => nodes.flatMap((node) => node.getAnimations()).length),
    0,
    'loaded history does not animate',
  );
  // Real pointer actions must animate both sides of a panel lifecycle.
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  const menu = page.locator('.top-menu');
  await menu.waitFor();
  assert.equal(
    await menu.evaluate((node) => getComputedStyle(node).transformOrigin.endsWith('0px')),
    true,
  );
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await settle();
  assert.equal(
    await page.getByRole('dialog').evaluate((node) => node.contains(document.activeElement)),
    true,
    'native modal traps focus',
  );
  await page.screenshot({ path: resolve(directory, 'desktop-settings.png') });
  // Capture the exit during the same task as the click, before its timer fires.
  const closing = await page.getByRole('dialog').evaluate(async (node) => {
    node.querySelector('button[aria-label="关闭"]').click();
    await new Promise((done) => window.requestAnimationFrame(done));
    return {
      present: node.isConnected,
      inert: node.inert,
      state: node.dataset.motion,
      transitions: node.getAnimations().map((animation) => animation.transitionProperty),
    };
  });
  assert.equal(closing.present, true);
  assert.equal(closing.inert, true, 'exiting modal cannot submit actions');
  assert.equal(closing.state, 'closed');
  assert.ok(closing.transitions.includes('opacity'), 'modal fades out before unmount');
  await page.locator('.modal').waitFor({ state: 'detached' });
  // Collapsing retains content for measurement but takes it out of keyboard navigation.
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await settle();
  assert.equal(
    await page
      .locator('.motion-collapse')
      .first()
      .evaluate((node) => node.inert && node.getBoundingClientRect().height === 0),
    true,
  );
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await settle();
  // Interruption: close/open/close rapidly, then check visual position and reachability.
  await page.evaluate(() => {
    document.querySelector('.sidebar-brand button').click();
    window.setTimeout(() => document.querySelector('.topbar > button').click(), 35);
    window.setTimeout(() => document.querySelector('.sidebar-brand button').click(), 70);
  });
  await page.waitForFunction(() => document.querySelector('.sidebar').inert);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.sidebar')).visibility === 'hidden',
  );
  await settle();
  assert.ok(
    await page
      .locator('.conversation')
      .evaluate((node) => Math.abs(node.getBoundingClientRect().left) < 1),
  );
  await page.getByRole('button', { name: '打开会话列表', exact: true }).click();
  await settle();
  // Streaming a new item may fade it once; its subsequent deltas must not restart it.
  state.running = true;
  const stream = async (method, fields) => {
    const detail = {
      type: 'event',
      eventId: String(state.events.length + 1),
      sessionId: 's1',
      turnId: 'local-turn',
      action: 'turn.progress',
      payload: { method, turnId: 'native-turn', itemId: 'motion-stream', ...fields },
    };
    state.events.push(detail);
    await page.evaluate(
      (detail) => window.dispatchEvent(new CustomEvent('test-packet', { detail })),
      detail,
    );
  };
  await stream('item/started', {
    item: { id: 'motion-stream', type: 'agentMessage', text: '动效验收' },
  });
  await page.getByText('动效验收', { exact: true }).waitFor();
  const messageAnimations = await page.evaluate(() => window.messageAnimations);
  assert.equal(messageAnimations, 1, 'a new visible item fades in once');
  await settle();
  await stream('item/agentMessage/delta', { delta: '，持续输出' });
  await page.getByText('动效验收，持续输出', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.messageAnimations), messageAnimations);
  assert.equal(
    await page
      .locator('[data-history-key]')
      .last()
      .evaluate((node) => node.getAnimations().length),
    0,
    'deltas do not replay entrance',
  );
  // Keyboard shortcuts do not wait for transitions.
  await page.keyboard.press('Control+f');
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('dialog').evaluate((node) => node.getAnimations().length), 0);
  await page.keyboard.press('Escape');
  await page.locator('.modal').waitFor({ state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await settle();
  const reduced = await page.getByRole('dialog').evaluate((node) => ({
    transform: getComputedStyle(node).transform,
    properties: getComputedStyle(node).transitionProperty,
    duration: getComputedStyle(node).transitionDuration,
  }));
  assert.equal(reduced.transform, 'none');
  assert.ok(!reduced.properties.includes('transform'));
  assert.equal(reduced.duration, '0.1s');
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.modal').waitFor({ state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  // The responsive breakpoint closes the desktop rail before mobile launch.
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.sidebar')).visibility === 'hidden',
  );
  await page.getByRole('button', { name: '打开会话列表', exact: true }).click();
  await settle();
  await page.screenshot({ path: resolve(directory, 'mobile-drawer.png') });
  await page.getByRole('button', { name: '关闭侧栏', exact: true }).click();
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.sidebar')).visibility === 'hidden',
  );
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    'Motion acceptance passed: desktop/mobile drawer interruption, menu/modal exits, inert/focus safety, accordions, stable streamed text, instant shortcuts and reduced motion. Local controlled transport; physical touch feel remains unverified.',
  );
} finally {
  await browser?.close();
  await vite.close();
}

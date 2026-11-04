/* global document, window, localStorage, getComputedStyle, Event */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.SIDEBAR_RESIZE_TEST_ORIGIN || 'http://127.0.0.1:1512';
const out = new URL('../../artifacts/sidebar-resize/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const checks = [],
  errors = [];
async function isolate(context) {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/'))
      return route.fulfill({
        json: url.pathname.endsWith('/web/session')
          ? { accountId: 'sidebar-resize-test', mustChangePassword: false }
          : url.pathname.endsWith('/hosts')
            ? { hosts: [] }
            : { enabled: false },
        headers: {
          'access-control-allow-origin': new URL(origin).origin,
          'access-control-allow-credentials': 'true',
        },
      });
    if (url.origin !== new URL(origin).origin) return route.abort();
    return route.continue();
  });
}
async function settle(page) {
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('.sidebar, .conversation-layout, .sidebar-scrim'))
      for (const animation of node.getAnimations()) animation.finish();
  });
  await page.waitForTimeout(30);
}
async function state(page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    const root = sidebar.closest('.shell');
    const box = sidebar.getBoundingClientRect();
    const main = root.querySelector('.conversation-layout').getBoundingClientRect();
    return {
      width: box.width,
      edge: box.right,
      mainLeft: main.left,
      mainRight: main.right,
      open: root.classList.contains('with-sidebar'),
      inert: sidebar.inert,
      resizing: root.hasAttribute('data-sidebar-resizing'),
      visible: getComputedStyle(sidebar).visibility,
      animations: sidebar.getAnimations().length,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      saved: localStorage.getItem('agentdeck.web.sidebar-width'),
      scrimLeft: root.querySelector('.sidebar-scrim').getBoundingClientRect().left,
    };
  });
}
async function begin(page) {
  const box = await page.locator('.sidebar-resizer').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: (await state(page)).width };
}
async function move(page, start, width) {
  await page.mouse.move(start.x + width - start.width, start.y, { steps: 6 });
}
async function reopen(page) {
  await page.getByRole('button', { name: '打开会话列表', exact: true }).click();
  await settle(page);
}
try {
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1200, height: 850 },
  });
  await isolate(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator('.sidebar-resizer').waitFor();
  await settle(page);
  for (const mode of ['codex', 'api']) {
    await page.evaluate((mode) => {
      localStorage.setItem('agentdeck.web.work-mode', JSON.stringify(mode));
      localStorage.removeItem('agentdeck.web.sidebar-width');
    }, mode);
    await page.reload();
    await page.locator('.sidebar-resizer').waitFor();
    await settle(page);
    assert.equal((await state(page)).width, 280);
    let start = await begin(page);
    await move(page, start, 360);
    let next = await state(page);
    assert.equal(next.width, 360);
    assert.equal(next.edge, next.mainLeft);
    assert.equal(next.mainRight, 1200);
    assert(next.resizing && !next.overflow);
    await page.mouse.up();
    assert.equal((await state(page)).saved, JSON.stringify('360'));
    await page.reload();
    await page.locator('.sidebar-resizer').waitFor();
    assert.equal((await state(page)).width, 360);
    start = await begin(page);
    await move(page, start, 165);
    next = await state(page);
    assert(!next.open && next.inert && !next.resizing);
    assert.equal(next.visible, 'hidden');
    assert.equal(next.animations, 0, 'drag collapse hides immediately');
    assert.equal(next.mainLeft, 0);
    assert.equal(
      next.saved,
      JSON.stringify('360'),
      'collapsed width never replaces remembered width',
    );
    await page.mouse.up();
    await reopen(page);
    assert.equal((await state(page)).width, 360);
    start = await begin(page);
    await move(page, start, 420);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    next = await state(page);
    assert.equal(next.width, 360);
    assert(!next.resizing);
    start = await begin(page);
    await move(page, start, 420);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
    assert.equal((await state(page)).width, 360);
    assert(!(await state(page)).resizing);
    await page.locator('.sidebar-resizer').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal((await state(page)).width, 380);
    await page.keyboard.press('Home');
    assert(!(await state(page)).open);
    await reopen(page);
    assert.equal((await state(page)).width, 380);
    await page.locator('.sidebar-resizer').dblclick();
    assert.equal((await state(page)).width, 280);
    start = await begin(page);
    await move(page, start, 470);
    await page.setViewportSize({ width: 800, height: 850 });
    await page.mouse.up();
    next = await state(page);
    assert(!next.resizing && next.width <= 360 && !next.overflow);
    await page.setViewportSize({ width: 1200, height: 850 });
    await settle(page);
    await page.screenshot({ path: fileURLToPath(new URL(`${mode}-desktop.png`, out)) });
    checks.push(
      `${mode}: real App drag/reflow, persistence, immediate collapse/reopen, Escape/blur cancellation, keyboard, reset and resize cleanup`,
    );
  }
  await context.close();
  for (const width of [320, 390]) {
    const mobile = await browser.newContext({
      locale: 'zh-CN',
      hasTouch: true,
      viewport: { width, height: 844 },
    });
    await isolate(mobile);
    const page = await mobile.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    await page.locator('.sidebar-quick-compose').waitFor();
    const initial = await state(page);
    assert.equal(initial.width, width);
    assert.equal(await page.locator('.sidebar-resizer').isVisible(), false);
    await page.locator('.sidebar-quick-compose').click();
    const next = await state(page);
    assert(!next.open && next.inert && !next.resizing && !next.overflow);
    assert.equal(next.mainLeft, 0);
    await reopen(page);
    assert.equal((await state(page)).width, initial.width);
    await page.screenshot({ path: fileURLToPath(new URL(`touch-${width}.png`, out)) });
    checks.push(
      `${width}px: full-page project list, hidden resize handle, new-conversation navigation and return preserve viewport width`,
    );
    await mobile.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    new URL('verification.json', out),
    JSON.stringify({ checks, errors, realHost: false, realDevice: false }, null, 2) + '\n',
  );
  console.log('PASS:', checks.join('; '));
} finally {
  await browser.close();
}

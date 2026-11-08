/* global window, document, getComputedStyle, DOMMatrix */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/ios-motion/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const checks = [];
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => route.abort());
  await page.goto(process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1542');
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = dom.default || dom;
    const { MotionPresence } = await import('/src/motion.tsx');
    const { Modal } = await import('/src/ui.tsx');
    const { SettingsLayout } = await import('/src/features/SettingsLayout.tsx');
    document.getElementById('root').style.display = 'none';
    const target = document.createElement('div');
    document.body.append(target);
    function Example() {
      const [open, setOpen] = React.useState(false);
      const [active, setActive] = React.useState('general');
      window.setMotionDialog = setOpen;
      window.setMotionTab = setActive;
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('button', { onClick: () => setOpen(true) }, '打开设置'),
        React.createElement(
          MotionPresence,
          null,
          open &&
            React.createElement(
              Modal,
              { title: '设置', className: 'settings-modal', onClose: () => setOpen(false) },
              React.createElement(
                SettingsLayout,
                { active, onChange: setActive },
                React.createElement('p', null, active),
              ),
            ),
        ),
      );
    }
    createRoot(target).render(React.createElement(Example));
  });
  const modal = page.locator('dialog.settings-modal');
  const sample = async (time) =>
    modal.evaluate((node, time) => {
      const animations = node.getAnimations();
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = time;
      }
      const style = getComputedStyle(node);
      const matrix = new DOMMatrix(style.transform);
      return {
        y: matrix.m42,
        scale: matrix.a,
        opacity: Number(style.opacity),
        height: node.offsetHeight,
        durations: animations.map((animation) => animation.effect.getTiming().duration),
        inert: node.inert,
      };
    }, time);
  const finish = async () => {
    await modal.evaluate((node) =>
      node.getAnimations({ subtree: true }).forEach((animation) => animation.finish()),
    );
    await page.waitForTimeout(30);
  };
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: '打开设置' }).click();
    await page.waitForFunction(() => document.querySelector('dialog')?.dataset.motion === 'open');
    const start = await sample(0);
    const middle = await sample(70);
    assert(start.y > start.height * 0.95, 'mobile settings enter from below the viewport');
    assert(middle.y > 0 && middle.y < start.y && middle.scale === 1);
    assert(start.durations.every((duration) => duration === 280));
    await page.screenshot({ path: fileURLToPath(new URL(`mobile-${width}-enter.png`, out)) });
    await finish();
    await page.getByRole('button', { name: '电脑', exact: true }).click();
    const indicator = page.locator('.settings-selection');
    const moving = await indicator.evaluate((node) => {
      const animation = node.getAnimations()[0];
      animation.pause();
      animation.currentTime = 60;
      const x = new DOMMatrix(getComputedStyle(node).transform).m41;
      animation.finish();
      return x;
    });
    assert(moving > 0 && moving < (width * 2) / 3);
    await page.waitForTimeout(280);
    const pill = await indicator.boundingBox();
    const selected = await page.getByRole('button', { name: '电脑', exact: true }).boundingBox();
    assert(Math.abs(pill.x - selected.x) < 1 && Math.abs(pill.width - selected.width) < 1);
    await page.screenshot({ path: fileURLToPath(new URL(`mobile-${width}-settled.png`, out)) });
    await page.evaluate(() => window.setMotionDialog(false));
    await page.waitForFunction(() => document.querySelector('dialog')?.dataset.motion === 'closed');
    const closing = await sample(70);
    assert(closing.y > 0 && closing.inert, 'exiting modal stays painted and inert');
    await page.evaluate(() => window.setMotionDialog(true));
    await page.waitForFunction(() => document.querySelector('dialog')?.dataset.motion === 'open');
    const reversed = await sample(0);
    assert(Math.abs(reversed.y - closing.y) < 1, 'reopen continues from the interrupted position');
    await finish();
    await page.keyboard.press('Tab');
    await page.evaluate(() => window.setMotionTab('general'));
    await page.waitForTimeout(30);
    assert.equal(await indicator.evaluate((node) => node.getAnimations().length), 0);
    assert.equal(
      await page.locator('.settings-body').evaluate((node) => node.getAnimations().length),
      0,
    );
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });
    assert(
      await page
        .getByRole('button', { name: '打开设置' })
        .evaluate((node) => document.activeElement === node),
    );
    checks.push(
      `${width}px: full-height entry, aligned sliding selection, reversible exit, keyboard and focus restoration`,
    );
  }
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.waitForFunction(() => document.querySelector('dialog')?.dataset.motion === 'open');
  const desktop = await sample(0);
  assert(Math.abs(desktop.scale - 0.94) < 0.001 && desktop.y === 16);
  await sample(70);
  await page.screenshot({ path: fileURLToPath(new URL('desktop-enter.png', out)) });
  await finish();
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.waitForFunction(() => document.querySelector('dialog')?.dataset.motion === 'open');
  const reduced = await sample(30);
  assert(
    reduced.y === 0 &&
      reduced.scale === 1 &&
      reduced.durations.every((duration) => duration <= 100),
  );
  await finish();
  checks.push('desktop: scale/translation entry; reduced motion: fade only');
  assert.deepEqual(errors, []);
  await writeFile(
    new URL('verification.json', out),
    JSON.stringify({ checks, errors, realHost: false }, null, 2),
  );
  console.log('PASS:', checks.join('; '));
} finally {
  await browser.close();
}

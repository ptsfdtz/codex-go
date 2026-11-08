import { fileURLToPath } from 'node:url';
/* global window, document, localStorage, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1430';
const out = new URL('../../artifacts/ui-refresh/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
try {
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1280, height: 850 },
  });
  await context.addInitScript(() => {
    localStorage.setItem('agentdeck.web.work-mode', '"codex"');
    localStorage.setItem('agentdeck.web.theme', 'light');
    localStorage.setItem('agentdeck.web.settingsTab', JSON.stringify('diagnostics'));
  });
  await context.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const value = path.endsWith('/web/session')
      ? { accountId: 'ui-test', cloudDeviceId: 'browser', mustChangePassword: false }
      : path.endsWith('/hosts')
        ? { hosts: [] }
        : path.endsWith('/devices')
          ? { devices: [] }
          : path.endsWith('/web/csrf')
            ? { csrfToken: 'ui-test' }
            : {};
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  const settings = page.getByRole('button', { name: '设置', exact: true });
  await settings.click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.waitFor();
  const nav = page.getByRole('navigation', { name: '设置分类' });
  await nav.waitFor();
  assert.deepEqual(await nav.getByRole('button').allTextContents(), ['常规', '项目', '电脑']);
  assert.equal(
    await nav.getByRole('button', { name: '常规', exact: true }).getAttribute('aria-current'),
    'page',
  );
  for (const name of ['应用更新', '快捷键', '数据', '诊断', 'Codex 账户', '模型与输出'])
    assert.equal(await dialog.getByText(name, { exact: true }).count(), 0);
  await dialog.getByRole('checkbox', { name: '系统通知' }).waitFor();
  await dialog.getByRole('button', { name: '退出账户' }).waitFor();
  assert.equal(await dialog.getByText('选择适合你的界面主题。').count(), 0);
  await page.getByRole('combobox', { name: '外观', exact: true }).click();
  await page.getByRole('option', { name: '深色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.waitForTimeout(320);
  await page.screenshot({ path: fileURLToPath(new URL('settings-dark.png', out)) });
  await page.getByRole('combobox', { name: '外观', exact: true }).click();
  await page.getByRole('option', { name: '浅色', exact: true }).click();
  await nav.getByRole('button', { name: '项目', exact: true }).click();
  const before = await dialog.boundingBox();
  await dialog.getByRole('region', { name: '项目管理' }).waitFor();
  await nav.getByRole('button', { name: '电脑', exact: true }).click();
  await dialog.getByText('尚未绑定电脑。请先在电脑端登录同一账户。').waitFor();
  await nav.getByRole('button', { name: '项目', exact: true }).click();
  const after = await dialog.boundingBox();
  assert.equal(before.width, after.width);
  assert.equal(before.height, after.height);
  assert.equal(
    await nav.getByRole('button', { name: '项目', exact: true }).getAttribute('aria-current'),
    'page',
  );
  // Repeated switches keep focus on navigation and do not accumulate animations.
  for (let i = 0; i < 8; i++) {
    await nav.getByRole('button', { name: i % 2 ? '常规' : '电脑', exact: true }).click();
  }
  await page.waitForTimeout(320);
  assert.equal(
    await page.locator('.settings-body').evaluate((node) => node.getAnimations().length),
    0,
  );
  await page.screenshot({ path: fileURLToPath(new URL('settings-light.png', out)) });
  await page.keyboard.press('Escape');
  await page.locator('dialog.settings-modal').waitFor({ state: 'detached' });
  assert(await settings.evaluate((node) => document.activeElement === node));
  // Real mobile layout: text categories remain reachable and no horizontal page overflow.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await page.getByRole('button', { name: '打开会话列表', exact: true }).click();
    await page.locator('.sidebar-mobile-settings').click();
    await nav.getByRole('button', { name: '项目', exact: true }).click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.waitForTimeout(320);
    const box = await dialog.boundingBox();
    assert.equal(Math.round(box.width), width);
    await nav.getByRole('button', { name: '常规', exact: true }).click();
    await page.waitForTimeout(320);
    await page.screenshot({ path: fileURLToPath(new URL(`settings-${width}.png`, out)) });
    await page.keyboard.press('Escape');
    await page.locator('dialog.settings-modal').waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 1280, height: 850 });
  }
  // Isolate the actual shared modal to exercise backdrop selection and compact sizing.
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Modal } = await import('/src/ui.tsx');
    const { MotionPresence } = await import('/src/motion.tsx');
    document.getElementById('root').style.display = 'none';
    const target = document.createElement('div');
    document.body.append(target);
    const root = (dom.default || dom).createRoot(target);
    function Example() {
      const [open, setOpen] = React.useState(false);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('button', { onClick: () => setOpen(true) }, '测试确认'),
        React.createElement(
          MotionPresence,
          null,
          open &&
            React.createElement(
              Modal,
              {
                compact: true,
                title: '确认操作',
                onClose: () => setOpen(false),
              },
              React.createElement('p', null, '需要保留的操作后果'),
            ),
        ),
      );
    }
    root.render(React.createElement(Example));
  });
  await page.getByRole('button', { name: '测试确认' }).click();
  const compact = page.getByRole('dialog', { name: '确认操作' });
  await page.waitForTimeout(320);
  assert((await compact.boundingBox()).width <= 440.5);
  const text = await compact.getByText('需要保留的操作后果').boundingBox();
  await page.mouse.move(text.x + 10, text.y + 10);
  await page.mouse.down();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  assert(await compact.isVisible());
  await page.mouse.click(5, 5);
  await compact.waitFor({ state: 'hidden' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '测试确认' }).click();
  await page.waitForTimeout(120);
  assert.equal(await compact.evaluate((node) => getComputedStyle(node).transform), 'none');
  await page.keyboard.press('Escape');
  await compact.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: legacy category fallback, three settings categories, theme, stable modal size, mobile 320/390, focus restoration, compact dialog, backdrop drag and reduced motion.',
  );
} finally {
  await browser.close();
}

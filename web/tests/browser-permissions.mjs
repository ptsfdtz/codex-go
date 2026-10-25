/* global document, window */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startConversationServer } from './conversation-server.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const directory = '.tmp/web-permissions';
mkdirSync(directory, { recursive: true });
const { vite, state, origin } = await startConversationServer({
  cacheDir: join(process.cwd(), directory, 'cache'),
  allowMutations: true,
});
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator('[data-connection-state="connected"]').waitFor({ state: 'attached' });
  const permission = page.locator('.composer .permission');
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await permission.click();
    const dialog = page.getByRole('dialog', { name: '执行权限', exact: true });
    await dialog.getByRole('radio', { name: /完整访问/ }).check();
    await page.screenshot({ path: join(directory, `${theme}-mobile.png`) });
    assert.ok(
      await dialog.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return (
          box.left >= 0 && box.right <= window.innerWidth && node.scrollWidth <= node.clientWidth
        );
      }),
    );
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await permission.getAttribute('data-permission'), 'workspace');
  }
  await permission.click();
  const dialog = page.getByRole('dialog', { name: '执行权限', exact: true });
  await dialog.getByRole('radio', { name: /完整访问/ }).check();
  await dialog.getByRole('button', { name: '确认使用完整访问', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await permission.getAttribute('data-permission'), 'full');
  assert.equal(
    await permission.locator('span').isVisible(),
    true,
    'mobile must show selected permission',
  );
  assert.equal(await permission.innerText(), '完整访问');
  await page.setViewportSize({ width: 320, height: 740 });
  assert.ok(
    await page
      .locator('.composer-toolbar')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
    'permission label fits narrow mobile toolbar',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('消息', { exact: true }).fill('Permission payload acceptance');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.composer textarea').value === '');
  assert.equal(
    state.rpc.filter((r) => r.action === 'turn.start').at(-1)?.payload.permissionMode,
    'full',
  );
  await permission.click();
  await dialog.getByRole('radio', { name: /工作区权限/ }).check();
  await dialog.getByRole('button', { name: '使用工作区权限', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByLabel('消息', { exact: true }).fill('Return to workspace');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.composer textarea').value === '');
  assert.equal(
    state.rpc.filter((r) => r.action === 'turn.start').at(-1)?.payload.permissionMode,
    'workspace',
  );
  assert.deepEqual(errors, []);
  console.log(
    'Permission acceptance passed: mobile themes, cancel, visible selection, full/workspace turn payloads. Controlled host; no live task.',
  );
} finally {
  await browser?.close();
  await vite.close();
}

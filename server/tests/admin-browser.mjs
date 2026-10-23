import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../desktop/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const origin = process.env.AGENTDECK_TEST_BROWSER_ORIGIN;
if (!origin) throw new Error('Run this through the PostgreSQL admin browser acceptance test.');
const browser = await chromium.launch({
  channel:
    process.env.AGENTDECK_TEST_BROWSER_CHANNEL ||
    (process.platform === 'win32' ? 'msedge' : undefined),
  headless: true,
});
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  const responses = [];
  page.on('response', (response) =>
    responses.push(`${response.status()} ${new URL(response.url()).pathname}`),
  );
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + '/admin');
  async function login(password) {
    const form = page.locator('#login-form');
    await form.getByLabel('用户名', { exact: true }).fill('browser-admin');
    await form.getByLabel('密码', { exact: true }).fill(password);
    await form.getByRole('button', { name: '登录', exact: true }).click();
  }
  await login('test-initial-password');
  await expect(page.locator('#password')).toBeVisible();
  const password = page.locator('#password-form');
  await password.getByLabel('当前密码', { exact: true }).fill('test-initial-password');
  await password.getByLabel('新密码', { exact: true }).fill('browser-changed-password');
  await password.getByLabel('确认新密码', { exact: true }).fill('browser-changed-password');
  await password.getByRole('button', { name: '保存并重新登录' }).click();
  await expect(page.locator('#login')).toBeVisible();
  await login('browser-changed-password');
  try {
    await expect(page.locator('#management')).toBeVisible();
  } catch {
    throw new Error(
      `Management did not open. Notice: ${await page.locator('#notice').textContent()}; errors: ${JSON.stringify(errors)}; responses: ${responses.join(', ')}`,
    );
  }
  await expect(page.locator('#status')).toContainText('数据库正常');
  await page.getByRole('button', { name: '创建账户', exact: true }).click();
  await page.locator('#editor-fields input[name="username"]').fill('browser-user');
  await page.locator('#editor').getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#secret')).toBeVisible();
  await expect(page.locator('#secret-value')).not.toBeEmpty();
  await page.getByRole('button', { name: '已保存', exact: true }).click();
  const row = page.locator('#account-rows tr').filter({ hasText: 'browser-user' });
  await expect(row).toContainText('待修改初始密码');
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('最多电脑数', { exact: true }).fill('4');
  await page.locator('#editor').getByRole('button', { name: '保存', exact: true }).click();
  await expect(row).toContainText('4 台电脑');
  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: '重置密码', exact: true }).click();
  await expect(page.locator('#secret')).toBeVisible();
  await page.getByRole('button', { name: '已保存', exact: true }).click();
  await page.getByRole('button', { name: '设备', exact: true }).click();
  await expect(page.locator('#devices')).toBeVisible();
  await page.getByRole('button', { name: '管理记录', exact: true }).click();
  await expect(page.locator('#audit-rows')).toContainText('创建账户');
  await page.getByRole('button', { name: '账户', exact: true }).click();
  const screenshotDir = new URL('../../artifacts/cloud-admin/', import.meta.url);
  await mkdir(screenshotDir, { recursive: true });
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: fileURLToPath(new URL(`admin-${width}.png`, screenshotDir)),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.locator('#login')).toBeVisible();
  await context.close();
  process.stdout.write(
    'Admin browser acceptance passed: initial password, account creation, quotas, reset, devices, audit, logout, two viewport sizes.\n',
  );
} finally {
  await browser.close();
}

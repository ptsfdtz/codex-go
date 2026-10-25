/* global window, Event */
// Real UI with a controlled Host. No account or model requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { startConversationServer } from './conversation-server.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const { vite, state, origin } = await startConversationServer({
  cacheDir: resolve('.tmp/web-chat'),
  allowMutations: true,
});
state.chatSupported = true;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  await page.locator('[data-connection-state="connected"]').waitFor();
  await page.getByRole('button', { name: '普通聊天', exact: true }).click();
  await page.getByRole('heading', { name: '聊点什么？', exact: true }).waitFor();
  assert.equal(await page.getByTitle('执行权限', { exact: true }).count(), 0);
  await page.getByLabel('消息', { exact: true }).fill('聊天草稿');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.locator('[data-connection-state="retrying"]').waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator('[data-connection-state="connected"]').waitFor();
  assert.equal(
    await page.getByLabel('消息', { exact: true }).inputValue(),
    '聊天草稿',
    'new chat draft survives reconnect without falling back to a project',
  );
  await page.getByLabel('消息', { exact: true }).fill('今天想聊聊天');
  state.delayStart = true;
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const deadline = Date.now() + 10000;
  while (!state.startPending.length && Date.now() < deadline) await page.waitForTimeout(20);
  assert.equal(state.startPending.length, 1, 'first turn is awaiting acknowledgement');
  assert.equal(
    state.rpc.filter(
      (r) => r.action === 'sessions.history' && r.payload.sessionId === 'new-session',
    ).length,
    0,
    'must not paginate a pristine thread while its first turn is still starting',
  );
  assert.equal(await page.locator('.history-error').count(), 0);
  state.delayStart = false;
  while (state.startPending.length) state.startPending.shift()();
  await page.waitForFunction(
    () => !window.document.querySelector('textarea[aria-label="消息"]').value,
  );
  const created = state.rpc.filter((r) => r.action === 'sessions.create');
  assert.equal(created.length, 1);
  assert.equal(created[0].payload.projectId, 'agentdeck-chat');
  const turn = state.rpc.filter((r) => r.action === 'turn.start').at(-1).payload;
  assert.equal(turn.sessionId, 'new-session');
  assert.equal(turn.mode, 'default');
  assert.equal(turn.permissionMode, 'workspace');
  await page.waitForFunction(
    () => !window.document.querySelector('textarea[aria-label="消息"]').disabled,
  );
  assert.equal(
    state.rpc.filter(
      (r) => r.action === 'sessions.history' && r.payload.sessionId === 'new-session',
    ).length,
    1,
    'first saved page is read once after acknowledgement',
  );
  assert.equal(await page.locator('.history-error').count(), 0);
  await page.getByLabel('消息', { exact: true }).fill('再聊一个问题');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(
    () => !window.document.querySelector('textarea[aria-label="消息"]').value,
  );
  assert.equal(
    state.rpc.filter((r) => r.action === 'sessions.create').length,
    1,
    'follow-up reuses the conversation',
  );
  await page.reload();
  await page.locator('[data-connection-state="connected"]').waitFor();
  assert.equal(
    await page.getByTitle('执行权限', { exact: true }).count(),
    0,
    'reloading restores chat scope',
  );
  await page.getByRole('button', { name: '添加附件和操作', exact: true }).click();
  assert.equal(await page.getByRole('menuitem', { name: 'Plan', exact: true }).count(), 0);
  assert.equal(await page.getByRole('menuitem', { name: '技能', exact: true }).count(), 0);
  await page.getByRole('button', { name: '关闭添加菜单', exact: true }).click();
  await page.locator('.project-list').getByRole('button', { name: '项目一', exact: true }).click();
  await page.getByTitle('执行权限', { exact: true }).waitFor();
  state.chatSupported = false;
  await page.reload();
  await page.locator('[data-connection-state="connected"]').waitFor();
  assert.equal(
    await page.getByRole('button', { name: '普通聊天', exact: true }).isEnabled(),
    false,
    'old Host does not advertise unsupported chat creation',
  );
  state.chatSupported = true;
  state.chatOnly = true;
  state.chatSessions = [];
  const noProjectPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  noProjectPage.setDefaultTimeout(10000);
  await noProjectPage.goto(origin);
  await noProjectPage.getByRole('heading', { name: '聊点什么？', exact: true }).waitFor();
  assert.equal(
    await noProjectPage.getByLabel('消息', { exact: true }).isEnabled(),
    true,
    'chat works with zero authorized user projects',
  );
  await noProjectPage.close();
  console.log(
    'General chat passed: independent creation, follow-up identity, restored scope, restricted controls, project switching and old Host compatibility.',
  );
} finally {
  state.delayStart = false;
  while (state.startPending.length) state.startPending.shift()();
  await browser?.close();
  await vite.close();
}

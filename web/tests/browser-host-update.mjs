// Real UI/transport adapter regression; no model or actual installation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { startConversationServer } from './conversation-server.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const { vite, state, origin } = await startConversationServer({
  cacheDir: resolve('.tmp/web-host-update'),
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
  page.setDefaultTimeout(15000);
  await page.route('**/__test_rpc', async (route) => {
    const { action } = route.request().postDataJSON();
    if (action === 'system.updateCheck')
      return route.fulfill({
        json: {
          current: 'host-old',
          latest: 'host-new',
          platform: 'windows',
          installation: 'release',
          updateAvailable: true,
        },
      });
    if (action === 'system.capabilities') {
      const response = await route.fetch();
      const body = await response.json();
      body.features.hostUpdateCheck = true;
      return route.fulfill({ json: body });
    }
    return route.continue();
  });
  await page.goto(origin);
  await page.locator('[data-connection-state="connected"]').waitFor();
  const notice = page.getByLabel('设备更新', { exact: true });
  await notice.getByText(/需要更新/).waitFor();
  assert.equal(state.rpc.filter((r) => r.action === 'turn.start').length, 0);
  await page.getByLabel('消息', { exact: true }).fill('保留原来的草稿');
  await notice.getByRole('button', { name: '让本地 AI 更新', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText(/只下载并安装更新/).waitFor();
  assert.equal(state.rpc.filter((r) => r.action === 'turn.start').length, 0);
  await dialog.getByLabel('更新工作区').selectOption('agentdeck-chat');
  await dialog.getByRole('button', { name: '发送更新提示词', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const deadline = Date.now() + 15000;
  while (!state.rpc.some((r) => r.action === 'turn.start') && Date.now() < deadline)
    await page.waitForTimeout(20);
  const created = state.rpc.filter((r) => r.action === 'sessions.create');
  const turns = state.rpc.filter((r) => r.action === 'turn.start');
  assert.equal(created.length, 1);
  assert.equal(created[0].payload.title, '更新 AgentDeck Host');
  assert.equal(created[0].payload.projectId, 'agentdeck-chat');
  assert.equal(turns.length, 1);
  assert.equal(turns[0].payload.sessionId, 'new-session');
  assert.equal(turns[0].payload.permissionMode, 'workspace');
  assert.equal(turns[0].payload.mode, 'default');
  assert.match(turns[0].payload.text, /不执行 stop、restart/);
  assert.match(turns[0].payload.text, /https:\/\/agent\.ptsfdtz\.top/);
  assert.equal(state.rpc.filter((r) => /restart|update.install/.test(r.action)).length, 0);
  await page.locator('.project-list').getByRole('button', { name: '项目一', exact: true }).click();
  await page.getByText('渲染验收', { exact: true }).first().click();
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), '保留原来的草稿');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await notice.isVisible());
  assert.equal(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
    ),
    false,
  );
  console.log(
    'PASS: Host update notice, explicit prompt preview/send once, dedicated session, workspace permissions, preserved draft and mobile layout.',
  );
} finally {
  await browser?.close();
  await vite.close();
}

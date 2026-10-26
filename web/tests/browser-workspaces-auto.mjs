import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { startConversationServer } from './conversation-server.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const { vite, origin } = await startConversationServer({
  cacheDir: resolve('.tmp/web-workspaces-auto'),
  showNotice: false,
});
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let removed = false,
    syncs = 0;
  await page.route('**/__test_rpc', async (route) => {
    const request = route.request().postDataJSON();
    if (request.action === 'projects.add') {
      syncs++;
      return route.fulfill({ json: { status: 'synced' } });
    }
    if (request.action === 'projects.remove') {
      assert.deepEqual(request.payload, { projectId: 'p1' });
      removed = true;
      return route.fulfill({ json: { status: 'removed' } });
    }
    const response = await route.fetch();
    const body = await response.json();
    if (request.action === 'system.capabilities') body.features.codexWorkspaceDiscovery = true;
    if (request.action === 'snapshot.get' && removed) {
      body.projects = body.projects.filter((p) => p.projectId !== 'p1');
      body.sessions = body.sessions.filter((s) => s.projectId !== 'p1');
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto(origin);
  await page.locator('.rich-content h1').waitFor();
  const projects = async () => {
    await page.locator('.workspace-title').click();
    await page.getByRole('button', { name: '管理项目', exact: true }).click();
  };
  await projects();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '同步 Codex 工作区', exact: true }).click();
  await dialog.getByRole('button', { name: '移除项目 项目一', exact: true }).click();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(removed, false);
  await dialog.getByRole('button', { name: '移除项目 项目一', exact: true }).click();
  await dialog.getByRole('button', { name: '确认移除', exact: true }).click();
  await dialog
    .getByRole('button', { name: '移除项目 项目一', exact: true })
    .waitFor({ state: 'detached' });
  await dialog.getByRole('button', { name: '同步 Codex 工作区', exact: true }).click();
  assert.equal(
    await dialog.getByRole('button', { name: '移除项目 项目一', exact: true }).count(),
    0,
  );
  assert.equal(syncs, 2);
  console.log(
    'Workspace UI passed: sync, cancellation, confirmed removal, refreshed list and repeat sync. Controlled Host responses; no filesystem changes.',
  );
} finally {
  await browser?.close();
  await vite.close();
}

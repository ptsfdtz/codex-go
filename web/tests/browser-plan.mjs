/* global document, getComputedStyle */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startConversationServer } from './conversation-server.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const { vite, state, origin } = await startConversationServer({
  cacheDir: resolve('.tmp/web-plan'),
  allowMutations: true,
});
const plan = '# 实施计划\n\n## 步骤\n\n1. 检查现有功能\n2. 完成修改\n\n- 保留既有数据\n- 验证结果';
state.extra = [
  {
    turnId: 'plan-turn',
    item: { id: 'proposed-plan', type: 'plan', text: plan, status: 'completed' },
  },
];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
  let page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  const implement = page.getByRole('button', { name: '按照计划开发', exact: true });
  await implement.waitFor();
  assert.equal(
    state.rpc.filter((r) => r.action === 'turn.start').length,
    0,
    'completion never auto executes',
  );
  await page.getByLabel('消息', { exact: true }).fill('保留尚未发送的修改意见');
  await page.getByRole('button', { name: '继续调整计划', exact: true }).click();
  assert.equal(state.rpc.filter((r) => r.action === 'turn.start').length, 0);
  assert.equal(
    await page.getByLabel('消息', { exact: true }).inputValue(),
    '保留尚未发送的修改意见',
  );
  const bullets = page.locator('.plan-content ul');
  assert.equal(await bullets.evaluate((el) => getComputedStyle(el).listStyleType), 'disc');
  await page.setViewportSize({ width: 390, height: 844 });
  await implement.scrollIntoViewIfNeeded();
  const card = page.locator('.plan-content');
  assert.equal(await card.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
  mkdirSync(resolve('artifacts/web-plan'), { recursive: true });
  await card.screenshot({ path: resolve('artifacts/web-plan/plan.png') });
  state.failTurn = true;
  await implement.click();
  await page.getByText('Error: OUTCOME_UNKNOWN: controlled disconnect', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('消息', { exact: true }).inputValue(),
    '保留尚未发送的修改意见',
  );
  state.failTurn = false;
  assert.equal(await implement.isEnabled(), false, 'unknown delivery blocks duplicate execution');
  await page.close();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  await page.getByRole('button', { name: '继续调整计划', exact: true }).click();
  await page.getByLabel('消息', { exact: true }).fill('保留尚未发送的修改意见');
  await page.getByRole('button', { name: '按照计划开发', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.mode-chip'));
  const sent = state.rpc.filter((r) => r.action === 'turn.start').at(-1).payload;
  assert.equal(sent.mode, 'default');
  assert.equal(sent.text, `请按照以下计划开始开发：\n\n${plan}`);
  assert.equal(sent.permissionMode, 'workspace');
  assert.equal(
    await page.getByLabel('消息', { exact: true }).inputValue(),
    '保留尚未发送的修改意见',
  );
  console.log(
    'Plan passed: explicit confirmation, revise without sending, default-mode implementation, unknown delivery blocks retry, retained draft, Markdown lists and mobile layout.',
  );
} finally {
  await browser?.close();
  await vite.close();
}

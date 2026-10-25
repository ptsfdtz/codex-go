/* global document */
// Controlled Host acceptance; never changes a user's goal or invokes a model.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { startConversationServer } from './conversation-server.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const { vite, state, origin } = await startConversationServer({
  cacheDir: resolve('.tmp/web-goal'),
  allowMutations: true,
});
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  await page.locator('[data-connection-state="connected"]').waitFor();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '会话目标', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const clear = dialog.getByRole('button', { name: '清除目标', exact: true });
  const refresh = dialog.getByRole('button', { name: '刷新状态', exact: true });
  const clearCalls = () => state.rpc.filter((r) => r.action === 'sessions.goal.clear');
  const waitReady = async () => {
    await dialog.getByText('Controlled goal', { exact: true }).waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('dialog button')].some(
        (b) => b.textContent === '清除目标' && !b.disabled,
      ),
    );
  };
  await waitReady();
  state.goalActivity = { threadStatus: 'active', turn: { status: 'completed' } };
  await refresh.click();
  await dialog
    .getByText('当前会话仍有任务在执行。请先停止任务，再刷新状态。', { exact: true })
    .waitFor();
  assert.equal(
    await clear.isDisabled(),
    true,
    'active thread blocks even with an older completed turn',
  );
  assert.equal(clearCalls().length, 0);
  state.goalActivity = { threadStatus: 'notLoaded', turn: { status: 'inProgress' } };
  await refresh.click();
  await dialog
    .getByText('当前会话仍有任务在执行。请先停止任务，再刷新状态。', { exact: true })
    .waitFor();
  assert.equal(await clear.isDisabled(), true, 'unloaded never hides an in-progress turn');
  state.goalActivity = { threadStatus: 'notLoaded', turn: { status: 'completed' } };
  await refresh.click();
  await waitReady();
  await clear.click();
  // Activity changed after opening confirmation: recheck without submitting clear.
  state.goalActivity = { threadStatus: 'active', turn: { status: 'inProgress' } };
  await dialog.getByRole('button', { name: '确认清除', exact: true }).click();
  await dialog
    .getByRole('alert')
    .getByText('Error: 当前会话仍有任务在执行。请先停止任务，再刷新状态。', { exact: true })
    .waitFor();
  assert.equal(clearCalls().length, 0);
  assert.equal(state.goal.objective, 'Controlled goal');
  state.goalActivity = { threadStatus: 'notLoaded', turn: null };
  await refresh.click();
  await waitReady();
  // An older Host still rejects notLoaded; show a useful explanation, don't retry.
  state.goalMutationError = 'CONFLICT: Stop or reconcile upstream activity before editing goal';
  await dialog.getByRole('button', { name: '确认清除', exact: true }).click();
  await dialog
    .getByRole('alert')
    .getByText(/电脑端尚未确认会话可修改/)
    .waitFor();
  assert.equal(clearCalls().length, 1);
  assert.equal(state.goal.objective, 'Controlled goal');
  state.goalMutationError = '';
  await waitReady();
  await clear.click();
  await dialog.getByRole('button', { name: '确认清除', exact: true }).click();
  await dialog
    .getByText('此会话没有目标。选择输入框中的 Goal 模式并发送任务来创建。', { exact: true })
    .waitFor();
  assert.equal(state.goal, null);
  assert.equal(clearCalls().length, 2);
  assert.deepEqual(clearCalls().at(-1).payload, {
    sessionId: 's1',
    expectedGoalRevision: 'a'.repeat(64),
  });
  // Failed reads remain blocked, with an explicit way to refresh.
  state.goal = { objective: 'Controlled goal', status: 'paused', tokenBudget: 1000 };
  state.goalActivityError = true;
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '会话目标', exact: true }).click();
  await dialog.getByText('未能核对会话状态，请刷新状态后重试。', { exact: true }).waitFor();
  assert.equal(await clear.isDisabled(), true);
  assert.equal(clearCalls().length, 2);
  state.goalActivityError = false;
  await refresh.click();
  await waitReady();
  await page.screenshot({ path: resolve('.tmp/web-goal/verified.png') });
  console.log(
    'Goal acceptance passed: active and unknown state guards, confirmation race, unloaded clear, revision payload, old Host explanation and failed-read recovery. Controlled Host only.',
  );
} finally {
  await browser?.close();
  await vite.close();
}

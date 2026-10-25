/* global document, window */
// Exercise the real UI with a controlled Host; no user history or model calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { startConversationServer } from './conversation-server.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const { vite, state, origin } = await startConversationServer({
  cacheDir: resolve('.tmp/web-message-edit'),
  allowMutations: true,
});
let browser, release;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  page.setDefaultTimeout(10000);
  let fail = false,
    delay = false;
  const submitted = [];
  await page.route('**/__test_rpc', async (route) => {
    const request = route.request().postDataJSON();
    if (request.action === 'sessions.revise') {
      submitted.push(request.payload);
      if (fail)
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'SYNC_CONFLICT: controlled revision conflict' }),
        });
      if (delay)
        await new Promise((resolve) => {
          release = resolve;
        });
    }
    await route.continue();
  });
  await page.goto(origin);
  await page.locator('.rich-content h1').waitFor();
  await page.getByLabel('消息', { exact: true }).fill('Unsent composer draft');
  const edit = page.getByRole('button', { name: '编辑并重新发送', exact: true });
  const input = page.getByLabel('修改消息', { exact: true });
  const editor = page.getByRole('form', { name: '编辑消息', exact: true });
  await edit.click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await input.evaluate((n) => n === document.activeElement), true);
  assert.equal(await input.inputValue(), '展示 Markdown 和工具结果');
  const historyReads = state.rpc.filter((r) => r.action === 'sessions.history').length;
  await input.press('Home');
  await input.press('ArrowUp');
  assert.equal(
    state.rpc.filter((r) => r.action === 'sessions.history').length,
    historyReads,
    'editor navigation never paginates history',
  );
  assert.equal(
    await editor.locator('..').locator('..').getAttribute('data-history-key'),
    '["native-turn","question"]',
  );
  await input.fill('Changed but cancelled');
  await input.press('Escape');
  await input.waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === '编辑并重新发送',
  );
  assert.equal(await edit.evaluate((n) => n === document.activeElement), true);
  assert.equal(submitted.length, 0);
  await edit.click();
  assert.equal(await input.inputValue(), '展示 Markdown 和工具结果');
  await input.fill('   ');
  assert.equal(
    await editor.getByRole('button', { name: '保存并发送', exact: true }).isDisabled(),
    true,
  );
  await input.fill('First line');
  await input.press('End');
  await input.press('Enter');
  assert.equal(await input.inputValue(), 'First line\n');
  assert.equal(submitted.length, 0, 'Enter adds a line without sending');
  fail = true;
  await input.press('Control+Enter');
  await editor.getByRole('alert').waitFor();
  assert.equal(await input.inputValue(), 'First line\n', 'failed sends retain the edit');
  assert.equal(
    await page.getByLabel('消息', { exact: true }).inputValue(),
    'Unsent composer draft',
  );
  fail = false;
  delay = true;
  await editor.getByRole('button', { name: '保存并发送', exact: true }).click();
  await page.getByRole('button', { name: '发送中…', exact: true }).waitFor();
  await input.press('Control+Enter');
  assert.equal(await editor.getByRole('button', { name: '取消', exact: true }).isDisabled(), true);
  assert.equal(await input.getAttribute('readonly'), '');
  const deadline = Date.now() + 10000;
  while (!release && Date.now() < deadline) await page.waitForTimeout(20);
  assert.equal(submitted.length, 2, 'only one request per send while the response is pending');
  release();
  release = undefined;
  delay = false;
  await input.waitFor({ state: 'hidden' });
  assert.deepEqual(submitted.at(-1), {
    sessionId: 's1',
    beforeTurnId: 'native-turn',
    expectedLastTurnId: 'native-turn',
    itemId: 'question',
    text: 'First line',
    permissionMode: 'workspace',
    mode: 'default',
  });
  // Retry uses the original user message and keeps the same editor in the timeline.
  await page.getByRole('button', { name: '重试此回答', exact: true }).click();
  await input.waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await input.inputValue(), '展示 Markdown 和工具结果');
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  // Check both themes, long text sizing and controls at a phone viewport.
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.shell:not(.with-sidebar)').waitFor();
    await edit.click();
    await input.fill('手机原位编辑\n第二行\n' + 'Long message content '.repeat(150));
    await editor.scrollIntoViewIfNeeded();
    assert.ok(
      await input.evaluate((n) => n.clientHeight <= 420 && n.scrollHeight > n.clientHeight),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );
    for (const name of ['取消', '保存并发送']) {
      const box = await editor.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 390);
    }
    await page.screenshot({ path: resolve(`.tmp/web-message-edit/mobile-${theme}.png`) });
    await input.press('Escape');
  }
  await page.setViewportSize({ width: 1200, height: 820 });
  await edit.click();
  await editor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve('.tmp/web-message-edit/desktop.png') });
  assert.equal(submitted.length, 2, 'cancellation and layout checks never send');
  assert.equal(state.rpc.filter((r) => r.action === 'sessions.revise').length, 1);
  await page.getByRole('button', { name: '另一会话', exact: true }).click();
  await input.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '渲染验收', exact: true }).click();
  await page.locator('.rich-content h1').waitFor();
  assert.equal(await input.count(), 0, 'edits do not leak across conversations');
  console.log(
    'Inline message editing passed: original identity, no modal, keyboard, cancellation, retained drafts on failure, duplicate-send guard, retry, mobile themes and session switching. Controlled Host only.',
  );
} finally {
  release?.();
  await browser?.close();
  await vite.close();
}

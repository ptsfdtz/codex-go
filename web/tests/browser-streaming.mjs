/* global window, document, CustomEvent, Event */
// Controlled transport verifies the real App's reconnect and scroll behaviour.
// This does not contact production, execute a model, or replace TLS acceptance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { startConversationServer } from './conversation-server.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const { vite, state, origin } = await startConversationServer({
  cacheDir: join(process.cwd(), '.tmp/web-streaming'),
});
state.running = true;
state.extra = Array.from({ length: 18 }, (_, index) => ({
  turnId: 'native-turn',
  item: {
    id: 'reading-' + index,
    type: 'agentMessage',
    text: '阅读位置 ' + index + '\n\n' + '已有消息内容。'.repeat(35),
  },
}));
const count = (action) => state.rpc.filter((request) => request.action === action).length;
const append = (method, fields = {}, sessionId = 's1', action = 'turn.progress') => {
  const packet = {
    type: 'event',
    eventId: String(state.events.length + 1),
    sessionId,
    turnId: 'local-turn',
    action,
    payload: { method, turnId: 'native-turn', itemId: 'stream-answer', ...fields },
  };
  state.events.push(packet);
  return packet;
};
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const send = (packets) =>
    page.evaluate((packets) => {
      for (const detail of packets)
        window.dispatchEvent(new CustomEvent('test-packet', { detail }));
    }, packets);
  const ready = () => page.locator('[data-connection-state="connected"]').waitFor();
  const pending = async (queue) => {
    const deadline = Date.now() + 10000;
    while (!queue.length && Date.now() < deadline) await page.waitForTimeout(20);
    assert.ok(queue.length, 'expected a delayed request');
  };
  const anchor = () =>
    page.evaluate(() => {
      const node = document.querySelector('.timeline');
      const top = node.getBoundingClientRect().top;
      const item = [...node.querySelectorAll('[data-history-key]')].find(
        (item) => item.getBoundingClientRect().bottom > top,
      );
      return {
        key: item?.dataset.historyKey,
        offset: item ? item.getBoundingClientRect().top - top : 0,
        screenTop: item?.getBoundingClientRect().top,
      };
    });
  await page.goto(origin);
  await ready();
  await page.getByText('阅读位置 17', { exact: false }).waitFor();
  assert.equal(
    await page.locator('.assistant-turn .message-actions').count(),
    0,
    'running answer must not show per-paragraph actions',
  );
  assert.equal(count('sessions.history'), 1, 'initial entry loads only one latest page');
  assert.equal(
    state.rpc.filter((request) => request.payload.cursor).length,
    0,
    'mount must not page backwards automatically',
  );
  await page.getByLabel('消息', { exact: true }).fill('保留中的草稿');
  // Returning from a retained page checks liveness and keeps the current view.
  const helloCount = count('system.hello');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => document.querySelector('[data-connection-state="connected"]'));
  await page.waitForTimeout(500);
  assert.equal(count('system.hello'), helloCount + 1, 'overlapping resume events share a probe');
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), '保留中的草稿');
  // A silent old route fails the resume probe without an offline/close event.
  let failedProbe = false;
  await page.route('**/__test_rpc', async (route) => {
    if (!failedProbe && route.request().postDataJSON().action === 'system.hello') {
      failedProbe = true;
      return route.abort();
    }
    return route.continue();
  });
  const snapshotsBeforeResume = count('snapshot.get');
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await page.waitForFunction(() => document.querySelector('[data-connection-state="connected"]'));
  const resumeDeadline = Date.now() + 10000;
  while (count('snapshot.get') === snapshotsBeforeResume && Date.now() < resumeDeadline)
    await page.waitForTimeout(20);
  assert.ok(
    failedProbe && count('snapshot.get') > snapshotsBeforeResume,
    'resume reconnects automatically',
  );
  await ready();
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), '保留中的草稿');
  await page.unroute('**/__test_rpc');
  const start = append('item/started', {
    item: { id: 'stream-answer', type: 'agentMessage', text: '' },
  });
  const deltas = Array.from({ length: 30 }, () =>
    append('item/agentMessage/delta', { delta: '片段' }),
  );
  const reads = count('sessions.history'),
    snapshots = count('snapshot.get');
  await send([start, ...deltas]);
  await page.getByText('片段'.repeat(30), { exact: true }).waitFor();
  await send([
    append('item/agentMessage/delta', { itemId: 'background', delta: '另一个会话的输出' }, 's2'),
  ]);
  await page.waitForTimeout(1300);
  assert.equal(count('sessions.history'), reads, 'text fragments must never refetch history');
  assert.equal(
    count('snapshot.get'),
    snapshots,
    'other-session streaming must not refresh the current view',
  );
  assert.equal(await page.getByText('另一个会话的输出', { exact: true }).count(), 0);

  await page.locator('.tool-record > summary').first().click();
  await page.locator('.timeline').hover();
  await page.mouse.wheel(0, 1100);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(150);
  const before = await anchor();
  const replaysBeforeDisconnect = count('events.replay');
  // Disconnect without deleting the view; the host continues producing events.
  state.delayReplay = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.locator('[data-connection-state="retrying"]').waitFor();
  assert.equal(await page.getByText('片段'.repeat(30), { exact: true }).count(), 1);
  const missed = append('item/agentMessage/delta', { delta: '断线期间的内容' });
  append('item/completed', {
    item: { id: 'stream-answer', type: 'agentMessage', text: '最终结果' },
  });
  append(undefined, {}, 's1', 'turn.completed');
  state.running = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator('[data-connection-state="syncing"]').waitFor();
  assert.equal(
    await page.getByText('片段'.repeat(30), { exact: true }).count(),
    1,
    'sync retains the last readable view',
  );
  await pending(state.replayPending);
  // The same missed frame arrives on the live socket before replay finishes.
  await send([missed]);
  state.delayReplay = false;
  while (state.replayPending.length) state.replayPending.shift()();
  await ready();
  await page.getByText('最终结果', { exact: true }).waitFor();
  await page.locator('.assistant-turn .message-actions').waitFor();
  assert.equal(
    await page.locator('.assistant-turn .message-actions').count(),
    1,
    'completed answer has exactly one action group',
  );
  assert.equal(await page.getByText('最终结果', { exact: true }).count(), 1);
  assert.equal(
    await page.getByText('片段'.repeat(30), { exact: true }).count(),
    0,
    'shorter authoritative completion replaces partial text',
  );
  assert.equal(
    count('sessions.history'),
    reads,
    'ordinary reconnect must not fetch the latest or old history again',
  );
  assert.equal(count('events.replay'), replaysBeforeDisconnect + 1);
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), '保留中的草稿');
  assert.notEqual(
    await page.locator('.tool-record').first().getAttribute('open'),
    null,
    'expanded tools survive reconnect',
  );
  const after = await anchor();
  assert.equal(after.key, before.key);
  assert.ok(
    Math.abs(after.screenTop - before.screenTop) < 2,
    'reconnect keeps the message at the same screen position when status rows change height',
  );
  await page.getByRole('button', { name: '有新进展，查看最新', exact: true }).waitFor();
  await page.locator('.connection-recovery').waitFor({ state: 'hidden' });
  await page.locator('.task-progress').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.connection-recovery').count(), 0);
  assert.equal(
    await page.locator('.task-progress').count(),
    0,
    'completion while offline clears running state',
  );

  // Upward navigation, not mount/reconnect/resize, asks for the older page.
  state.delayOlder = true;
  await page.locator('.timeline').focus();
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: '加载中…', exact: true }).waitFor();
  await pending(state.olderPending);
  const readingTop = await anchor();
  state.delayOlder = false;
  while (state.olderPending.length) state.olderPending.shift()();
  await page.getByText('较早的消息 0', { exact: false }).waitFor();
  const loadedTop = await page
    .locator('[data-history-key]')
    .evaluateAll(
      (nodes, key) =>
        nodes.find((node) => node.dataset.historyKey === key)?.getBoundingClientRect().top,
      readingTop.key,
    );
  assert.ok(
    Math.abs(loadedTop - readingTop.screenTop) < 2,
    'prepending keeps the visible message stationary',
  );
  assert.equal(count('sessions.history'), reads + 1);
  await page.getByRole('button', { name: /回到最新|有新进展，查看最新/ }).click();
  await page.waitForFunction(() => {
    const node = document.querySelector('.timeline');
    return node.scrollHeight - node.scrollTop - node.clientHeight < 50;
  });
  assert.ok(
    await page
      .locator('.timeline')
      .evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight < 50),
  );

  await page
    .locator('.assistant-turn')
    .filter({ has: page.getByText('最终结果', { exact: true }) })
    .getByRole('button', { name: '阅读完整消息', exact: true })
    .click();
  const reader = page.locator('.message-reader');
  await reader.getByText('最终结果', { exact: true }).waitFor();
  assert.ok((await reader.innerText()).includes('阅读位置 17'), 'reader combines the whole answer');
  await page.keyboard.press('Escape');
  await reader.waitFor({ state: 'detached' });

  // Retention expiry uses one baseline instead of an endless reconnect loop.
  state.replayGap = true;
  state.extra.push({
    turnId: 'native-turn',
    item: { id: 'stream-answer', type: 'agentMessage', text: '最终结果' },
  });
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.locator('[data-connection-state="retrying"]').waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await ready();
  state.replayGap = false;
  assert.equal(
    count('sessions.history'),
    reads + 2,
    'an expired cursor performs exactly one latest-page fallback',
  );
  assert.equal(await page.getByText('最终结果', { exact: true }).count(), 1);

  // An initial history read can overlap started/delta frames already represented
  // in that read. Those frames must not wipe the baseline or duplicate its text.
  state.running = true;
  state.extra.push({
    turnId: 'native-turn',
    item: { id: 'baseline-answer', type: 'agentMessage', text: '基线已经包含片段' },
  });
  state.delay = true;
  const beforeReload = count('sessions.history');
  await page.reload();
  await pending(state.pending);
  await send([
    append('item/started', {
      item: { id: 'baseline-answer', type: 'agentMessage', text: '' },
    }),
    append('item/agentMessage/delta', { itemId: 'baseline-answer', delta: '片段' }),
  ]);
  state.delay = false;
  while (state.pending.length) state.pending.shift()();
  await ready();
  await page.getByText('基线已经包含片段', { exact: true }).waitFor();
  await send([
    append('item/completed', {
      item: { id: 'baseline-answer', type: 'agentMessage', text: '基线后的最终结果' },
    }),
    append(undefined, {}, 's1', 'turn.completed'),
  ]);
  state.running = false;
  await page.getByText('基线后的最终结果', { exact: true }).waitFor();
  assert.equal(count('sessions.history'), beforeReload + 1, 'reload reads only one latest page');
  assert.deepEqual(errors, []);
  console.log(
    'Streaming acceptance passed: no per-delta/history refresh, resume/live deduplication, offline completion, distinct sync status, retained drafts/tools/anchor, upward pagination, cursor-expiry fallback.',
  );
} finally {
  state.delayReplay = false;
  state.delayOlder = false;
  state.delay = false;
  while (state.pending.length) state.pending.shift()();
  while (state.replayPending.length) state.replayPending.shift()();
  while (state.olderPending.length) state.olderPending.shift()();
  await browser?.close();
  await vite.close();
}

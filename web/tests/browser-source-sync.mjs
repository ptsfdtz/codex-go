/* global window, document, CustomEvent, Event */
// Controlled Bridge events exercise the real App; native file/API acceptance
// lives in execution::source_changes and uses two isolated Codex processes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { startConversationServer } from './conversation-server.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const { vite, state, origin } = await startConversationServer({
  cacheDir: join(process.cwd(), '.tmp/web-source-sync'),
});
state.extra = Array.from({ length: 12 }, (_, index) => ({
  turnId: 'native-turn',
  item: {
    id: 'saved-' + index,
    type: 'agentMessage',
    text: '已有正文 ' + index + '\n\n' + '阅读段落。'.repeat(100),
  },
}));
const count = (action) => state.rpc.filter((request) => request.action === action).length;
const event = (action = 'session.contentChanged', payload = {}, sessionId = 's1') => {
  const packet = {
    type: 'event',
    eventId: String(state.events.length + 1),
    sessionId,
    action,
    payload,
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
  await page.goto(origin);
  await page.locator('[data-connection-state="connected"]').waitFor();
  await page.getByText('已有正文 11', { exact: false }).waitFor();
  await page.getByLabel('消息', { exact: true }).fill('保留草稿');
  await page.locator('.tool-record > summary').first().click();
  await page.locator('.timeline').focus();
  await page.locator('.timeline').hover();
  await page.mouse.wheel(0, -100000);
  await page.waitForTimeout(150);
  await page.keyboard.press('Home');
  await page.getByText('较早的消息 0', { exact: false }).waitFor();
  await page.locator('.timeline').evaluate((node) => {
    node.scrollTop = 600;
  });
  await page.waitForTimeout(150);
  const anchor = () =>
    page.evaluate(() => {
      const node = document.querySelector('.timeline');
      const top = node.getBoundingClientRect().top;
      const item = [...node.querySelectorAll('[data-history-key]')].find(
        (item) => item.getBoundingClientRect().bottom > top,
      );
      return { key: item.dataset.historyKey, top: item.getBoundingClientRect().top };
    });
  const before = await anchor();
  let reads = count('sessions.history');
  state.extra.push({
    turnId: 'source-turn',
    item: { id: 'source-answer', type: 'agentMessage', text: '桌面保存的新内容' },
  });
  await send(Array.from({ length: 20 }, () => event()));
  await page.getByText('桌面保存的新内容', { exact: true }).waitFor();
  assert.equal(count('sessions.history'), reads + 1, 'a write burst reads one latest page');
  assert.equal(
    await page.getByText('较早的消息 0', { exact: false }).count(),
    1,
    'older pages stay loaded',
  );
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), '保留草稿');
  assert.equal(await page.locator('.tool-record').first().getAttribute('open'), '');
  const after = await anchor();
  assert.equal(after.key, before.key);
  assert.ok(Math.abs(after.top - before.top) < 2, 'source refresh retains reading position');
  reads = count('sessions.history');
  await send([event('session.contentChanged', {}, 's2')]);
  await page.waitForTimeout(400);
  assert.equal(
    count('sessions.history'),
    reads,
    'background conversations do not read selected history',
  );

  state.extra.push({
    turnId: 'fallback-turn',
    item: { id: 'fallback-answer', type: 'agentMessage', text: '定期核对补回遗漏内容' },
  });
  await send([event('sessions.synced', { contentSessionIds: ['s2'] }, null)]);
  await page.waitForTimeout(400);
  assert.equal(count('sessions.history'), reads, 'index hints target the changed conversation');
  await send([event('sessions.synced', { contentSessionIds: ['s1'] }, null)]);
  await page.getByText('定期核对补回遗漏内容', { exact: true }).waitFor();
  assert.equal(count('sessions.history'), reads + 1, 'index reconciliation recovers a missed hint');

  state.delay = true;
  await send([event()]);
  const deadline = Date.now() + 5000;
  while (!state.pending.length && Date.now() < deadline) await page.waitForTimeout(20);
  assert.equal(state.pending.length, 1);
  await send([
    event('upstream.progress', {
      method: 'item/agentMessage/delta',
      upstreamTurnId: 'source-turn',
      itemId: 'source-answer',
      delta: '，随后到达的流式文字',
    }),
  ]);
  await page.getByText('桌面保存的新内容，随后到达的流式文字', { exact: true }).waitFor();
  state.delay = false;
  while (state.pending.length) state.pending.shift()();
  await page.waitForTimeout(150);
  assert.equal(
    await page.getByText('桌面保存的新内容，随后到达的流式文字', { exact: true }).count(),
    1,
    'late reads cannot replace newer deltas',
  );

  await page.evaluate(() =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }),
  );
  reads = count('sessions.history');
  state.extra.push({
    turnId: 'source-turn',
    item: { id: 'hidden-answer', type: 'agentMessage', text: '后台期间保存' },
  });
  await send([event()]);
  await page.waitForTimeout(400);
  assert.equal(count('sessions.history'), reads, 'hidden pages defer content reads');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByText('后台期间保存', { exact: true }).waitFor();
  assert.equal(
    count('sessions.history'),
    reads + 1,
    'returning to the page reconciles history once',
  );
  reads = count('sessions.history');
  await page.waitForTimeout(1200);
  assert.equal(count('sessions.history'), reads, 'idle pages never poll history');
  assert.deepEqual(errors, []);
  console.log(
    'Source sync acceptance passed: coalesced events, targeted latest-page reads, preserved drafts/tools/older pages/anchor, concurrent delta protection, foreground recovery, no history polling.',
  );
} finally {
  state.delay = false;
  while (state.pending.length) state.pending.shift()();
  await browser?.close();
  await vite.close();
}

import { fileURLToPath } from 'node:url';
/* global window, document, localStorage, Storage */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/task-notifications/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [],
  errors = [];
let page;
try {
  page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1200, height: 850 } });
  page.setDefaultTimeout(9000);
  page.on('pageerror', (e) => errors.push(e.message));
  let ready = false;
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, (route) => route.abort());
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const value = path.endsWith('/web/session')
      ? { accountId: 'attention-test', cloudDeviceId: 'browser', mustChangePassword: false }
      : path.endsWith('/web/csrf')
        ? { csrfToken: 'test-only' }
        : path === '/api/v1/hosts'
          ? {
              hosts: [
                {
                  hostId: 'host-test',
                  displayName: 'Test Host',
                  online: true,
                  customNameConfigured: true,
                },
              ],
            }
          : path.endsWith('/access')
            ? {
                hostId: 'host-test',
                fingerprint: 'a'.repeat(64),
                credential: 'b'.repeat(43),
                endpoints: [],
              }
            : {};
    return route.fulfill({ status: ready ? 200 : 401, json: value });
  });
  if (process.env.COMPOSER_TEST_FONT)
    await page.route('**/__attention-font', (route) =>
      route.fulfill({ path: process.env.COMPOSER_TEST_FONT }),
    );
  await page.goto(process.env.TASK_NOTIFICATIONS_TEST_ORIGIN || 'http://127.0.0.1:1434/');
  await page.getByRole('button', { name: '登录', exact: true }).waitFor();
  ready = true;
  await page.evaluate(async (font) => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Bridge } = await import('/src/transport/bridge.ts');
    window.testSnapshot = {
      cursor: '1',
      projects: [{ projectId: 'p', name: 'Project' }],
      sessions: [
        { sessionId: 'main', projectId: 'p', title: 'Current conversation', status: 'idle' },
        { sessionId: 'other', projectId: 'p', title: 'Review changes', status: 'idle' },
        {
          sessionId: 'third',
          projectId: 'p',
          title: 'Choose the next step',
          status: 'idle',
          pinned: 1,
        },
      ],
      turns: [],
      approvals: [],
    };
    window.calls = [];
    window.systemNotices = [];
    window.Notification = class {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
      constructor(title, options) {
        window.systemNotices.push({ title, ...options });
      }
    };
    Bridge.prototype.connect = async function () {
      window.testBridge = this;
      this.hostId = 'host-test';
    };
    Bridge.prototype.probe = async () => undefined;
    Bridge.prototype.reconcile = async () => undefined;
    Bridge.prototype.request = async function (action, payload) {
      window.calls.push({ action, payload });
      if (action === 'snapshot.get') return structuredClone(window.testSnapshot);
      if (action === 'events.replay')
        return { events: [], cursor: window.testSnapshot.cursor, hasMore: false };
      if (action === 'system.capabilities') return { features: { sessionManagement: true } };
      if (action === 'models.list')
        return { models: [{ id: 'test', model: 'test', name: 'Test model', isDefault: true }] };
      if (action === 'sessions.history') return { data: [] };
      return {};
    };
    window.emit = (packet) => {
      const event = {
        ...packet,
        type: 'event',
        eventId: String(Number(window.testSnapshot.cursor) + 1),
      };
      window.testSnapshot.cursor = event.eventId;
      [...window.testBridge.events].forEach((handler) => handler(event));
    };
    if (font) {
      const style = document.createElement('style');
      style.textContent =
        "@font-face{font-family:AttentionTest;src:url('/__attention-font')} :root{font-family:AttentionTest,sans-serif}";
      document.head.append(style);
    }
    localStorage.setItem('agentdeck.web.selection.attention-test:browser.host-test', 'main');
    document.getElementById('root').style.display = 'none';
    const fixture = document.createElement('main');
    fixture.id = 'attention-test';
    document.body.append(fixture);
    const { App } = await import('/src/App.tsx');
    window.remount = () => {
      window.testRoot?.unmount();
      window.testBridge = undefined;
      window.testRoot = (dom.default || dom).createRoot(fixture);
      window.testRoot.render(React.createElement(App));
    };
    window.remount();
  }, Boolean(process.env.COMPOSER_TEST_FONT));
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.waitFor();
  await page.getByRole('button', { name: '收起会话列表', exact: true }).click();
  await input.fill('Keep this draft and focus');
  await page.evaluate(() =>
    window.emit({
      action: 'turn.completed',
      sessionId: 'other',
      turnId: 'local-1',
      payload: { turn: { turnId: 'local-1', upstreamTurnId: 'native-1', status: 'completed' } },
    }),
  );
  const notices = page.getByRole('region', { name: '任务提醒', exact: true });
  await notices.getByText('任务已完成', { exact: true }).waitFor();
  assert(await input.evaluate((el) => el === document.activeElement));
  assert.equal(await input.inputValue(), 'Keep this draft and focus');
  const toggle = page.getByRole('button', { name: '打开会话列表', exact: true });
  assert.equal(await toggle.locator('.notification-dot').count(), 1);
  await page.evaluate(() =>
    window.emit({
      action: 'upstream.turn.completed',
      sessionId: 'other',
      payload: { upstreamTurnId: 'native-1', status: 'completed' },
    }),
  );
  await page.waitForTimeout(160);
  assert.equal(await notices.locator('.task-notification').count(), 1);
  await notices.getByRole('button', { name: '关闭提醒', exact: true }).click();
  assert.equal(await notices.locator('.task-notification').count(), 0);
  assert.equal(await toggle.locator('.notification-dot').count(), 1);
  await toggle.click();
  const row = page
    .getByRole('navigation', { name: '最近对话列表', exact: true })
    .locator('[data-session-id="other"]');
  assert.equal(await row.locator('.session-unread-dot').count(), 1);
  await row.locator('.session').click();
  assert.equal(await row.locator('.session-unread-dot').count(), 0);
  assert.equal(await toggle.locator('.notification-dot').count(), 0);
  checks.push(
    'background conversation completion, card/hamburger/session blue dots, no focus theft, native/local dedup, dismiss keeps unread, opening clears unread',
  );

  await page.evaluate(() => {
    window.emit({
      action: 'upstream.progress',
      sessionId: 'third',
      payload: {
        method: 'item/completed',
        item: {
          id: 'async-1',
          type: 'agentMessage',
          questions: [{ title: 'Which plan should run?', options: ['A', 'B'] }],
        },
      },
    });
    window.emit({
      action: 'upstream.turn.completed',
      sessionId: 'third',
      payload: { upstreamTurnId: 'question-turn', status: 'completed' },
    });
  });
  const marked = page.getByRole('navigation', { name: '已标记对话列表', exact: true });
  await marked.locator('.session-unread-dot').waitFor();
  assert.equal(await notices.locator('.task-notification').count(), 0);
  assert.equal(await marked.locator('.session-unread-dot').count(), 1);
  await marked.locator('.session').click();
  await page
    .locator('.workspace-title:visible')
    .filter({ hasText: 'Choose the next step' })
    .waitFor();
  assert.equal(await marked.locator('.session-unread-dot').count(), 0);
  await page.evaluate(() =>
    window.emit({
      action: 'turn.failed',
      sessionId: 'third',
      turnId: 'fail-1',
      payload: { turn: { status: 'failed' } },
    }),
  );
  await notices.getByText('任务执行失败', { exact: true }).waitFor();
  // A currently selected conversation still receives an explicit notification.
  assert.equal(
    await page
      .getByRole('button', { name: '收起会话列表', exact: true })
      .locator('.notification-dot')
      .count(),
    1,
  );
  await input.fill('Interaction acknowledges current result');
  assert.equal(await notices.locator('.task-notification').count(), 0);
  await page.evaluate(() =>
    window.emit({
      action: 'approval.requested',
      sessionId: 'main',
      payload: { approvalId: 'question-1', method: 'item/tool/requestUserInput' },
    }),
  );
  await page
    .getByRole('navigation', { name: '最近对话列表', exact: true })
    .locator('[data-session-id="main"] .session-unread-dot')
    .waitFor();
  assert.equal(await notices.locator('.task-notification').count(), 0);
  await page.evaluate(() =>
    window.emit({
      action: 'approval.requested',
      sessionId: 'other',
      payload: { approvalId: 'approval-1', method: 'item/commandExecution/requestApproval' },
    }),
  );
  await notices.getByText('需要你的审批', { exact: true }).waitFor();
  assert.equal(await notices.locator('.task-notification').count(), 1);
  checks.push(
    'async/native questions show blue dots without top-right cards; question priority, marked row dot, selected conversation failure, read on interaction, approval alert',
  );

  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: fileURLToPath(new URL('notifications-sidebar-dark.png', out)) });
  await page.getByRole('button', { name: '收起会话列表', exact: true }).click();
  await page.waitForTimeout(350);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    for (const width of [1200, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const cards = await notices.locator('.task-notification').all();
      for (const card of cards) {
        const box = await card.boundingBox();
        assert(
          box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 850,
        );
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({
        path: fileURLToPath(new URL(`notifications-${theme}-${width}.png`, out)),
      });
    }
  }
  await page.evaluate(() => window.remount());
  await page.waitForFunction(() => !!window.testBridge);
  await page
    .locator('#attention-test [data-connection-state=connected]')
    .waitFor({ state: 'attached' });
  await input.waitFor();
  assert.equal(await notices.locator('.task-notification').count(), 0);
  assert.equal(await toggle.locator('.notification-dot').count(), 1);
  await page.evaluate(() =>
    window.emit({
      action: 'approval.requested',
      sessionId: 'main',
      payload: { approvalId: 'question-1', method: 'item/tool/requestUserInput' },
    }),
  );
  await page.waitForTimeout(160);
  assert.equal(await notices.locator('.task-notification').count(), 0);
  checks.push(
    'dark/light 320/390/1200px bounds, unread survives remount while replayed events do not repopup',
  );

  await page.evaluate(async () => {
    const { TaskAttention, packetNotice } = await import(
      '/src/features/notifications/task-attention.ts'
    );
    const assert = (condition) => {
      if (!condition) throw new Error('Attention storage assertion failed');
    };
    const store = new TaskAttention('test-attention-store');
    const notice = packetNotice({ action: 'turn.completed', sessionId: 's', turnId: 'turn' });
    store.receive(notice);
    const saved = new TaskAttention('test-attention-store');
    assert(
      saved.getSnapshot().unread.s === 'completed' && saved.getSnapshot().notices.length === 0,
    );
    assert(new TaskAttention('different-account-host').getSnapshot().unread.s === undefined);
    saved.read('s');
    assert(saved.receive(notice) === undefined && saved.getSnapshot().notices.length === 0);
    for (let i = 0; i < 600; i++)
      store.receive({ sessionId: `s-${i}`, kind: 'completed', keys: [String(i)] });
    const persisted = JSON.parse(localStorage.getItem('test-attention-store'));
    assert(
      persisted.seen.length <= 512 &&
        Object.keys(persisted.unread).length <= 128 &&
        store.getSnapshot().notices.length === 3,
    );
    const original = Storage.prototype.setItem;
    try {
      Storage.prototype.setItem = () => {
        throw new Error('Storage unavailable');
      };
      const memory = new TaskAttention('memory-only');
      memory.receive(notice);
      assert(memory.getSnapshot().unread.s === 'completed');
    } finally {
      Storage.prototype.setItem = original;
    }
    localStorage.setItem('agentdeck.web.notifications', 'true');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    window.remount();
  });
  await page.waitForFunction(() => !!window.testBridge);
  await page
    .locator('#attention-test [data-connection-state=connected]')
    .waitFor({ state: 'attached' });
  await input.waitFor();
  await page.evaluate(() =>
    window.emit({ action: 'turn.completed', sessionId: 'other', turnId: 'system-1' }),
  );
  // The previous unread approval takes priority, so use a fresh conversation for the system completion.
  await page.evaluate(() =>
    window.emit({ action: 'turn.completed', sessionId: 'third', turnId: 'system-2' }),
  );
  await page.waitForFunction(() => window.systemNotices.length > 0);
  assert((await page.evaluate(() => window.systemNotices.at(-1).title)).includes('任务已完成'));
  assert.equal(
    await page.evaluate(() =>
      window.calls.some(({ action }) => /^(turn\.(start|steer)|approvals\.decide)$/.test(action)),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  await page.evaluate(() => {
    window.emit({
      action: 'approval.resolved',
      sessionId: 'other',
      payload: { approvalId: 'approval-1', status: 'approved' },
    });
    window.emit({ action: 'turn.completed', sessionId: 'other', turnId: 'after-approval' });
  });
  await page.waitForFunction(() => window.systemNotices.some((n) => n.tag.endsWith(':other')));
  // Reconnection may provide authoritative terminal state even when replay has expired.
  await page.evaluate(() => {
    window.testSnapshot.turns = [
      { sessionId: 'third', turnId: 'snapshot-turn', status: 'running' },
    ];
    window.emit({ action: 'sessions.synced', payload: {} });
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.testSnapshot.turns[0].status = 'completed';
    window.emit({ action: 'sessions.synced', payload: {} });
  });
  await page.waitForFunction(
    () => window.systemNotices.filter((n) => n.tag.endsWith(':third')).length >= 2,
  );
  checks.push(
    'resolved approval no longer blocks completion; running-to-terminal snapshot recovery',
  );
  checks.push(
    'account/host isolation, bounded metadata-only storage, unavailable-storage fallback, opt-in hidden-page system notification, no mutation/approval actions',
  );
  await writeFile(
    new URL('verification.json', out),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        checks,
        errors,
        scope:
          'Controlled real App and notification store; no production account/Host/model actions.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`PASS: ${checks.join('; ')}`);
} catch (error) {
  if (page)
    await page.screenshot({ path: fileURLToPath(new URL('failure.png', out)) }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}

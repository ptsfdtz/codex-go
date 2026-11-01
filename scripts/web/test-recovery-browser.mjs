/* global window, document, localStorage, StorageEvent, queueMicrotask */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.RECOVERY_TEST_ORIGIN || 'http://127.0.0.1:1500/';
const out = new URL('../../artifacts/recovery/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [],
  errors = [];
async function installHost() {
  const { HostSocket } = await import('/src/transport/host.ts');
  window.calls = [];
  window.sockets = [];
  window.status = 'unknown';
  window.holdStatus = false;
  window.holdMutations = false;
  window.holdHistory = false;
  window.holdHello = false;
  window.failSnapshot = false;
  window.failStatus = false;
  window.receiptKey = 'agentdeck.web.receipts.recovery-test:browser.host-test';
  window.testSnapshot = {
    cursor: '1',
    projects: [{ projectId: 'p1', name: 'Recovery project', canonicalPath: '/test/recovery' }],
    sessions: [
      { sessionId: 'main', projectId: 'p1', title: 'Recovery conversation', status: 'idle' },
    ],
    turns: [],
    approvals: [],
  };
  class FakeSocket {
    static async connect() {
      const socket = new FakeSocket();
      window.sockets.push(socket);
      return socket;
    }
    receive(handler, ended) {
      this.handler = handler;
      this.ended = ended;
    }
    close() {
      this.closed = true;
    }
    respond(request, payload, code) {
      queueMicrotask(() =>
        this.handler(
          JSON.stringify(
            code
              ? { type: 'error', id: request.id, code, message: 'Controlled failure' }
              : { type: 'response', id: request.id, payload },
          ),
        ),
      );
    }
    async send(text) {
      const request = JSON.parse(text);
      window.calls.push(request);
      const { action, payload } = request;
      if (
        (action === 'system.hello' && window.holdHello) ||
        (action === 'sessions.history' && window.holdHistory) ||
        (action === 'turn.start' && window.holdMutations) ||
        (action === 'requests.status' && window.holdStatus)
      ) {
        (this.held ||= []).push(request);
        return;
      }
      if (action === 'system.hello') return this.respond(request, { hostId: 'host-test' });
      if (action === 'requests.status') {
        if (window.failStatus) return this.respond(request, null, 'CONTROLLED_READ_FAILURE');
        return this.respond(request, {
          status: window.status,
          ...(window.status === 'done'
            ? {
                response: {
                  id: window.wrongReceipt ? 'wrong-id' : payload.requestId,
                  ...(window.rejection
                    ? { type: 'error', code: 'CONFLICT', message: 'Session is busy' }
                    : { type: 'response', payload: {} }),
                },
              }
            : {}),
        });
      }
      if (action === 'snapshot.get')
        return this.respond(
          request,
          window.testSnapshot,
          window.failSnapshot ? 'CONTROLLED_READ_FAILURE' : undefined,
        );
      if (action === 'system.capabilities')
        return this.respond(request, { features: { nativeQueue: true }, limits: {} });
      if (action === 'models.list') return this.respond(request, { models: [] });
      if (action === 'sessions.history')
        return this.respond(request, {
          data: [
            {
              turnId: 'saved',
              item: {
                id: 'msg',
                type: 'agentMessage',
                text: 'Saved conversation',
                status: 'completed',
              },
            },
          ],
          nextCursor: null,
        });
      if (action === 'events.since') return this.respond(request, { events: [], cursor: '1' });
      if (action === 'turn.start') return this.respond(request, { turn: { turnId: 'new-turn' } });
      this.respond(request, {});
    }
  }
  HostSocket.connect = FakeSocket.connect;
  window.seedReceipt = (status, id = 'web-legacy') => {
    window.status = status;
    localStorage.setItem(window.receiptKey, JSON.stringify([id]));
    window.dispatchEvent(new StorageEvent('storage', { key: window.receiptKey }));
  };
}
try {
  const context = await browser.newContext({ locale: 'zh-CN', reducedMotion: 'reduce' });
  let ready = false;
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, (r) => r.abort());
  await context.route('**/api/**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    const value = path.endsWith('/web/session')
      ? { accountId: 'recovery-test', cloudDeviceId: 'browser', mustChangePassword: false }
      : path === '/api/v1/hosts'
        ? {
            hosts: [
              {
                hostId: 'host-test',
                customName: 'Recovery Host',
                customNameConfigured: true,
                online: true,
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
          : { csrfToken: 'test-only' };
    await r.fulfill({ status: ready ? 200 : 401, json: value });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByRole('button', { name: '登录', exact: true }).waitFor();
  await page.evaluate(installHost);
  await page.evaluate(async () => {
    window.seedReceipt('unknown');
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { App } = await import('/src/App.tsx');
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('div');
    host.id = 'recovery-app';
    document.body.append(host);
    window.recoveryRoot = (dom.default || dom).createRoot(host);
    window.mountRecovery = () => window.recoveryRoot.render(React.createElement(App));
  });
  ready = true;
  await page.evaluate(() => window.mountRecovery());
  const app = page.locator('#recovery-app');
  const verify = () => app.getByRole('button', { name: '核对操作结果', exact: true });
  const review = () => app.getByRole('checkbox', { name: '我已核对实际结果，确认可以继续操作' });
  const confirm = () => app.getByRole('button', { name: '确认核对并恢复编辑' });
  const input = app.getByRole('textbox', { name: '消息', exact: true });
  await verify().waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector('#recovery-app button[disabled]') ||
      window.calls.some((c) => c.action === 'sessions.history'),
  );
  await verify().click();
  await app.getByText('电脑保存的操作结果不确定，需要人工核对实际结果。').waitFor();
  assert.equal(await input.getAttribute('placeholder'), '操作结果待核对，请先查看上方提示');
  assert.equal(await confirm().isDisabled(), true);
  await page.evaluate(() => {
    window.status = 'pending';
    window.holdStatus = true;
  });
  const before = await page.evaluate(
    () => window.calls.filter((c) => c.action === 'requests.status').length,
  );
  await verify().click();
  await app.getByRole('button', { name: '正在核对操作结果…' }).waitFor();
  await page.evaluate(() =>
    document.querySelector('#recovery-app .receipt-recovery-heading button').click(),
  );
  await page.waitForFunction(() => window.sockets[0].held?.length);
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.action === 'requests.status').length),
    before + 1,
  );
  await page.evaluate(() => {
    window.holdStatus = false;
    const socket = window.sockets[0];
    for (const r of socket.held.splice(0)) socket.respond(r, { status: 'pending' });
  });
  await app.getByText('电脑仍在处理此操作，请稍后再次核对。').waitFor();
  assert.equal(await review().count(), 0);
  checks.push(
    'real App: verification visibly loads, prevents duplicate clicks, explains pending state and keeps sending blocked',
  );

  await page.evaluate(() => {
    window.failStatus = true;
  });
  await verify().click();
  await app.getByText('未能查询操作结果，请重试；暂时保留发送保护。').waitFor();
  assert.equal(await review().count(), 0);
  await page.evaluate(() => {
    window.failStatus = false;
    window.status = 'unknown';
  });
  await verify().click();
  await review().check();
  await page.evaluate(() => {
    window.status = 'pending';
  });
  await confirm().click();
  await app.getByText('操作仍在处理或核对失败，暂时不能恢复编辑。').waitFor();
  assert.ok(await page.evaluate(() => localStorage.getItem(window.receiptKey)));
  checks.push(
    'failed lookups and status changes during manual review cannot remove the reservation',
  );

  await page.evaluate(() => {
    window.status = 'unknown';
  });
  await verify().click();
  await review().check();
  await confirm().click();
  await app.getByText('已确认核对，草稿已保留；不会自动重发。').waitFor();
  assert.equal(await input.isEnabled(), true);
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.action === 'turn.start').length),
    0,
  );
  await input.fill('必须保留且不能自动重发的草稿');
  await page.evaluate(() => window.seedReceipt('notFound'));
  await verify().click();
  await app.getByText('电脑未找到此操作回执，需要人工核对实际结果。').waitFor();
  for (const width of [1100, 390, 320])
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      const box = await app.locator('.receipt-recovery').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      await page.screenshot({ path: new URL(`review-${width}-${theme}.png`, out).pathname });
    }
  await review().check();
  await confirm().click();
  await app.getByText('已确认核对，草稿已保留；不会自动重发。').waitFor();
  assert.equal(await input.inputValue(), '必须保留且不能自动重发的草稿');
  checks.push(
    'unknown and legacy notFound receipts require explicit review, preserve drafts, never resend, and fit 320/390/1100px themes',
  );

  await page.evaluate(() => {
    window.rejection = true;
    window.seedReceipt('done');
  });
  // Storage notification shows the blocking banner until the explicit check settles it.
  await verify().click();
  await app.getByText(/操作已拒绝：/).waitFor();
  assert.equal(await input.isEnabled(), true);
  assert.equal(await input.inputValue(), '必须保留且不能自动重发的草稿');
  checks.push('a lost definite rejection resolves automatically and shows its actual reason');
  await page.evaluate(() => window.recoveryRoot.unmount());

  // Exercise the actual Bridge with real Web Locks and virtual time; the fake
  // HostSocket provides only controlled responses, never real network access.
  const q = await context.newPage();
  q.on('pageerror', (e) => errors.push(e.message));
  await q.route('**/api/v1/web/session', (r) => r.fulfill({ status: 401, json: {} }));
  await q.goto(origin);
  await q.evaluate(installHost);
  await q.evaluate(async () => {
    const { Bridge } = await import('/src/transport/bridge.ts');
    window.bridge = new Bridge('recovery-test:browser');
    await window.bridge.connect({ hostId: 'host-test' });
    window.events = [];
    window.bridge.onEvent((e) => window.events.push(e));
  });
  await q.clock.install();
  await q.evaluate(() => {
    window.holdHistory = true;
    window.read = window.bridge.request('sessions.history').catch((e) => e.message);
  });
  await q.clock.fastForward(60000);
  await q.evaluate(() => {
    window.holdMutations = true;
    window.mutation = window.bridge.request('turn.start').catch((e) => e.message);
  });
  await q.waitForFunction(() => window.calls.some((c) => c.action === 'turn.start'));
  await q.clock.fastForward(30100);
  assert.equal(await q.evaluate(() => Boolean(window.sockets[0].closed)), false);
  assert.equal(await q.evaluate(() => window.bridge.awaitingReceipt), false);
  await q.evaluate(() => {
    const socket = window.sockets[0];
    const request = socket.held.find((r) => r.action === 'turn.start');
    socket.respond(request, {});
  });
  await q.evaluate(() => window.mutation);
  checks.push(
    'slow history timeout probes a live connection without cancelling a simultaneous mutation',
  );

  await q.evaluate(() => {
    window.mutation = window.bridge.request('turn.start').catch((e) => e.message);
  });
  await q.waitForFunction(() => window.calls.filter((c) => c.action === 'turn.start').length === 2);
  await q.clock.fastForward(90100);
  assert.equal(await q.evaluate(() => window.bridge.awaitingReceipt), true);
  assert.equal(await q.evaluate(() => Boolean(window.sockets[0].closed)), false);
  await q.evaluate(() => {
    const socket = window.sockets[0],
      request = socket.held.filter((r) => r.action === 'turn.start').at(-1);
    socket.respond(request, {});
  });
  await q.waitForFunction(() => !window.bridge.awaitingReceipt);
  assert.equal(
    await q.evaluate(() => window.calls.filter((c) => c.action === 'turn.start').length),
    2,
  );
  checks.push(
    'mutation timeout retains its receipt; a late success settles it without replaying the mutation',
  );

  const protections = await q.evaluate(async () => {
    const results = [];
    window.seedReceipt('unknown');
    window.failSnapshot = true;
    try {
      await window.bridge.acknowledgeReceipts(['web-legacy']);
    } catch {
      results.push(Boolean(localStorage.getItem(window.receiptKey)));
    }
    window.failSnapshot = false;
    window.seedReceipt('pending');
    try {
      await window.bridge.acknowledgeReceipts(['web-legacy']);
    } catch {
      results.push(Boolean(localStorage.getItem(window.receiptKey)));
    }
    window.seedReceipt('unknown', 'web-new-reservation');
    try {
      await window.bridge.acknowledgeReceipts(['web-legacy']);
    } catch {
      results.push(Boolean(localStorage.getItem(window.receiptKey)));
    }
    window.seedReceipt('done');
    window.wrongReceipt = true;
    results.push((await window.bridge.reconcile())[0].status === 'unavailable');
    window.wrongReceipt = false;
    localStorage.setItem(window.receiptKey, 'malformed');
    try {
      await window.bridge.reconcile();
    } catch {
      results.push(window.bridge.awaitingReceipt);
    }
    localStorage.removeItem(window.receiptKey);
    return results;
  });
  assert.deepEqual(protections, [true, true, true, true, true]);
  checks.push(
    'manual release rejects pending, unreadable snapshots, changed IDs, mismatched responses and malformed storage',
  );

  // Another actual tab sees the same reservation. The lock is held for the
  // original mutation, so even explicit review cannot overtake it.
  const other = await context.newPage();
  await other.route('**/api/v1/web/session', (r) => r.fulfill({ status: 401, json: {} }));
  await other.goto(origin);
  await other.evaluate(installHost);
  await other.evaluate(async () => {
    const { Bridge } = await import('/src/transport/bridge.ts');
    window.bridge = new Bridge('recovery-test:browser');
    await window.bridge.connect({ hostId: 'host-test' });
  });
  await q.evaluate(() => {
    window.mutation = window.bridge.request('turn.start').catch((e) => e.message);
  });
  await q.waitForFunction(() => window.calls.filter((c) => c.action === 'turn.start').length === 3);
  await other.evaluate(() => {
    window.reviewFinished = false;
    window.review = window.bridge
      .acknowledgeReceipts(JSON.parse(localStorage.getItem(window.receiptKey)))
      .finally(() => {
        window.reviewFinished = true;
      });
  });
  assert.equal(await other.evaluate(() => window.reviewFinished), false);
  await q.evaluate(() => {
    const socket = window.sockets[0],
      r = socket.held.filter((r) => r.action === 'turn.start').at(-1);
    socket.respond(r, {});
  });
  await other.waitForFunction(() => window.reviewFinished);
  assert.equal(await q.evaluate(() => window.bridge.awaitingReceipt), false);
  checks.push(
    'real cross-tab Web Lock prevents manual review from overtaking an in-flight mutation',
  );

  await q.evaluate(() => {
    window.holdHello = true;
    window.probe = window.bridge.probe().catch((e) => e.message);
  });
  await q.clock.fastForward(5100);
  assert.equal(await q.evaluate(() => window.sockets[0].closed), true);
  checks.push('an unresponsive liveness probe still closes a dead route for reconnect');
  assert.deepEqual(errors, []);
  await writeFile(
    new URL('verification.json', out),
    JSON.stringify({ checks, errors, realHost: false, realModel: false }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}

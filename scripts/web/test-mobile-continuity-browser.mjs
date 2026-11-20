/* global window, localStorage, document, Event */
import assert from 'node:assert/strict';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.REFERENCE_BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch({
  headless: true,
  executablePath: engine === chromium ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE : undefined,
});
const origin = process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1430';
try {
  const context = await browser.newContext({
    locale: 'en',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let identity = 'outage',
    refreshes = 0;
  await page
    .context()
    .route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, (route) => route.abort());
  await page.context().route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/web/session') && identity !== 'ready')
      return route.fulfill({ status: identity === 'outage' ? 503 : 401, json: {} });
    if (path.endsWith('/web/refresh')) {
      refreshes++;
      return route.fulfill({ status: identity === 'invalid' ? 401 : 503, json: {} });
    }
    const json = path.endsWith('/web/session')
      ? { accountId: 'mobile-test', cloudDeviceId: 'phone' }
      : path.endsWith('/hosts')
        ? {
            hosts: [
              { hostId: 'host', customName: 'Computer', customNameConfigured: true, online: true },
            ],
          }
        : path.endsWith('/access')
          ? {
              hostId: 'host',
              fingerprint: 'a'.repeat(64),
              credential: 'b'.repeat(43),
              endpoints: [],
            }
          : { csrfToken: 'test-only' };
    return route.fulfill({ status: 200, json });
  });
  async function bridge(tab = page) {
    await tab.evaluate(async () => {
      const { Bridge } = await import('/src/transport/bridge.ts');
      window.mobileCalls = [];
      Bridge.prototype.connect = async function () {
        this.hostId = 'host';
        window.mobileEmit = (event) =>
          this.events.forEach((handler) => handler({ type: 'event', ...event }));
      };
      Bridge.prototype.probe = Bridge.prototype.reconcile = async () => {};
      Bridge.prototype.request = async function (action, payload = {}) {
        window.mobileCalls.push(action);
        if (action === 'snapshot.get')
          return {
            cursor: '1',
            projects: window.revokedProject
              ? []
              : [{ projectId: 'pr', name: 'Project', canonicalPath: 'C:/test' }],
            sessions: window.revokedProject
              ? []
              : [{ sessionId: 's', projectId: 'pr', title: 'Mobile check' }],
            turns: [],
            approvals: [],
          };
        if (action === 'events.replay') return { events: [], cursor: '1', hasMore: false };
        if (action === 'system.capabilities') return { features: {} };
        if (action === 'models.list') return { models: [] };
        if (action === 'sessions.history') {
          const cursor = Number(payload.cursor || 0);
          const data = Array.from({ length: 50 }, (_, offset) => {
            const i = cursor + offset;
            return {
              turnId: i < 2 ? 't' : 'old',
              item: {
                id: 'tool' + i,
                type: 'commandExecution',
                command: 'demo',
                status: 'completed',
                aggregatedOutput: ['output two', 'output one'][i] || 'perf row ' + i,
              },
            };
          });
          return { data, nextCursor: cursor < 950 ? String(cursor + 50) : undefined };
        }
        if (action === 'turn.start' && window.suspendSend)
          return new Promise((resolve) => {
            window.releaseSend = () => resolve({});
          });
        return {};
      };
    });
  }
  async function reconnect(tab = page) {
    await bridge(tab);
    identity = 'ready';
    await tab.evaluate(() => window.dispatchEvent(new Event('online')));
    await tab.locator('.sidebar .session-title').first().waitFor({ state: 'attached' });
  }
  const settings = page.locator('.sidebar-mobile-settings');
  const localDraft = page.getByRole('checkbox', { name: /text drafts/ });
  const row = page.locator('.sidebar .session-title').first();
  const input = page.locator('.conversation textarea').first();
  await page.goto(origin);
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  identity = 'expired';
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/web/refresh')),
    page.evaluate(() => window.dispatchEvent(new Event('online'))),
  ]);
  assert(refreshes > 0);
  assert.equal(await page.locator('.login-form').count(), 0);
  await reconnect();
  await settings.click();
  await localDraft.waitFor();
  await page.goBack();
  await localDraft.waitFor({ state: 'hidden' });
  await page.goForward();
  await localDraft.waitFor();
  await page.goBack();
  await localDraft.waitFor({ state: 'hidden' });
  await page.locator('.sidebar .mode-trigger').click();
  await page.locator('.sidebar .mode-menu:popover-open').waitFor();
  await page.waitForFunction(() => window.history.state?.agentdeckMobile?.overlay === 1);
  await page.goBack();
  await page.locator('.sidebar .mode-menu:popover-open').waitFor({ state: 'hidden' });
  await page.locator('.shell.with-sidebar').waitFor();
  await row.click();
  for (let number = 1; number < 20; number++) await page.locator('.history-more').click();
  await page.locator('.history-more').waitFor({ state: 'detached' });
  await input.fill('private ephemeral text');
  assert(
    !(await page.evaluate(() => JSON.stringify(localStorage).includes('private ephemeral text'))),
  );
  await page.keyboard.press('Control+f');
  const dialog = page.locator('.main-panel-modal[open]');
  await page.evaluate(() => {
    const lower = String.prototype.toLowerCase;
    window.scannedHistory = 0;
    String.prototype.toLowerCase = function () {
      if (String(this).startsWith('perf row ')) window.scannedHistory++;
      return lower.call(this);
    };
  });
  await dialog.locator('input').fill('output two');
  await page.waitForFunction(() => window.scannedHistory >= 998);
  await dialog.locator('.search-result').first().click();
  await page.locator('.activity-stage[open] article.search-highlight').waitFor();
  await page.waitForFunction(() => !window.history.state?.agentdeckMobile?.view.panel);
  await page.evaluate(() => {
    window.scannedHistory = 0;
  });
  await input.pressSequentially('typing');
  let streamed = '';
  for (let i = 0; i < 5; i++) {
    await page.evaluate(
      (i) =>
        window.mobileEmit({
          action: 'turn.progress',
          sessionId: 's',
          eventId: String(i + 2),
          payload: {
            turnId: 'stream',
            method: 'item/agentMessage/delta',
            itemId: 'answer',
            delta: 'word ' + i + ' ',
          },
        }),
      i,
    );
    streamed += 'word ' + i + ' ';
    await page
      .locator('.timeline .assistant-turn')
      .getByText(streamed.trim(), { exact: true })
      .waitFor();
  }
  assert.equal(
    await page.evaluate(() => window.scannedHistory),
    0,
    'Closed search must not rescan 1,000 history items on typing or streaming',
  );
  console.log(
    '1,000 loaded items across 20 pages: search matched the folded output, then typing and five separately rendered stream updates caused zero rescans of the 998 tagged history rows.',
  );
  await page.goBack();
  await page.locator('.shell.with-sidebar').waitFor();
  await page.goForward();
  await page.locator('.shell:not(.with-sidebar)').waitFor();
  await page.locator('.conversation-back').click();
  await settings.click();
  await localDraft.click();
  await page.waitForFunction(
    () => document.querySelector('.settings-general input[type=checkbox]')?.checked,
  );
  await dialog.locator('.modal-title .icon-button').click();
  await row.click();
  await input.fill('remember on this device');
  await page.waitForFunction(() =>
    JSON.stringify(localStorage).includes('remember on this device'),
  );
  identity = 'outage';
  await page.reload();
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  await reconnect();
  // Reload restores the last authorized conversation and its opted-in text.
  await page.waitForFunction(
    () => document.querySelector('.conversation textarea')?.value === 'remember on this device',
  );
  await page.locator('.shell:not(.with-sidebar)').waitFor();
  assert.equal(await page.evaluate(() => window.mobileCalls.includes('turn.start')), false);
  // A fresh history entry models reopening the PWA after the browser discarded
  // its navigation stack. Only the existing, revalidated Host selection resumes.
  await page.evaluate(() => window.history.replaceState(null, ''));
  identity = 'outage';
  await page.reload();
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  await reconnect();
  await page.locator('.shell:not(.with-sidebar)').waitFor();
  assert.equal(await input.inputValue(), 'remember on this device');
  identity = 'outage';
  const second = await page.context().newPage();
  await second.goto(origin);
  await second.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  await reconnect(second);
  const secondInput = second.locator('.conversation textarea').first();
  await second.waitForFunction(
    () => document.querySelector('.conversation textarea')?.value === 'remember on this device',
  );
  await page.evaluate(() => {
    window.suspendSend = true;
  });
  await page.locator('.conversation .send-button').filter({ visible: true }).first().click();
  await page.waitForFunction(() => !!window.releaseSend);
  await secondInput.fill('second tab is still editing');
  await second.waitForFunction(() =>
    JSON.stringify(localStorage).includes('second tab is still editing'),
  );
  await page.evaluate(() => window.releaseSend());
  await page.waitForFunction(() => document.querySelector('.conversation textarea')?.value === '');
  assert(
    await page.evaluate(() => JSON.stringify(localStorage).includes('second tab is still editing')),
  );
  await second.evaluate(() => {
    window.revokedProject = true;
    window.mobileEmit({ action: 'sessions.synced', sessionId: 's', eventId: '2', payload: {} });
  });
  await second.locator('.shell.with-sidebar').waitFor();
  await second.waitForFunction(
    () => !JSON.stringify(localStorage).includes('second tab is still editing'),
  );
  assert.equal(await second.locator('.conversation textarea').count(), 0);
  await second.goForward();
  assert.equal(await second.locator('.conversation textarea').count(), 0);
  await second.close();
  console.log(
    'Two browser tabs: late send acknowledgement preserved newer text; project revocation removed its durable copy and prevented history restoration.',
  );
  await input.fill('clear when disabled');
  await page.waitForFunction(() => JSON.stringify(localStorage).includes('clear when disabled'));
  await page.locator('.conversation-back').click();
  await settings.click();
  await localDraft.click();
  await page.waitForFunction(() => !JSON.stringify(localStorage).includes('clear when disabled'));
  await page.evaluate(async () => {
    const { LocalTextDrafts } = await import('/src/features/local-text-drafts.ts');
    const a = new LocalTextDrafts('audit:phone'),
      b = new LocalTextDrafts('audit:phone');
    await a.setEnabled(true);
    await a.save('session', 'first');
    const old = a.revision('session');
    await b.save('session', 'second');
    await a.settle('session', old);
    if (a.restore('session') !== 'second') throw Error('Stale ACK erased updated text');
    const key = Object.keys(localStorage).find((key) => key.endsWith('/session'));
    const record = JSON.parse(localStorage.getItem(key));
    record.expires = Date.now() - 1;
    localStorage.setItem(key, JSON.stringify(record));
    await a.prune();
    if (a.restore('session') !== undefined || localStorage.getItem(key)) throw Error('Expiry');
    await a.setEnabled(false);
  });
  identity = 'invalid';
  await page.reload();
  await page.locator('.login-form').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: weak-network sign-in and refresh, mobile back/forward, lazy tool search, scoped seven-day drafts and guarded acknowledgements.',
  );
} finally {
  await browser.close();
}

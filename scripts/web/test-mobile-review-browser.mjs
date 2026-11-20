/* global window, document, localStorage, File, Event, atob, navigator, MessageEvent, location */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const origin = process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1430';
try {
  const page = await browser.newPage({
    locale: 'en',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let ready = false;
  await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (r) => r.abort());
  await page.route('**/api/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    const hosts = ['laptop', 'studio', 'offline'].map((hostId) => ({
      hostId,
      displayName: hostId,
      customNameConfigured: true,
      online: hostId !== 'offline',
    }));
    const value = path.endsWith('/web/session')
      ? { accountId: 'review', cloudDeviceId: 'phone' }
      : path.endsWith('/hosts')
        ? { hosts }
        : path.endsWith('/access')
          ? {
              hostId: path.split('/').at(-2),
              fingerprint: 'a'.repeat(64),
              credential: 'b'.repeat(43),
              endpoints: [],
            }
          : { csrfToken: 'browser-test' };
    return r.fulfill({ status: ready ? 200 : 503, json: value });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { Bridge } = await import('/src/transport/bridge.ts');
    const data = (id, text) => ({
      turnId: 'turn',
      item: { id, type: 'agentMessage', text, status: 'completed' },
    });
    window.reviewRequests = [];
    Bridge.prototype.connect = async function (grant) {
      this.hostId = grant.hostId;
    };
    Bridge.prototype.request = async function (action, p = {}) {
      window.reviewRequests.push({
        id: this.hostId,
        action,
        bytes: p.attachments?.[0] ? atob(p.attachments[0].data).length : undefined,
      });
      const id = this.hostId,
        sessionId = id + '-s';
      if (action === 'snapshot.get')
        return {
          cursor: '1',
          projects: [{ projectId: 'proj', name: 'Workspace' }],
          sessions: [{ sessionId, projectId: 'proj', title: id + ' thread', status: 'idle' }],
          turns: window.reviewRunning ? [{ sessionId, turnId: 'upload', status: 'running' }] : [],
          approvals:
            id === 'studio'
              ? [
                  {
                    sessionId,
                    approvalId: 'approval-s',
                    turnId: 'turn',
                    status: 'pending',
                    method: 'command',
                  },
                ]
              : [],
        };
      if (action === 'system.capabilities')
        return {
          features: {
            sessionHistorySearch: true,
            attachments: true,
            nativeQueue: true,
            nativeQueueAttachments: true,
            approvalStatus: true,
          },
          upstreamReady: true,
          limits: { attachmentBytes: 2097152, attachmentTotalBytes: 2097152, attachmentCount: 4 },
        };
      if (action === 'turn.start') {
        window.reviewRunning = true;
        return { turn: { turnId: 'upload', sessionId, status: 'running' } };
      }
      if (action === 'models.list') return { models: [] };
      if (
        action === 'approvals.status' &&
        p.sessionId === sessionId &&
        p.approvalId === 'approval-s'
      )
        return { status: 'approved' };
      if (action === 'sessions.history')
        return {
          data: [
            p.cursor === 'old'
              ? data('older', 'The full original message from last week.')
              : data('recent', 'Current message from ' + id),
          ],
        };
      if (action === 'sessions.historySearch')
        return {
          matches: [
            {
              sessionId,
              projectId: 'proj',
              turnId: 'turn',
              itemId: 'older',
              snippet: 'original message',
              pageCursor: 'old',
            },
          ],
          nextCursor: null,
          skippedSessions: 0,
        };
      return {};
    };
    localStorage.setItem('agentdeck.web.host.review:phone', 'laptop');
  });
  ready = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  try {
    await page.locator('.sidebar .session-title').first().waitFor({ state: 'attached' });
  } catch (error) {
    throw new Error(
      JSON.stringify(
        await page.evaluate(() => ({
          text: document.body.innerText.slice(0, 2000),
          requests: window.reviewRequests,
        })),
      ) +
        ' ' +
        errors.join(', '),
      { cause: error },
    );
  }
  await page.getByRole('button', { name: 'Needs my attention' }).click();
  await page.getByText('Computer offline. Pending items are unknown.').waitFor();
  await page.getByRole('button', { name: /studio thread/ }).click();
  await page.getByText('Current message from studio', { exact: true }).waitFor();
  await page.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent('message', {
        origin: location.origin,
        data: {
          type: 'agentdeck.openAttention',
          accountId: 'review',
          hostId: 'studio',
          sessionId: 'studio-s',
          approvalId: 'approval-s',
        },
      }),
    ),
  );
  await page.getByText('This request was approved.').waitFor();
  await page.keyboard.press('Control+k');
  await page.locator('#session-search').fill('a'.repeat(129));
  assert.equal(
    await page.getByRole('button', { name: 'Search message contents' }).isDisabled(),
    true,
  );
  await page.locator('#session-search').fill('original message');
  await page.getByRole('button', { name: 'Search message contents' }).click();
  await page.getByRole('button', { name: /studio thread.*original message/ }).click();
  await page.getByText('The full original message from last week.', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.reviewRequests.some(
        (r) => r.action.startsWith('turn.start') || r.action.startsWith('approvals.decide'),
      ),
    ),
    false,
  );

  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const main = page.locator('.conversation').first();
  const log = {
    name: 'upload.log',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(2 * 1024 * 1024, 65),
  };
  for (const [button, action] of [
    ['Send', 'turn.start'],
    ['Add to queue', 'queue.add'],
  ]) {
    await main.locator('input[type=file]:not([accept])').setInputFiles(log);
    await main.locator('.composer-attachment').getByText('upload.log').waitFor();
    await main.getByRole('button', { name: button, exact: true }).click();
    await page.waitForFunction(
      (method) =>
        window.reviewRequests.some(
          (r) => r.id === 'studio' && r.action === method && r.bytes === 2097152,
        ),
      action,
    );
    await main.locator('.composer-attachment').waitFor({ state: 'hidden' });
  }
  await page.evaluate(async () => {
    const { readAttachments } = await import('/src/features/composer-input.ts');
    const max = 2 * 1024 * 1024,
      file = (size) => new File([new Uint8Array(size)], 'trace.log', { type: 'text/plain' });
    const added = await readAttachments([file(max)], [], max, max);
    if (added[0]?.bytes !== max || atob(added[0].data).length !== max)
      throw Error('Incomplete payload');
    for (const operation of [
      () => readAttachments([file(max + 1)], [], max, max),
      () => readAttachments([file(1)], added, max, max),
      () => readAttachments([file(524289)], [], max),
    ]) {
      let rejected = false;
      try {
        await operation();
      } catch {
        rejected = true;
      }
      if (!rejected) throw Error('limit not enforced');
    }
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { CodePreview } = await import('/src/features/files/CodePreview.tsx');
    const holder = document.createElement('div');
    document.body.append(holder);
    holder.style.cssText = 'position:fixed;inset:0;background:white;z-index:99999';
    const root = (dom.default || dom).createRoot(holder);
    // Mount outside the App after the original-message modal closes.
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    const render = (text) =>
      root.render(
        React.createElement(CodePreview, {
          text,
          path: 'code.rs',
          diff: true,
          onScroll: () => {},
          review: {
            target: 'draft',
            base: 'abc1234',
            head: 'def5678',
            add: (comment) => {
              window.note = comment;
            },
          },
        }),
      );
    window.changeDiff = () => render('@@ -9 +9 @@\n-changed later\n+REPLACED');
    render('@@ -9 +9 @@\n-original\n+replacement');
  });
  await page.getByRole('button', { name: 'Comment on Old line 9' }).click();
  await page.getByRole('textbox', { name: 'Line comment' }).fill('Keep this validation');
  await page.evaluate(() => window.changeDiff());
  await page.getByRole('button', { name: 'Add to current draft' }).click();
  assert.equal(
    await page.evaluate(() => window.note),
    'code.rs · Old line 9 (abc1234 → def5678)\n-original\nKeep this validation',
  );
  await page.getByRole('button', { name: 'Comment on New line 9' }).click();
  await page.getByRole('textbox', { name: 'Line comment' }).fill('Rename this');
  await page.getByRole('button', { name: 'Add to current draft' }).click();
  assert.match(await page.evaluate(() => window.note), /New line 9.*\n\+REPLACED\nRename this/);
  const firstUse = await browser.newPage({
    locale: 'en',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  firstUse.on('pageerror', (e) => errors.push(e.message));
  await firstUse.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
  await firstUse.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith('/web/session')
      ? { accountId: 'first-use', cloudDeviceId: 'phone' }
      : path.endsWith('/hosts')
        ? { hosts: [] }
        : {};
    return route.fulfill({ status: 200, json });
  });
  await firstUse.goto(origin);
  await firstUse
    .getByRole('button', { name: 'Manage computers', exact: true })
    .click({ timeout: 5000 });
  await firstUse.getByText('Waiting for your computer to sign in to the same account').waitFor();
  const system = firstUse.getByRole('combobox', { name: 'Computer operating system' });
  const commands = firstUse.locator('details pre');
  assert.match(await commands.innerText(), /install\.ps1[\s\S]+agentdeck projects add/);
  await system.selectOption('unix');
  assert.match(
    await commands.innerText(),
    /install\.sh[\s\S]+agentdeck login[\s\S]+agentdeck start/,
  );
  await firstUse.close();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: cross-host attention, authorized search and original message, attachment limits and stable diff comments.',
  );
} finally {
  await browser.close();
}

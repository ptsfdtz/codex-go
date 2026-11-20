/* global document, navigator, PushManager */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath, URLSearchParams } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';

async function checkNotificationClick(packet, openWindows) {
  const handlers = new Map();
  const scope = 'https://example.org/mobile/';
  const navigations = [];
  runInNewContext(await readFile(new URL('../../web/public/sw.js', import.meta.url), 'utf8'), {
    URL,
    URLSearchParams,
    MessageChannel,
    setTimeout,
    clearTimeout,
    self: {
      addEventListener: (name, handler) => handlers.set(name, handler),
      registration: { scope },
      clients: {
        matchAll: async () => openWindows,
        openWindow: async (url) => navigations.push(url),
      },
    },
  });
  let completion;
  handlers.get('notificationclick')({
    notification: { data: packet, close() {} },
    waitUntil: (promise) => {
      completion = promise;
    },
  });
  await completion;
  return navigations;
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = new URL('../../web/', import.meta.url);
const requireWeb = createRequire(new URL('package.json', web));
const { createServer } = await import(pathToFileURL(requireWeb.resolve('vite')).href);
const server = await createServer({
  root: fileURLToPath(web),
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  headless: true,
});
try {
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  const context = await browser.newContext({ permissions: ['notifications'], locale: 'en' });
  const accountId = randomUUID(),
    deviceId = randomUUID(),
    hostId = 'host_' + randomUUID(),
    sessionId = 'session_' + randomUUID();
  const writes = [];
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path.endsWith('/push') && req.method() !== 'GET')
      writes.push({ method: req.method(), body: req.postDataJSON() });
    const response = path.endsWith('/push')
      ? { available: true, publicKey: Buffer.alloc(65, 4).toString('base64url') }
      : path.endsWith('/csrf')
        ? { csrfToken: 'test-token' }
        : {};
    await route.fulfill({ status: path.endsWith('/session') ? 401 : 200, json: response });
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(
    async (scope) => {
      let sub;
      // Model the browser push service locally. The app's subscriptions and
      // account/device request bodies are the real Settings component's.
      PushManager.prototype.getSubscription = async () => sub;
      PushManager.prototype.subscribe = async () => {
        sub = {
          endpoint: 'https://fcm.googleapis.com/fcm/send/test',
          toJSON: () => ({ keys: { auth: 'test-auth', p256dh: 'test-key' } }),
          unsubscribe: async () => {
            sub = null;
            return true;
          },
        };
        return sub;
      };
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const React = (await import('/node_modules/.vite/deps/react.js')).default;
      const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { BackgroundNotifications } = await import(
        '/src/features/notifications/BackgroundNotifications.tsx'
      );
      const root = document.createElement('div');
      document.body.prepend(root);
      (dom.default || dom)
        .createRoot(root)
        .render(React.createElement(BackgroundNotifications, { scope, oldHost: false }));
    },
    accountId + ':' + deviceId,
  );
  const toggle = page.getByRole('checkbox', { name: 'Background approval and question alerts' });
  await toggle.click();
  const completions = page.getByRole('checkbox', {
    name: 'Also notify when tasks finish, fail, or stop',
  });
  await completions.waitFor();
  assert.equal(await completions.isChecked(), false);
  await completions.click();
  await toggle.click();
  await completions.waitFor({ state: 'detached' });
  assert.deepEqual(
    writes.map((w) => [w.method, w.body.accountId, w.body.deviceId, w.body.includeCompletion]),
    [
      ['PUT', accountId, deviceId, false],
      ['PUT', accountId, deviceId, true],
      ['DELETE', accountId, deviceId, undefined],
    ],
  );

  // Keep a diagnostic target for CDP, close the app and let Chromium wake
  // the installed service worker from a real push event.
  const observer = await context.newPage();
  await observer.goto(origin + '/sw.js');
  const cdp = await context.newCDPSession(observer);
  const registered = new Promise((resolve) =>
    cdp.on('ServiceWorker.workerRegistrationUpdated', (event) => {
      const found = event.registrations.find((r) => r.scopeURL === origin + '/' && !r.isDeleted);
      if (found) resolve(found.registrationId);
    }),
  );
  await cdp.send('ServiceWorker.enable');
  const registrationId = await registered;
  await page.close();
  const approvalId = 'approval_' + randomUUID();
  const packet = {
    accountId,
    hostId,
    sessionId,
    approvalId,
    eventKey: 'a'.repeat(64),
    body: 'private content',
    url: 'https://invalid.example',
  };
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin,
    registrationId,
    data: JSON.stringify(packet),
  });
  await observer.waitForFunction(
    async () => (await (await navigator.serviceWorker.ready).getNotifications()).length === 1,
  );
  const result = await observer.evaluate(async () => {
    const [notice] = await (await navigator.serviceWorker.ready).getNotifications();
    return { title: notice.title, body: notice.body, data: notice.data };
  });
  assert.equal(result.title, 'AgentDeck');
  assert.ok(
    ['Open AgentDeck to review a task update.', '打开 AgentDeck 查看任务更新。'].includes(
      result.body,
    ),
  );
  assert.deepEqual(result.data, { accountId, hostId, sessionId, approvalId });
  const dest = 'https://example.org/mobile/#attention?' + new URLSearchParams(result.data);
  assert.deepEqual(await checkNotificationClick(result.data, []), [dest]);
  const messages = [];
  const existing = {
    url: 'https://example.org/mobile/',
    focus: async () => {},
    postMessage(message, [ack]) {
      messages.push(message);
      ack.postMessage('received');
    },
    navigate: async () => {
      assert.fail('A responsive client should stay mounted');
    },
  };
  assert.deepEqual(await checkNotificationClick(result.data, [existing]), []);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    { type: 'agentdeck.openAttention', ...result.data },
  ]);
  let recovery;
  await checkNotificationClick(result.data, [
    {
      ...existing,
      postMessage() {},
      navigate: async (url) => {
        recovery = url;
      },
    },
  ]);
  assert.equal(recovery, dest);
  const route = origin + '/#attention?' + new URLSearchParams(result.data);
  await context.setOffline(true);
  const offline = await context.newPage();
  await offline.goto(route);
  await offline.locator('#reconnect').waitFor();
  assert.equal(await offline.locator('#reconnect').getAttribute('href'), route);
  await context.setOffline(false);
  await Promise.all([offline.waitForEvent('load'), offline.locator('#reconnect').click()]);
  assert.equal(offline.url(), route);
  console.log(
    'Passed scoped enrollment, opt-in task completion, unsubscribe and closed-page Chromium push with private content omitted.',
  );
} finally {
  await browser.close();
  await server.close();
}

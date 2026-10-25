/* global window, navigator, document, fetch, File */
// Controlled HTTP responses test browser coordination and rendering. This does
// not stand in for the separate public-cloud pairing / real-model acceptance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(new URL('../../desktop/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const QRCode = require('qrcode');
const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  server: { host: '127.0.0.1', port: 0, open: false },
  plugins: [
    {
      name: 'recovery-test-page',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== '/__recovery_test') return next();
          res.setHeader('content-type', 'text/html');
          void server
            .transformIndexHtml(
              '/__recovery_test',
              '<!doctype html><html><body><div id="test-root"></div><script type="module" src="/tests/browser-recovery.fixture.tsx"></script></body></html>',
            )
            .then((html) => res.end(html));
        });
      },
    },
  ],
});
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === 'win32' ? 'msedge' : undefined,
  });
  const context = await browser.newContext();
  let valid = false,
    rotations = 0;
  await context.route('https://agent.ptsfdtz.top/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const headers = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type,x-csrf-token',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let status = 200,
      body;
    if (path.endsWith('/csrf')) body = { csrfToken: valid ? 'new' : 'old' };
    else if (path.endsWith('/refresh')) {
      assert.equal(request.headers()['x-csrf-token'], 'old');
      rotations++;
      valid = true;
      body = { csrfToken: 'new' };
    } else if (!valid) {
      status = 401;
      body = { code: 'UNAUTHORIZED' };
    } else body = { ok: true };
    return route.fulfill({
      status,
      headers,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  const first = await context.newPage(),
    second = await context.newPage();
  await Promise.all([
    first.goto(origin + '/__recovery_test'),
    second.goto(origin + '/__recovery_test'),
  ]);
  await Promise.all(
    [first, second].map((page) =>
      page.evaluate(async () => {
        const cloud = await import('/src/cloud.ts');
        window.accountChanges = 0;
        window.addEventListener(cloud.accountEvent, () => window.accountChanges++);
        await cloud.api('/api/v1/hosts');
      }),
    ),
  );
  assert.equal(rotations, 1, 'two tabs must share one credential rotation');
  await first.evaluate(async () => (await import('/src/cloud.ts')).notifyAccountChange());
  await second.waitForFunction(() => window.accountChanges === 1);
  await first.evaluate(() => {
    void navigator.locks.request('agentdeck.web.test.takeover', () => new Promise(() => {}));
  });
  await first.waitForFunction(async () =>
    (await navigator.locks.query()).held.some(
      (lock) => lock.name === 'agentdeck.web.test.takeover',
    ),
  );
  const takeover = second.evaluate(() =>
    navigator.locks.request('agentdeck.web.test.takeover', () => 'released'),
  );
  await first.close();
  assert.equal(await takeover, 'released', 'closing a tab must release its lock');

  await second.waitForFunction(() => window.testReact);
  await second.evaluate(() => {
    const { React, createRoot, Timeline } = window.testReact;
    const style = document.createElement('style');
    style.textContent =
      '.timeline{height:300px;overflow:auto;overflow-anchor:none}article{height:60px;margin:0}';
    document.head.append(style);
    window.testRoot = createRoot(document.getElementById('test-root'));
    window.timelineRef = React.createRef();
    window.renderTimeline = (ids) =>
      window.testRoot.render(
        React.createElement(
          Timeline,
          { identity: 'session', ref: window.timelineRef },
          ids.map((id) =>
            React.createElement(
              'article',
              { key: id, 'data-history-key': String(id) },
              'entry ' + id,
            ),
          ),
        ),
      );
    window.renderTimeline(Array.from({ length: 30 }, (_, i) => i));
  });
  await second.waitForSelector('article');
  const before = await second.evaluate(() => {
    const node = document.querySelector('.timeline');
    node.scrollTop = 600;
    window.timelineRef.current.pause();
    return document.querySelector('[data-history-key="10"]').getBoundingClientRect().top;
  });
  await second.evaluate(() => window.renderTimeline(Array.from({ length: 40 }, (_, i) => i - 10)));
  await second.waitForSelector('[data-history-key="-10"]');
  const after = await second.evaluate(
    () => document.querySelector('[data-history-key="10"]').getBoundingClientRect().top,
  );
  assert.ok(
    Math.abs(before - after) < 1,
    'prepending older history must preserve the reading anchor',
  );
  await second.evaluate(() => {
    document.querySelector('[data-history-key="0"]').style.height = '180px';
  });
  await second.waitForFunction(
    (top) =>
      Math.abs(
        document.querySelector('[data-history-key="10"]').getBoundingClientRect().top - top,
      ) < 1,
    after,
  );
  await second.evaluate(() => {
    const { React, Markdown } = window.testReact;
    window.testRoot.render(
      React.createElement(Markdown, {
        text: '[unsafe](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n![remote](https://invalid.example/leak)\n\n| A | B |\n|---|---|\n| 1 | 2 |',
      }),
    );
  });
  await second.waitForSelector('table');
  assert.equal(
    await second.locator('img,script:not([type="module"]),a[href^="javascript:"]').count(),
    0,
  );
  const invitation = JSON.stringify({
    v: 3,
    hostId: 'host',
    cloud: { origin: 'https://agent.ptsfdtz.top', accountId: 'account' },
    tlsServerName: '127.0.0.1',
    fingerprint: 'a'.repeat(64),
    token: 'a'.repeat(43),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  const qr = await QRCode.toDataURL(invitation, { width: 800 });
  const imported = await second.evaluate(
    async ({ qr }) => {
      const { invitationFromImage, parseInvitation } = await import('/src/pairing.ts');
      const blob = await (await fetch(qr)).blob();
      const text = await invitationFromImage(new File([blob], 'pair.png', { type: 'image/png' }));
      return parseInvitation(text, 'host', 'account:device').hostId;
    },
    { qr },
  );
  assert.equal(imported, 'host');
  console.log(
    'Browser acceptance passed: two-tab refresh, account notification, tab-close lock takeover, history anchor, safe Markdown, QR image import.',
  );
} finally {
  await browser?.close();
  await vite.close();
}

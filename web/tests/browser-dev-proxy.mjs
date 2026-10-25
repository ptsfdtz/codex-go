/* global document, fetch, location */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { cloudProxy } from '../vite.config.ts';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const upstreamRequests = [];
const upstream = createServer((request, response) => {
  upstreamRequests.push(request.headers);
  if (request.url === '/api/v1/web/login') {
    response.setHeader('Set-Cookie', [
      '__Host-agentdeck_web_access=test-session; Path=/; Secure; HttpOnly; SameSite=None; Partitioned',
      '__Host-agentdeck_web_csrf=test-csrf; Path=/; Secure; SameSite=None; Partitioned',
    ]);
    response.end('{}');
    return;
  }
  response.end(
    JSON.stringify({ cookie: request.headers.cookie, csrf: request.headers['x-csrf-token'] }),
  );
});
const sockets = new WebSocketServer({ server: upstream });
sockets.on('connection', (socket, request) => {
  upstreamRequests.push(request.headers);
  socket.on('message', (bytes, binary) => socket.send(bytes, { binary }));
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');
const target = `http://127.0.0.1:${upstream.address().port}`;
const vite = await createViteServer({
  configFile: false,
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [
    cloudProxy(target),
    {
      name: 'proxy-browser-probe',
      configureServer(server) {
        server.middlewares.use('/probe', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end('<title>Proxy check</title>');
        });
      },
    },
  ],
  server: { host: 'localhost', port: 0 },
});
let browser;
try {
  await vite.listen();
  const origin = `http://localhost:${vite.httpServer.address().port}`;
  browser = await chromium.launch({
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  // A real browser document without mounting the application against this test fixture.
  await page.goto(`${origin}/probe`);
  await page.evaluate(() => fetch('/api/v1/web/login', { method: 'POST' }));
  const cookies = await context.cookies(origin);
  const access = cookies.find((cookie) => cookie.name === '__Host-agentdeck_web_access');
  assert.ok(access?.secure && access.httpOnly, 'localhost must retain the secure HttpOnly cookie');
  await page.reload();
  const session = await page.evaluate(async () => {
    const csrf = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith('__Host-agentdeck_web_csrf='))
      ?.split('=')[1];
    return (await fetch('/api/v1/web/session', { headers: { 'x-csrf-token': csrf } })).json();
  });
  assert.match(session.cookie, /__Host-agentdeck_web_access=test-session/);
  assert.equal(session.csrf, 'test-csrf');
  const reply = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(
          location.origin.replace(/^http/, 'ws') + '/api/v1/relay/tunnels/test/client',
          ['agentdeck-relay-v1', 'test-ticket'],
        );
        socket.binaryType = 'arraybuffer';
        socket.onopen = () => socket.send(new Uint8Array([0, 1, 255]));
        socket.onerror = () => reject(new Error('proxy WebSocket failed'));
        socket.onmessage = (event) => {
          resolve({ protocol: socket.protocol, bytes: Array.from(new Uint8Array(event.data)) });
          socket.close();
        };
      }),
  );
  assert.deepEqual(reply, { protocol: 'agentdeck-relay-v1', bytes: [0, 1, 255] });
  assert.ok(
    upstreamRequests.every(
      (headers) => headers.origin === target && headers.host === new URL(target).host,
    ),
  );
  assert.match(upstreamRequests.at(-1).cookie, /__Host-agentdeck_web_access=test-session/);
  assert.match(upstreamRequests.at(-1)['sec-websocket-protocol'], /test-ticket/);
  const count = upstreamRequests.length;
  assert.equal(
    (await fetch(`${origin}/api/v1/web/session`, { headers: { Origin: 'https://other.example' } }))
      .status,
    403,
  );
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(
      origin.replace(/^http/, 'ws') + '/api/v1/relay/tunnels/test/client',
      { origin: 'https://other.example' },
    );
    socket.on('open', () => {
      socket.close();
      reject(new Error('cross-origin WebSocket was accepted'));
    });
    socket.on('error', resolve);
  });
  assert.equal(upstreamRequests.length, count, 'cross-origin requests must not reach the cloud');
  console.log(
    'Development proxy: secure cookies, reload, CSRF, binary WebSocket/ticket and origin rejection passed.',
  );
} finally {
  await browser?.close();
  await vite.close();
  for (const client of sockets.clients) client.terminate();
  sockets.close();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
}

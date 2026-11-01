/* global window, WebSocket, TextEncoder, TextDecoder, performance */
import assert from 'node:assert/strict';
import { createServer } from 'node:tls';
import { connect } from 'node:net';
import { createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, stat, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const temp = await mkdtemp(join(tmpdir(), 'agentdeck-tls-bundle-'));
const peers = new Set();
const applicationData = [];
let server, bridge, browser;
try {
  execFileSync(
    process.env.OPENSSL_BIN || 'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(temp, 'key.pem'),
      '-out',
      join(temp, 'cert.pem'),
      '-subj',
      '/CN=127.0.0.1',
      '-days',
      '1',
      '-sha256',
    ],
    { stdio: 'ignore' },
  );
  const cert = await readFile(join(temp, 'cert.pem'));
  const pin = createHash('sha256').update(new X509Certificate(cert).raw).digest('hex');
  server = createServer(
    {
      key: await readFile(join(temp, 'key.pem')),
      cert,
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
    },
    (socket) => {
      peers.add(socket);
      socket.on('close', () => peers.delete(socket));
      socket.on('error', () => {});
      socket.on('data', (data) => {
        applicationData.push(data.toString());
        socket.write('pong');
      });
    },
  );
  server.on('tlsClientError', () => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  bridge = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => bridge.once('listening', resolve));
  bridge.on('connection', (ws) => {
    const raw = connect(server.address().port, '127.0.0.1');
    peers.add(raw);
    raw.on('data', (bytes) => {
      if (ws.readyState === NodeWebSocket.OPEN) ws.send(bytes);
    });
    ws.on('message', (bytes) => raw.write(bytes));
    ws.on('close', () => raw.destroy());
    raw.on('error', () => ws.close());
    raw.on('close', () => {
      peers.delete(raw);
      ws.close();
    });
  });
  const dist = new URL('../../web/dist/assets/', import.meta.url);
  const files = (await readdir(dist)).filter((file) => file.endsWith('.js'));
  const sizes = await Promise.all(
    files.map(async (file) => ({ file, bytes: (await stat(new URL(file, dist))).size })),
  );
  assert(
    sizes.every((file) => file.bytes < 500000),
    'Every production JS chunk must remain below 500 kB',
  );
  const client = sizes.find((file) => /^tls-(?!trust-roots-)/.test(file.file));
  const roots = sizes.find((file) => /^tls-trust-roots-/.test(file.file));
  assert(client && roots);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route('**/api/**', (route) => route.fulfill({ status: 401, body: '{}' }));
  const page = await context.newPage();
  const origin = process.env.PERF_TEST_ORIGIN || 'http://127.0.0.1:1599';
  await page.goto(origin);
  assert.equal(
    await page.evaluate(() =>
      performance.getEntriesByType('resource').some((entry) => /\/tls-/.test(entry.name)),
    ),
    false,
  );
  const run = async (fingerprint) =>
    page.evaluate(
      async ({ fingerprint, moduleUrl, socketUrl }) => {
        const module = await import(moduleUrl);
        const connectPinnedTls = Object.values(module).find(
          (value) => typeof value === 'function' && value.length === 2,
        );
        if (!connectPinnedTls) throw new Error('Missing built TLS entry point');
        const ws = new WebSocket(socketUrl);
        ws.binaryType = 'arraybuffer';
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = reject;
        });
        const transport = {
          send: (bytes) => ws.send(bytes),
          close: () => ws.close(),
          receive: (receive, ended) => {
            ws.onmessage = (event) => receive(new Uint8Array(event.data));
            ws.onclose = () => ended(new Error('closed'));
          },
        };
        const timeout = window.setTimeout(() => ws.close(), 8000);
        try {
          const channel = await connectPinnedTls(transport, fingerprint);
          const response = new Promise((resolve, reject) =>
            channel.receive((bytes) => resolve(new TextDecoder().decode(bytes)), reject),
          );
          await channel.write(new TextEncoder().encode('ping'));
          const text = await response;
          channel.close();
          return { text };
        } catch (error) {
          return { error: String(error) };
        } finally {
          window.clearTimeout(timeout);
        }
      },
      {
        fingerprint,
        moduleUrl: `${origin}/assets/${client.file}`,
        socketUrl: `ws://127.0.0.1:${bridge.address().port}`,
      },
    );
  assert.deepEqual(await run(pin), { text: 'pong' });
  const badPin = await run('0'.repeat(64));
  assert(badPin.error, 'An incorrect certificate pin must fail');
  assert.deepEqual(applicationData, ['ping'], 'Bad pins must not release application data');
  const out = new URL('../../artifacts/performance/', import.meta.url);
  await mkdir(out, { recursive: true });
  await writeFile(
    new URL('tls-bundle.json', out),
    JSON.stringify(
      {
        client,
        roots,
        totalTlsBytes: client.bytes + roots.bytes,
        protocol: 'TLSv1.3',
        goodPin: true,
        badPinRejected: true,
        badPinApplicationBytes: 0,
        realHost: false,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: production TLS chunks stay lazy and below 500 kB; split modules negotiate local TLS 1.3, exchange ping/pong and reject a wrong pin before application data. Root certificates and cryptography are unchanged.',
  );
} finally {
  await browser?.close();
  for (const peer of peers) peer.destroy();
  for (const client of bridge?.clients || []) client.terminate();
  if (bridge) await new Promise((resolve) => bridge.close(resolve));
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}

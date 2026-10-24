import { createServer as createTlsServer } from 'node:tls';
import { connect } from 'node:net';
import { once } from 'node:events';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { X509CertificateGenerator } from '@peculiar/x509';
import { WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';

const require = createRequire(new URL('../../desktop/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const certificate = await X509CertificateGenerator.createSelfSigned({
  serialNumber: '01',
  name: 'CN=127.0.0.1',
  notBefore: new Date(Date.now() - 60000),
  notAfter: new Date(Date.now() + 300000),
  signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
  keys,
});
const privateBytes = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
const key = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(privateBytes).toString('base64')}\n-----END PRIVATE KEY-----`;
const cert = certificate.toString('pem');
const fingerprint = createHash('sha256')
  .update(Buffer.from(cert.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64'))
  .digest('hex');
let applicationMessages = 0;
const host = createTlsServer(
  { key, cert, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' },
  (socket) => {
    socket.on('error', () => {});
    socket.on('data', (bytes) => {
      applicationMessages++;
      socket.write(bytes);
    });
  },
);
host.on('tlsClientError', () => {});
host.listen(0, '127.0.0.1');
await once(host, 'listening');
const relay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await once(relay, 'listening');
relay.on('connection', (outer) => {
  const tcp = connect(host.address().port, '127.0.0.1');
  tcp.on('error', () => outer.close());
  tcp.on('close', () => outer.close());
  tcp.on('data', (bytes) => {
    if (outer.readyState === 1) outer.send(bytes);
  });
  outer.on('message', (bytes, binary) => {
    if (!binary) outer.close();
    else tcp.write(bytes);
  });
  outer.on('close', () => tcp.destroy());
});
const vite = await createViteServer({
  base: '/',
  root: fileURLToPath(new URL('..', import.meta.url)),
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
  plugins: [
    {
      name: 'browser-transport-test-page',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== '/__transport_test') {
            next();
            return;
          }
          response.setHeader('content-type', 'text/html');
          response.end('<!doctype html><html><body>Browser TLS acceptance</body></html>');
        });
      },
    },
  ],
});
await vite.listen();
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel:
      process.env.AGENTDECK_TEST_BROWSER_CHANNEL ||
      (process.platform === 'win32' ? 'msedge' : undefined),
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__transport_test`);
  const result = await page.evaluate(
    async ({ port, fingerprint }) => {
      const { connectPinnedTls } = await import('/src/transport/tls.ts');
      async function open(pin) {
        const socket = new WebSocket(`ws://127.0.0.1:${port}`);
        socket.binaryType = 'arraybuffer';
        await new Promise((resolve, reject) => {
          socket.onopen = resolve;
          socket.onerror = reject;
        });
        return connectPinnedTls(
          {
            send(bytes) {
              socket.send(bytes);
            },
            close() {
              socket.close();
            },
            receive(handler, ended) {
              socket.onmessage = (event) => handler(new Uint8Array(event.data));
              socket.onclose = () => ended(new Error('closed'));
              socket.onerror = () => ended(new Error('failed'));
            },
          },
          pin,
        );
      }
      const channel = await open(fingerprint);
      const received = new Promise((resolve, reject) =>
        channel.receive((bytes) => resolve(new TextDecoder().decode(bytes)), reject),
      );
      await channel.write(new TextEncoder().encode('browser-native-webcrypto'));
      const echo = await received;
      channel.close();
      let mismatch = false;
      try {
        const wrong = await open('0'.repeat(64));
        wrong.close();
      } catch (error) {
        mismatch = error.message.includes('does not match invitation');
      }
      return { echo, mismatch };
    },
    { port: relay.address().port, fingerprint },
  );
  if (result.echo !== 'browser-native-webcrypto' || !result.mismatch || applicationMessages !== 1)
    throw new Error('Browser TLS acceptance failed');
  console.log(
    'PASS: browser Web Crypto, real TLS 1.3 over binary WebSocket, pinned certificate, and mismatch rejection',
  );
} finally {
  await browser?.close();
  await vite.close();
  for (const socket of relay.clients) socket.terminate();
  await new Promise((resolve) => relay.close(resolve));
  await new Promise((resolve) => host.close(resolve));
}

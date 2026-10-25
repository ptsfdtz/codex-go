/* global window, document, navigator, caches, fetch, Event */
// Production bundle on loopback; no account login, host mutation, or model call.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { build, preview } from 'vite';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const directory = resolve('artifacts/web-pwa');
mkdirSync(directory, { recursive: true });
// Exercise deployment under a subdirectory as well as standalone launch metadata.
const base = '/mobile/';
let navigationUnavailable = false;
const config = {
  root: fileURLToPath(new URL('..', import.meta.url)),
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  base,
  build: { outDir: resolve('.tmp/web-pwa-bundle'), emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 0, open: false },
  plugins: [
    {
      name: 'pwa-network-failure',
      configurePreviewServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (navigationUnavailable && request.url === base) request.socket.destroy();
          else next();
        });
      },
    },
  ],
};
await build(config);
const server = await preview(config);
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === 'win32' ? 'msedge' : undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.route('https://agent.ptsfdtz.top/**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"code":"UNAUTHORIZED"}',
    }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(origin + base);
  await page.getByRole('heading', { name: '登录', exact: true }).waitFor();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute('href');
  assert.equal(manifestUrl, base + 'manifest.webmanifest');
  const manifest = await (await context.request.get(origin + manifestUrl)).json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(new URL(manifest.start_url, origin + manifestUrl).pathname, base);
  assert.equal(new URL(manifest.scope, origin + manifestUrl).pathname, base);
  for (const icon of manifest.icons) {
    const response = await context.request.get(new URL(icon.src, origin + manifestUrl).href);
    assert.equal(response.status(), 200);
    const bytes = await response.body();
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(bytes.readUInt32BE(16), width);
    assert.equal(bytes.readUInt32BE(20), height);
  }
  assert.ok(
    await page
      .locator('meta[name="viewport"]')
      .getAttribute('content')
      .then((v) => v.includes('viewport-fit=cover')),
  );
  await page.getByText('添加到主屏幕', { exact: true }).click();
  await page.getByText(/iPhone \/ iPad/).waitFor();
  // The prompt is captured globally before any conditional login/settings panel mounts.
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => window.dispatchEvent(new Event('appinstalled'));
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
  });
  await page.getByRole('button', { name: '安装 AgentDeck' }).click();
  await page.getByRole('status').filter({ hasText: '已添加到主屏幕' }).waitFor();
  await page.screenshot({ path: resolve(directory, 'mobile-login.png'), fullPage: true });
  // A shorter visual viewport must leave the entire login form reachable.
  await page.setViewportSize({ width: 390, height: 480 });
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector('.center').getBoundingClientRect().height -
          window.visualViewport.height,
      ) < 2,
  );
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(
    () => document.querySelector('meta[name="theme-color"]').content === '#212121',
  );
  assert.deepEqual(await page.evaluate(() => caches.keys()), []);
  // Navigation fails to a useful screen, while private API failures stay failures.
  // Also fail the actual server request: context offline emulation does not
  // consistently disable the service worker's own network in desktop Chromium.
  navigationUnavailable = true;
  await context.setOffline(true);
  const offlineResponse = await page.reload();
  assert.equal(offlineResponse.status(), 503);
  await page.getByRole('heading', { name: '网络暂时不可用' }).waitFor();
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch('/api/v1/hosts');
        return 'unexpected success';
      } catch {
        return 'network failure';
      }
    }),
    'network failure',
  );
  await context.setOffline(false);
  navigationUnavailable = false;
  await page.getByRole('link', { name: '重新连接' }).click();
  await page.getByRole('heading', { name: '登录', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  // Simulate the OS launch display mode, without pretending this is a real phone install.
  const installed = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installed.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = original(query);
      if (query.includes('display-mode: standalone'))
        Object.defineProperty(result, 'matches', { value: true });
      return result;
    };
  });
  await installed.route('https://agent.ptsfdtz.top/**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"code":"UNAUTHORIZED"}',
    }),
  );
  const standalone = await installed.newPage();
  await standalone.goto(origin + base);
  await standalone.getByRole('heading', { name: '登录', exact: true }).waitFor();
  assert.equal(await standalone.locator('.pwa-install').count(), 0);
  console.log(
    'PWA browser checks passed: production subpath, icons, worker control, install prompt, standalone UI, mobile resize/theme, offline recovery, no private response cache. Real Android/iOS installation remains unverified.',
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.httpServer.close(done));
}

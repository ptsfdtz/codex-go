/* global document, window, crypto, btoa */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = fileURLToPath(new URL('../../artifacts/message-images/', import.meta.url));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('net::ERR_FAILED'))
      errors.push(message.text());
  });
  await page.route('**/api/**', (r) => r.abort());
  await page.route('https://external.example/**', () => {
    throw new Error('Remote image should never auto-fetch');
  });
  await page.goto(process.env.COMPOSER_TEST_ORIGIN || 'http://localhost:1430');
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Markdown } = await import('/src/RichContent.tsx');
    document.getElementById('root').style.display = 'none';
    const el = document.createElement('div');
    el.className = 'rich-content';
    el.style = 'padding:24px;max-width:780px;margin:auto';
    document.body.append(el);
    window.root = (dom.default || dom).createRoot(el);
    const canvas = document.createElement('canvas');
    canvas.width = 620;
    canvas.height = 230;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#303030';
    ctx.fillRect(0, 0, 620, 230);
    ctx.fillStyle = '#ececec';
    ctx.font = '24px sans-serif';
    ctx.fillText('AgentDeck image preview', 24, 45);
    ctx.fillStyle = '#444';
    ctx.fillRect(24, 75, 572, 90);
    ctx.fillStyle = '#ececec';
    ctx.fillRect(500, 185, 96, 28);
    window.bytes = new Uint8Array(
      await (await new Promise((r) => canvas.toBlob(r, 'image/png'))).arrayBuffer(),
    );
    window.hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', window.bytes)),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
    window.calls = [];
    window.liveURLs = new Set();
    window.mode = 'ok';
    window.text = 'An image in the reply:\n\n![Preview](/root/project/artifacts/preview.png)';
    window.project = 'a';
    window.preview = true;
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      const u = create(b);
      window.liveURLs.add(u);
      return u;
    };
    URL.revokeObjectURL = (u) => {
      window.liveURLs.delete(u);
      revoke(u);
    };
    window.request = async (action, payload) => {
      window.calls.push({ action, ...payload });
      if (window.mode === 'error') throw new Error('Image unavailable');
      if (window.mode === 'delay') await new Promise((resolve) => (window.releaseOld = resolve));
      let binary = '';
      const data = window.bytes.slice(payload.offset, payload.offset + 128);
      for (const n of data) binary += String.fromCharCode(n);
      const next = payload.offset + data.length;
      return {
        projectId: payload.projectId,
        path: payload.path,
        mime: 'image/png',
        sha256: window.mode === 'corrupt' ? '0'.repeat(64) : window.hash,
        totalBytes: window.bytes.length,
        offset: payload.offset,
        data: btoa(binary),
        nextOffset: next === window.bytes.length ? null : next,
      };
    };
    window.render = () =>
      window.root.render(
        React.createElement(Markdown, {
          text: window.text,
          images: window.preview
            ? { request: window.request, projectId: window.project, root: '/root/project' }
            : undefined,
        }),
      );
    window.render();
  });
  const image = page.getByRole('img', { name: 'Preview', exact: true });
  await image.waitFor();
  await page.waitForFunction(
    () => document.querySelector('.message-image-open img')?.naturalWidth > 0,
  );
  assert((await page.evaluate(() => window.calls.length)) > 1);
  assert(
    await page.evaluate(() =>
      window.calls.every(
        (c) => c.action === 'files.readImage' && c.path === 'artifacts/preview.png',
      ),
    ),
  );
  const count = await page.evaluate(() => window.calls.length);
  await page.evaluate(() => window.render());
  assert.equal(await page.evaluate(() => window.calls.length), count);
  await page.getByRole('button', { name: '放大图片 Preview' }).click();
  await page.getByRole('dialog', { name: 'Preview' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.rich-content').screenshot({ path: out + 'desktop.png' });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  assert(await page.locator('.rich-content').evaluate((el) => el.scrollWidth <= el.clientWidth));
  await page.locator('.rich-content').screenshot({ path: out + 'mobile.png' });
  for (const text of [
    '![outside](/root/private.png)',
    '![traversal](../secret.png)',
    '![bad](javascript:alert)',
    '![remote](https://external.example/image.png)',
  ]) {
    await page.evaluate((text) => {
      window.text = text;
      window.render();
    }, text);
    await page.waitForFunction(() => window.liveURLs.size === 0);
    assert.equal(await page.evaluate(() => window.calls.length), count);
  }
  await page.getByRole('link', { name: '打开图片：remote' }).waitFor();
  await page.evaluate(() => {
    window.mode = 'error';
    window.text = '![Retry](artifacts/preview.png)';
    window.render();
  });
  const retry = page.getByRole('button', { name: '重试读取图片' });
  await retry.waitFor();
  await page.evaluate(() => (window.mode = 'ok'));
  await retry.click();
  await page.getByRole('img', { name: 'Retry', exact: true }).waitFor();
  await page.evaluate(() => {
    window.mode = 'corrupt';
    window.text = '![Corrupt](artifacts/other.png)';
    window.render();
  });
  await page.getByText(/图片校验失败/).waitFor();
  await page.evaluate(() => {
    window.mode = 'delay';
    window.text = '![Old](artifacts/delayed.png)';
    window.render();
  });
  await page.waitForFunction(() => !!window.releaseOld);
  const before = await page.evaluate(() => window.calls.length);
  await page.evaluate(() => {
    window.text = 'Another conversation';
    window.render();
  });
  await page.getByText('Another conversation', { exact: true }).waitFor();
  await page.evaluate(() => window.releaseOld());
  await page.waitForFunction(() => window.liveURLs.size === 0);
  assert.equal(await page.evaluate(() => window.calls.length), before);
  await page.evaluate(() => {
    window.mode = 'ok';
    window.preview = false;
    window.text = '![Offline](artifacts/preview.png)';
    window.render();
  });
  await page.getByText('连接支持图片预览的项目电脑后查看').waitFor();
  assert.equal(await page.evaluate(() => window.calls.length), before);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: inline Markdown images, multichunk hash validation, zoom, no repeat reads on rerender, mobile bounds, path authorization, remote no-fetch, retry, corrupt hash, context cancellation and URL cleanup. Controlled RPC responses; no real Host.',
  );
} finally {
  await browser.close();
}

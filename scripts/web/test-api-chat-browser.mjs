/* global window, document, localStorage, navigator, TextEncoder, Response, ReadableStream, AbortController, setInterval, clearInterval */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/api-chat/', import.meta.url);
await mkdir(out, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'agentchat-direct-'));
execFileSync(
  'openssl',
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
  ],
  { stdio: 'ignore' },
);
const upstreamCalls = [],
  cloudCalls = [],
  errors = [];
let modelsMode = 'normal',
  mode = 'normal',
  closedStreams = 0;
const timers = new Set();
const upstream = createServer(
  { key: await readFile(join(temp, 'key.pem')), cert: await readFile(join(temp, 'cert.pem')) },
  async (req, res) => {
    if (mode !== 'cors') res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = '';
    for await (const part of req) body += part;
    upstreamCalls.push({
      path: req.url,
      body: body ? JSON.parse(body) : undefined,
      headers: req.headers,
    });
    assert.equal(req.headers.authorization, 'Bearer fake-browser-test-key');
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers['x-csrf-token'], undefined);
    if (req.url === '/v1/models') {
      if (modelsMode === 'fail') {
        res.writeHead(404);
        res.end();
        return;
      }
      if (modelsMode === 'delayed')
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 500);
          timers.add(timer);
        });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }] }));
      return;
    }
    if (mode === 'reject') {
      res.writeHead(400);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();
    const current = mode;
    let n = 0;
    const timer = setInterval(() => {
      if (n === 0)
        res.write(
          'data: ' +
            JSON.stringify({ choices: [{ delta: { content: '当然可以。' } }] }) +
            '\r\n\r\n',
        );
      if (n === 1)
        res.write(
          'data: ' +
            JSON.stringify({
              choices: [{ delta: { content: '每个对话独立选择模型，记录保存在当前浏览器。' } }],
            }) +
            '\n\n',
        );
      if (n === 2 && current === 'disconnect') {
        res.destroy();
        clearInterval(timer);
      }
      if (n === 2 && current !== 'hang' && current !== 'disconnect') {
        res.end('data: [DONE]\n\n');
        clearInterval(timer);
      }
      n++;
    }, 70);
    timers.add(timer);
    res.on('close', () => {
      closedStreams++;
      clearInterval(timer);
      timers.delete(timer);
    });
  },
);
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const base = `https://127.0.0.1:${upstream.address().port}/v1`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
    ignoreHTTPSErrors: true,
  });
  await context.addInitScript(() => {
    localStorage.setItem('agentdeck.web.work-mode', '"api"');
    localStorage.setItem('agentdeck.web.theme', 'light');
  });
  const keys = new Map();
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      method = request.method(),
      data = request.postDataJSON();
    cloudCalls.push({ path, method, data });
    const reply = (value, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify(value),
      });
    if (path.endsWith('/web/session'))
      return reply({ accountId: 'local-chat-test', mustChangePassword: false });
    if (path.endsWith('/web/csrf')) return reply({ csrfToken: 'test-csrf' });
    if (path === '/api/v1/hosts') return reply({ hosts: [] });
    if (path === '/api/v1/chat/keys') return reply({ enabled: true });
    if (path.startsWith('/api/v1/chat/keys/')) {
      assert.equal(request.headers()['x-csrf-token'], 'test-csrf');
      const id = path.split('/')[5];
      if (method === 'PUT') {
        assert.deepEqual(Object.keys(data), ['apiKey']);
        keys.set(id, data.apiKey);
        return reply({ saved: true });
      }
      if (path.endsWith('/reveal'))
        return keys.has(id)
          ? reply({ apiKey: keys.get(id) })
          : reply({ message: '密钥不存在' }, 403);
      if (method === 'DELETE') {
        keys.delete(id);
        return reply({ deleted: true });
      }
    }
    throw new Error(`Unexpected cloud request: ${method} ${path}`);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  const origin = process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1430';
  const font = process.env.COMPOSER_TEST_FONT;
  if (font) await context.route('**/__api-font', (route) => route.fulfill({ path: font }));
  async function loadFont(target = page) {
    if (font)
      await target.evaluate(async () => {
        const style = document.createElement('style');
        style.textContent =
          "@font-face{font-family:ApiChatTest;src:url('/__api-font')} :root{font-family:ApiChatTest,sans-serif}";
        document.head.append(style);
        await document.fonts.load('14px ApiChatTest');
      });
  }
  async function screenshot(name) {
    await page.waitForTimeout(250);
    await page.screenshot({ path: new URL(name, out).pathname });
  }
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  const picker = page.getByRole('button', { name: '切换模型', exact: true });
  async function waitIdle() {
    await page.waitForFunction(() => {
      const button = document.querySelector('button[aria-label="发送"]');
      return !!button && document.querySelector('textarea[aria-label="消息"]').value === '';
    });
  }
  async function records(kind, scope = 'local-chat-test') {
    return page.evaluate(
      async ({ kind, scope }) => {
        const { LocalStore } = await import('/src/features/api-chat/local.ts');
        return new LocalStore(scope).list(kind);
      },
      { kind, scope },
    );
  }
  await page.goto(origin);
  await loadFont();
  await page.getByRole('heading', { name: '有什么想聊的？' }).waitFor();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByLabel('Base URL', { exact: true }).fill(base);
  await page.getByLabel('API Key', { exact: true }).fill('fake-browser-test-key');
  await page.waitForFunction(
    () => document.querySelector('#provider-models')?.value === 'model-a\nmodel-b',
  );
  await page.getByLabel('API Key', { exact: true }).blur();
  await screenshot('api-settings.png');
  assert.equal(
    cloudCalls.filter((call) => call.method === 'PUT').length,
    0,
    'Model discovery is browser direct, before key storage',
  );
  await page.locator('summary').filter({ hasText: '高级设置' }).click();
  await page.getByLabel('名称', { exact: true }).fill('我的接口');
  await page.getByLabel('model-a 的思考强度', { exact: true }).fill('low, medium, high');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '添加接口', exact: true }).waitFor();
  assert.equal(keys.size, 1);
  await page.getByRole('button', { name: /我的接口.*2 个模型/ }).click();
  assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), '');
  const refreshed = page.waitForResponse((response) => response.url() === base + '/models');
  await page.getByRole('button', { name: '获取模型', exact: true }).click();
  await refreshed;
  modelsMode = 'delayed';
  await page.getByRole('button', { name: '获取模型', exact: true }).click();
  await page.waitForTimeout(100);
  await page.getByRole('textbox', { name: '模型', exact: true }).fill('manual-model');
  await page.waitForTimeout(600);
  assert.equal(
    await page.getByRole('textbox', { name: '模型', exact: true }).inputValue(),
    'manual-model',
  );
  modelsMode = 'fail';
  await page.getByRole('button', { name: '获取模型', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '404' }).waitFor();
  assert.equal(
    await page.getByRole('textbox', { name: '模型', exact: true }).inputValue(),
    'manual-model',
  );
  modelsMode = 'normal';
  mode = 'cors';
  await page.getByRole('button', { name: '获取模型', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '跨域访问' }).waitFor();
  mode = 'normal';
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await picker.click();
  await page.getByRole('slider', { name: '推理强度' }).fill('2');
  await screenshot('model-picker.png');
  await page.keyboard.press('Escape');
  await editor.fill('我想优化一个聊天应用，可以给我一些建议吗？');
  await editor.press('Enter');
  await waitIdle();
  await page
    .getByText('当然可以。每个对话独立选择模型，记录保存在当前浏览器。', { exact: true })
    .waitFor();
  await screenshot('desktop.png');
  const first = (await records('summary'))[0].id;
  assert.equal(
    upstreamCalls.filter((call) => call.path === '/v1/chat/completions')[0].body.reasoning_effort,
    'high',
  );
  assert.equal((await records('chat'))[0].messages.length, 2);
  assert.deepEqual(await records('chat', 'another-account'), []);
  await page.reload();
  await loadFont();
  await page.locator('.api-chat-row > button:first-child').filter({ hasText: '我想优化' }).click();
  await picker.filter({ hasText: 'High' }).waitFor();
  await picker.click();
  await page.locator('.model-picker-model-toggle').click();
  await page.getByRole('button', { name: 'model-b · 我的接口', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await picker.click();
  await page.getByRole('button', { name: '重置思维强度', exact: true }).click();
  await page.keyboard.press('Escape');
  await editor.fill('第二个对话');
  await editor.press('Enter');
  await waitIdle();
  await page.locator('.api-chat-row > button:first-child').filter({ hasText: '我想优化' }).click();
  await picker.filter({ hasText: 'model-b' }).waitFor();
  assert.equal((await records('summary')).length, 2);
  await editor.fill('连续对话的第二条');
  await editor.press('Enter');
  await waitIdle();
  const sent = upstreamCalls.filter((call) => call.path === '/v1/chat/completions').at(-1);
  assert.equal(sent.body.messages.length, 3, 'Local context goes directly to provider');
  assert.equal(sent.body.model, 'model-b');
  assert(!('reasoning_effort' in sent.body));
  mode = 'reject';
  await editor.fill('失败保留草稿');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '400' }).last().waitFor();
  assert.equal(await editor.inputValue(), '失败保留草稿');
  mode = 'normal';
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await waitIdle();
  assert(
    !upstreamCalls
      .filter((call) => call.path === '/v1/chat/completions')
      .at(-1)
      .body.messages.slice(0, -1)
      .some((message) => message.content === '失败保留草稿'),
  );
  mode = 'disconnect';
  await editor.fill('测试中断');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '回复连接中断' }).last().waitFor();
  const before = upstreamCalls.length;
  await editor.fill('中断后继续');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('heading', { name: '上次请求结果未知' }).waitFor();
  assert.equal(upstreamCalls.length, before);
  await page.getByRole('button', { name: '保留草稿', exact: true }).click();
  assert.equal(await editor.inputValue(), '中断后继续');
  mode = 'normal';
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '仍然发送', exact: true }).click();
  await waitIdle();
  mode = 'hang';
  await editor.fill('测试停止');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  await page.waitForTimeout(200);
  await screenshot('running.png');
  const closedBefore = closedStreams;
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByText('已停止', { exact: true }).waitFor();
  await page.waitForTimeout(100);
  assert(closedStreams > closedBefore, 'Stop closes direct upstream stream');
  // A second tab observes the same local history and stops a direct stream through BroadcastChannel.
  await editor.fill('另一个标签页停止');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  const otherPage = await context.newPage();
  await otherPage.goto(origin);
  await otherPage
    .locator('.api-chat-row > button:first-child')
    .filter({ hasText: '我想优化' })
    .click();
  await otherPage.getByRole('button', { name: '停止', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="停止"]'));
  await otherPage.close();
  // Reload while running: partial text is local, no server lease/polling or automatic replay.
  await editor.fill('刷新中的对话');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  await page.waitForTimeout(850);
  const requestsBeforeReload = upstreamCalls.filter(
    (call) => call.path === '/v1/chat/completions',
  ).length;
  await page.reload();
  await loadFont();
  await page.locator('.api-chat-row > button:first-child').filter({ hasText: '我想优化' }).click();
  await page.getByText(/页面关闭或连接中断/).waitFor();
  assert.equal(
    upstreamCalls.filter((call) => call.path === '/v1/chat/completions').length,
    requestsBeforeReload,
  );
  assert(
    (await records('chat'))
      .find((chat) => chat.id === first)
      .messages.at(-1)
      .content.includes('当然可以'),
  );
  mode = 'normal';
  // Shared composer UI and responsive settings remain unchanged.
  await page.getByRole('button', { name: '添加附件和操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '展开编辑器', exact: true }).click();
  await screenshot('expanded-editor.png');
  await page.getByRole('button', { name: '收起编辑器', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '收起会话列表', exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await screenshot('mobile.png');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: /我的接口.*2 个模型/ }).click();
  await screenshot('mobile-settings.png');
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  // Native modal restores focus after its exit transition; wait before editing.
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 320, height: 560 });
  await editor.fill('手机草稿');
  await screenshot('mobile-320.png');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.evaluate(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query === '(pointer: coarse)' ? { matches: true } : original(query);
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 1, configurable: true });
  });
  const beforeTouch = upstreamCalls.length;
  await editor.press('Enter');
  assert.equal(await editor.inputValue(), '手机草稿\n');
  await editor.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  assert.equal(upstreamCalls.length, beforeTouch);
  // Stream parser: fragmented UTF-8, CRLF, terminal, error, missing terminal, empty answer.
  await page.evaluate(async () => {
    const { streamCompletion } = await import('/src/features/api-chat/client.ts');
    const content = 'data: {"choices":[{"delta":{"content":"世界"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
    const bytes = new TextEncoder().encode(content);
    let text = '';
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
    await streamCompletion(response, new AbortController().signal, (value) => {
      text = value;
    });
    if (text !== '世界') throw new Error('Fragmented SSE failed');
    for (const value of [
      'data: {"error":{"message":"secret"}}\n\n',
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      'data: [DONE]\n\n',
    ]) {
      let failed = false;
      try {
        await streamCompletion(
          new Response(value, { headers: { 'Content-Type': 'text/event-stream' } }),
          new AbortController().signal,
          () => {},
        );
      } catch {
        failed = true;
      }
      if (!failed) throw new Error('Invalid SSE accepted');
    }
  });
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.getByRole('button', { name: '打开会话列表', exact: true }).click();
  await page.getByRole('button', { name: '删除对话 第二个对话', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除对话', exact: true }).click();
  await page.waitForFunction(async () => {
    const { LocalStore } = await import('/src/features/api-chat/local.ts');
    return (await new LocalStore('local-chat-test').list('summary')).length === 1;
  });
  assert.equal(await page.getByRole('button', { name: '切换工作模式', exact: true }).count(), 0);
  await page.reload();
  await page.locator('.api-chat-row > button:first-child').filter({ hasText: '我想优化' }).click();
  assert.equal(await editor.inputValue(), '手机草稿\n');
  // A local write failure must retain the draft and must not contact the provider.
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.evaluate(async () => {
    const { LocalStore } = await import('/src/features/api-chat/local.ts');
    window.originalWrite = LocalStore.prototype.write;
    LocalStore.prototype.write = async function (entries) {
      if (entries.some((entry) => entry.kind === 'chat')) throw new Error('模拟本地存储空间不足');
      return window.originalWrite.call(this, entries);
    };
  });
  const upstreamBeforeStorageFailure = upstreamCalls.length;
  await editor.fill('本地存储失败保留草稿');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '模拟本地存储空间不足' }).last().waitFor();
  assert.equal(await editor.inputValue(), '本地存储失败保留草稿');
  assert.equal(upstreamCalls.length, upstreamBeforeStorageFailure);
  await page.evaluate(async () => {
    const { LocalStore } = await import('/src/features/api-chat/local.ts');
    LocalStore.prototype.write = window.originalWrite;
    delete window.originalWrite;
  });
  const localData = await page.evaluate(async () => {
    const { LocalStore } = await import('/src/features/api-chat/local.ts');
    const store = new LocalStore('local-chat-test');
    return JSON.stringify({
      providers: await store.list('provider'),
      chats: await store.list('chat'),
      localStorage: { ...localStorage },
    });
  });
  assert(!localData.includes('fake-browser-test-key'), 'No API keys in persistent browser storage');
  assert(
    cloudCalls.every(
      (call) =>
        !call.path.startsWith('/api/v1/chat/') ||
        /^\/api\/v1\/chat\/keys(?:\/[^/]+(?:\/reveal)?)?$/.test(call.path),
    ),
  );
  for (const call of cloudCalls) {
    assert(!JSON.stringify(call.data || {}).includes('我想优化'));
    assert(!JSON.stringify(call.data || {}).includes('messages'));
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: browser-direct models/completions with CORS, encrypted key vault only, IndexedDB history/config, local reload/context/isolation, independent models/effort, draft retention, interrupted-send confirmation, stop/disconnect/reload, no replay or cloud history/polling, SSE parser, shared UI and responsive screenshots. Controlled provider, no real model calls.',
  );
} finally {
  await browser.close();
  for (const timer of timers) {
    clearInterval(timer);
    clearTimeout(timer);
  }
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  await rm(temp, { recursive: true, force: true });
}

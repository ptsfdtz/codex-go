/* global window, document, localStorage, crypto, navigator */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/api-chat/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  await context.addInitScript(() => {
    localStorage.setItem('agentdeck.web.work-mode', '"api"');
    localStorage.setItem('agentdeck.web.theme', 'light');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [],
    calls = [],
    sockets = [];
  let providers = [],
    chats = [],
    running = false,
    rejectSend = false,
    loseAcknowledgement = false;
  let streams = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => sockets.push(socket.url()));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const method = request.method();
    const data = request.postDataJSON();
    calls.push({ path, method, data });
    const reply = (value, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/api/v1/hosts') return reply({ hosts: [] });
    if (path.endsWith('/web/session'))
      return reply({ accountId: 'api-chat-test', mustChangePassword: false });
    if (path.endsWith('/web/csrf')) return reply({ csrfToken: 'test-csrf' });
    if (path === '/api/v1/chat/providers') return reply({ enabled: true, data: providers });
    if (path.startsWith('/api/v1/chat/providers/')) {
      assert.equal(request.headers()['x-csrf-token'], 'test-csrf');
      const id = path.split('/').at(-1);
      if (method === 'PUT') {
        providers = [{ ...data, id, apiKey: undefined, hasKey: true }];
        return reply({ saved: true });
      }
      providers = providers.filter((value) => value.id !== id);
      return reply({ deleted: true });
    }
    if (path === '/api/v1/chat/conversations') {
      if (method === 'POST') {
        if (!chats.some((chat) => chat.id === data.id))
          chats.unshift({ ...data, title: '新对话', messages: [] });
        return reply({ id: data.id });
      }
      return reply({ data: chats });
    }
    const id = path.split('/')[5],
      chat = chats.find((chat) => chat.id === id);
    if (path.endsWith('/messages')) {
      if (rejectSend) return reply({ message: '测试接口拒绝发送' }, 400);
      if (!chat.messages.some((message) => message.requestId === data.requestId)) {
        chat.title = data.text.slice(0, 40);
        chat.providerId = data.providerId;
        chat.model = data.model;
        chat.effort = data.effort;
        chat.messages.push(
          {
            id: crypto.randomUUID(),
            requestId: data.requestId,
            role: 'user',
            content: data.text,
            status: 'complete',
          },
          {
            id: crypto.randomUUID(),
            requestId: data.requestId,
            role: 'assistant',
            content: '',
            status: 'running',
          },
        );
      }
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        return route.abort();
      }
      return reply({ accepted: true, requestId: data.requestId });
    }
    if (path.endsWith('/events')) {
      streams++;
      const message = chat.messages.at(-1);
      message.content =
        '当然可以。我们可以从这几个方面开始：\n\n- 保持界面简洁\n- 让每个对话拥有独立的模型\n- 保存聊天记录，随时继续';
      message.status = running ? 'running' : 'complete';
      return route.fulfill({
        contentType: 'text/event-stream',
        body: `event: snapshot\ndata: ${JSON.stringify(chat)}\n\n`,
      });
    }
    if (path.endsWith('/stop')) {
      chat.messages.at(-1).status = 'stopped';
      return reply({ stopped: true });
    }
    if (chat) {
      if (method === 'DELETE') {
        chats = chats.filter((value) => value.id !== id);
        return reply({ deleted: true });
      }
      return reply(chat);
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  });
  const origin = process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1430';
  const font = process.env.COMPOSER_TEST_FONT;
  if (font) await page.route('**/__api-font', (route) => route.fulfill({ path: font }));
  await page.goto(origin);
  if (font)
    await page.evaluate(async () => {
      const style = document.createElement('style');
      style.textContent =
        "@font-face{font-family:ApiChatTest;src:url('/__api-font')} :root{font-family:ApiChatTest,sans-serif}";
      document.head.append(style);
      await document.fonts.load('14px ApiChatTest');
    });
  await page.getByRole('heading', { name: '有什么想聊的？' }).waitFor();
  await page.getByRole('button', { name: '切换工作模式' }).click();
  await page.getByRole('button', { name: /Codex.*连接电脑/ }).waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: new URL('mode-switcher.png', out).pathname });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('我的 API');
  await page.getByLabel('Base URL', { exact: true }).fill('https://api.example.com/v1');
  await page.getByLabel('API Key', { exact: true }).fill('fake-browser-test-key');
  await page.getByRole('textbox', { name: '模型', exact: true }).fill('model-a\nmodel-b');
  await page.locator('summary').filter({ hasText: '思考强度' }).click();
  await page.getByLabel('model-a 的思考强度', { exact: true }).fill('low, medium, high');
  await page.waitForTimeout(250);
  await page.screenshot({ path: new URL('api-settings.png', out).pathname });
  await page.getByRole('button', { name: '保存接口', exact: true }).click();
  await page.getByRole('button', { name: '添加接口', exact: true }).waitFor();
  assert(
    !JSON.stringify(await page.evaluate(() => ({ ...localStorage }))).includes(
      'fake-browser-test-key',
    ),
  );
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  assert.equal(await page.locator('.composer').count(), 1);
  assert.equal(await page.getByRole('button', { name: '退出登录', exact: true }).count(), 0);
  await page.getByRole('button', { name: '切换模型', exact: true }).click();
  await page.getByRole('slider', { name: '推理强度' }).fill('2');
  await page.waitForTimeout(250);
  await page.screenshot({ path: new URL('model-picker.png', out).pathname });
  await page.keyboard.press('Escape');
  await editor.fill('我想优化一个聊天应用，可以给我一些建议吗？');
  await editor.press('Enter');
  await page.getByText('当然可以。我们可以从这几个方面开始：', { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('textarea[aria-label="消息"]').value === '',
  );
  assert(streams > 0);
  assert.equal(calls.find((call) => call.path.endsWith('/messages')).data.effort, 'high');
  await page.waitForTimeout(250);
  await page.screenshot({ path: new URL('desktop.png', out).pathname });
  const firstId = chats[0].id;
  await page.reload();
  if (font)
    await page.evaluate(async () => {
      const style = document.createElement('style');
      style.textContent =
        "@font-face{font-family:ApiChatTest;src:url('/__api-font')} :root{font-family:ApiChatTest,sans-serif}";
      document.head.append(style);
      await document.fonts.load('14px ApiChatTest');
    });
  await page.locator('.api-chat-row > button:first-child').filter({ hasText: '我想优化' }).click();
  await page
    .getByRole('button', { name: '切换模型', exact: true })
    .filter({ hasText: 'High' })
    .waitFor();
  await page.getByRole('button', { name: '切换模型', exact: true }).click();
  await page.locator('.model-picker-model-toggle').click();
  await page.getByRole('button', { name: 'model-b · 我的 API', exact: true }).click();
  assert.equal(await page.getByRole('slider', { name: '推理强度' }).count(), 0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByRole('button', { name: '切换模型', exact: true }).click();
  await page.getByRole('button', { name: '重置思维强度', exact: true }).click();
  await page.keyboard.press('Escape');
  await editor.fill('第二个对话');
  await editor.press('Enter');
  await page.getByText('第二个对话', { exact: true }).last().waitFor();
  await page.waitForFunction(
    () => document.querySelector('textarea[aria-label="消息"]').value === '',
  );
  assert.equal(calls.filter((call) => call.path.endsWith('/messages')).at(-1).data.effort, '');
  await page.locator('.api-chat-row > button:first-child').filter({ hasText: '我想优化' }).click();
  await page
    .getByRole('button', { name: '切换模型', exact: true })
    .filter({ hasText: 'model-b' })
    .waitFor();
  await page.getByRole('button', { name: '切换模型', exact: true }).click();
  await page.locator('.model-picker-model-toggle').click();
  await page.getByRole('button', { name: 'model-a · 我的 API', exact: true }).click();
  await page.getByRole('slider', { name: '推理强度' }).fill('1');
  await page.keyboard.press('Escape');
  await page
    .locator('.api-chat-row > button:first-child')
    .filter({ hasText: '第二个对话' })
    .click();
  await page
    .getByRole('button', { name: '切换模型', exact: true })
    .filter({ hasText: 'model-a' })
    .waitFor();
  assert(
    !(await page.getByRole('button', { name: '切换模型', exact: true }).innerText()).includes(
      'Medium',
    ),
  );
  await page.locator('.api-chat-row > button:first-child').filter({ hasText: '我想优化' }).click();
  await page
    .getByRole('button', { name: '切换模型', exact: true })
    .filter({ hasText: 'Medium' })
    .waitFor();
  await page.getByRole('button', { name: '添加附件和操作', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Plan', exact: true }).count(), 0);
  await page.getByRole('menuitem', { name: /展开编辑器/ }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: new URL('expanded-editor.png', out).pathname });
  await page.getByRole('button', { name: /收起编辑器/ }).click();
  assert.equal(chats.length, 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '收起会话列表' }).click();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.waitForTimeout(250);
  await page.waitForTimeout(250);
  await page.screenshot({ path: new URL('mobile.png', out).pathname });
  await editor.fill('手机草稿');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 560 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: new URL('mobile-320.png', out).pathname });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const sentBeforeKeyboard = calls.filter((call) => call.path.endsWith('/messages')).length;
  await page.evaluate(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query === '(pointer: coarse)' ? { matches: true } : original(query);
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 1, configurable: true });
  });
  await editor.press('Enter');
  assert.equal(await editor.inputValue(), '手机草稿\n');
  await editor.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  assert.equal(calls.filter((call) => call.path.endsWith('/messages')).length, sentBeforeKeyboard);
  await editor.fill('手机草稿');
  rejectSend = true;
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '测试接口拒绝发送' }).waitFor();
  assert.equal(await editor.inputValue(), '手机草稿');
  rejectSend = false;
  await page.getByRole('button', { name: '切换模型', exact: true }).click();
  await page.getByRole('button', { name: '重置思维强度', exact: true }).click();
  await page.keyboard.press('Escape');
  loseAcknowledgement = true;
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('textarea[aria-label="消息"]').value === '',
  );
  assert.equal(
    chats.find((chat) => chat.id === firstId).messages.filter((message) => message.role === 'user')
      .length,
    2,
  );
  await editor.fill('保持生成以测试停止');
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="发送"]');
    return button && !button.disabled;
  });
  running = true;
  await page.getByRole('button', { name: '发送', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '加入队列', exact: true }).count(), 0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: new URL('running.png', out).pathname });
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByText('已停止', { exact: true }).waitFor();
  assert.equal(calls.filter((call) => call.path.endsWith('/messages')).at(-1).data.effort, '');
  assert(!calls.some((call) => /hosts|relay|devices/.test(call.path)));
  assert(
    sockets.every((url) => {
      const socket = new URL(url);
      return socket.hostname === new URL(origin).hostname && socket.port === new URL(origin).port;
    }),
    'Only the local Vite HMR socket may be opened',
  );
  await page.getByRole('button', { name: '切换工作模式' }).click();
  await page.getByRole('button', { name: /Codex.*连接电脑/ }).click();
  await page.getByRole('button', { name: '切换工作模式' }).waitFor();
  await page.getByRole('button', { name: '切换工作模式' }).click();
  await page.getByRole('button', { name: /AgentChat.*连接模型/ }).click();
  await page.getByRole('heading', { name: '有什么想聊的？' }).waitFor();
  await editor.fill('切换模式后保留这段草稿');
  await page.getByRole('button', { name: '切换工作模式' }).click();
  await page.getByRole('button', { name: /Codex.*连接电脑/ }).click();
  await page.getByRole('button', { name: '切换工作模式' }).waitFor();
  await page.getByRole('button', { name: '切换工作模式' }).click();
  await page.getByRole('button', { name: /AgentChat.*连接模型/ }).click();
  await editor.waitFor();
  assert.equal(await editor.inputValue(), '切换模式后保留这段草稿');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: device-free mode, provider/key setup, chat streaming, per-chat models, failure draft retention, lost acknowledgement recovery, stop and responsive screenshots. Controlled API; no real model calls.',
  );
} finally {
  await browser.close();
}

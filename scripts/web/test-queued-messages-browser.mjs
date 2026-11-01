/* global window, document */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/queue/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1100, height: 800 } });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => route.abort());
  const font = process.env.COMPOSER_TEST_FONT;
  if (font) await page.route('**/__queue-font', (route) => route.fulfill({ path: font }));
  await page.goto(process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1430');
  await page.evaluate(async (font) => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { QueuedMessages } = await import('/src/features/queue/QueuedMessages.tsx');
    const { Composer } = await import('/src/features/Composer.tsx');
    document.getElementById('root').style.display = 'none';
    const el = document.createElement('div');
    el.style =
      'height:100dvh;display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:24px';
    document.body.append(el);
    const style = document.createElement('style');
    style.textContent = font
      ? "@font-face{font-family:QueueTest;src:url('/__queue-font')} :root{font-family:QueueTest,sans-serif}"
      : '';
    document.head.append(style);
    const root = (dom.default || dom).createRoot(el);
    window.calls = [];
    window.context = 'a';
    window.revision = 0;
    window.active = true;
    window.canSteer = true;
    window.failure = '';
    window.unknown = false;
    window.entries = [
      {
        id: 'one',
        inputRevision: 'rev1',
        input: [{ type: 'text', text: '请检查移动端的布局，保持当前的灰白与深色主题。' }],
      },
      {
        id: 'two',
        inputRevision: 'rev2',
        input: [{ type: 'text', text: '完成后补充测试结果，并提供桌面和手机截图。' }],
      },
    ];
    window.holdRead = false;
    window.holdActive = false;
    const request = async (action, payload) => {
      window.calls.push({ action, payload });
      if (action === 'queue.list') {
        const value = { sessionId: payload.sessionId, data: structuredClone(window.entries) };
        if (window.holdRead)
          await new Promise((resolve) => {
            window.releaseRead = resolve;
          });
        return value;
      }
      if (action === 'turn.active') {
        if (window.holdActive)
          await new Promise((resolve) => {
            window.releaseActive = resolve;
          });
        return { sessionId: payload.sessionId, upstreamTurnId: 'turn-running' };
      }
      if (window.failure) throw new Error(window.failure);
      window.entries = window.entries.filter((entry) => entry.id !== payload.submissionId);
      return { accepted: true };
    };
    const uncertain = () => window.unknown;
    window.renderQueue = () =>
      root.render(
        React.createElement(Composer, {
          draft: {
            text: '',
            attachments: [],
            skills: [],
            mode: 'default',
            model: 'gpt-6',
            effort: 'high',
          },
          models: [
            {
              id: 'gpt-6',
              displayName: 'GPT-6',
              supportedReasoningEfforts: ['high'],
              defaultReasoningEffort: 'high',
            },
          ],
          supports: () => true,
          disabled: false,
          busy: false,
          active: window.active,
          permission: 'workspace',
          onPermission: () => {},
          onChange: () => {},
          onSend: () => {},
          onStop: () => {},
          onPanel: () => {},
          onNew: () => {},
          queued: React.createElement(QueuedMessages, {
            key: window.context,
            request,
            sessionId: window.context,
            revision: window.revision,
            enabled: true,
            disabled: false,
            active: window.active,
            canStart: true,
            canSteer: window.canSteer,
            uncertain,
            onChanged: () => {},
          }),
        }),
      );
    window.renderQueue();
    if (font) await document.fonts.load('14px QueueTest');
  }, !!font);
  const send = (id) => page.getByRole('button', { name: `提前发送消息 ${id}`, exact: true });
  const del = (id) => page.getByRole('button', { name: `删除待发送消息 ${id}`, exact: true });
  await page.waitForFunction(
    () =>
      !document.querySelector('.queued-messages[aria-busy="true"]') &&
      document.querySelector('.queued-message'),
  );
  assert.equal(await page.locator('.queued-message').count(), 2);
  for (const [name, width, theme] of [
    ['desktop', 1100, 'light'],
    ['mobile', 390, 'dark'],
    ['mobile-320', 320, 'light'],
  ]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const queue = await page.locator('.queued-messages').boundingBox();
    const composer = await page.locator('.composer').boundingBox();
    assert(queue.y + queue.height <= composer.y + 1);
    await page.waitForTimeout(200);
    await page.screenshot({ path: new URL(`${name}.png`, out).pathname });
  }
  await send('one').click();
  await send('one').waitFor({ state: 'detached' });
  let calls = await page.evaluate(() => window.calls);
  const steer = calls.find((call) => call.action === 'queue.steer');
  assert.deepEqual(steer.payload, {
    sessionId: 'a',
    submissionId: 'one',
    expectedTurnId: 'turn-running',
    expectedInputRevision: 'rev1',
  });
  assert(
    !calls.some((call) => call.action === 'turn.interruptActive' || call.action === 'queue.start'),
  );
  await del('two').click();
  await page.locator('.queued-messages').waitFor({ state: 'detached' });
  async function reset(change) {
    await page.evaluate((change) => {
      Object.assign(window, change);
      window.context += 'x';
      window.revision++;
      window.renderQueue();
    }, change);
    await page.waitForFunction(
      () =>
        document.querySelector('.queued-message') &&
        !document.querySelector('.queued-messages[aria-busy="true"]'),
    );
  }
  const plain = {
    id: 'plain',
    inputRevision: 'r',
    input: [{ type: 'text', text: '继续完成测试' }],
  };
  await reset({ entries: [plain], active: false });
  await send('plain').click();
  await send('plain').waitFor({ state: 'detached' });
  assert((await page.evaluate(() => window.calls)).some((call) => call.action === 'queue.start'));
  await reset({ entries: [plain], active: true, canSteer: false });
  assert(await send('plain').isDisabled());
  await reset({
    entries: [{ ...plain, input: [...plain.input, { type: 'image', url: 'test' }] }],
    canSteer: true,
  });
  assert(await send('plain').isDisabled());
  await reset({ entries: [plain], failure: '测试发送失败' });
  await send('plain').click();
  await page.getByRole('alert').filter({ hasText: '测试发送失败' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.queued-messages[aria-busy="true"]'));
  assert.equal(await page.locator('.queued-message').count(), 1);
  assert.match(await page.getByRole('alert').textContent(), /测试发送失败/);
  await reset({ entries: [plain], unknown: false, failure: '', holdActive: true });
  const before = await page.evaluate(
    () => window.calls.filter((call) => call.action === 'queue.steer').length,
  );
  await send('plain').click();
  await page.waitForFunction(() => !!window.releaseActive);
  assert(await send('plain').isDisabled());
  await send('plain').evaluate((node) => node.click());
  assert.equal(
    await page.evaluate(() => window.calls.filter((call) => call.action === 'queue.steer').length),
    before,
  );
  await reset({ entries: [{ ...plain, id: 'other' }], holdActive: false });
  await page.evaluate(() => window.releaseActive());
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate(() => window.calls.filter((call) => call.action === 'queue.steer').length),
    before,
  );
  await reset({
    entries: [
      { ...plain, deliveryState: 'needsReview', deliveryMessage: '结果待核对，不会自动重发' },
    ],
  });
  assert(await send('plain').isDisabled());
  assert(await del('plain').isEnabled());
  await page.evaluate(() => {
    window.holdRead = true;
    window.revision++;
    window.renderQueue();
  });
  await page.waitForFunction(() => !!window.releaseRead);
  await reset({ entries: [{ ...plain, id: 'new-context' }], holdRead: false });
  await page.evaluate(() => window.releaseRead());
  await page.waitForTimeout(150);
  assert.equal(await send('plain').count(), 0);
  assert.equal(await send('new-context').count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    'Queued messages: steering, idle start, delete, capabilities, resources, failure retention, context isolation and 3 screenshots passed.',
  );
} finally {
  await browser.close();
}

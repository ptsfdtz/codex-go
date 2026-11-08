/* global window, document */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = fileURLToPath(new URL('../../artifacts/composer-suggestions/', import.meta.url));
await mkdir(out, { recursive: true });
const fontPath = process.env.COMPOSER_TEST_FONT;
const origin = process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1430';
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  });
  try {
    const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1200, height: 820 } });
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/**', (r) => r.abort());
    if (fontPath)
      await page.route('**/__composer-font.ttf', (r) =>
        r.fulfill({ path: fontPath, contentType: 'font/ttf' }),
      );
    await page.goto(origin);
    await page.evaluate(async (useTestFont) => {
      const React = (await import('/node_modules/.vite/deps/react.js')).default;
      const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { createRoot } = dom.default || dom;
      const { Composer } = await import('/src/features/Composer.tsx');
      const font = document.createElement('style');
      font.textContent = useTestFont
        ? "@font-face{font-family:ComposerTest;src:url('/__composer-font.ttf')} :root{font-family:ComposerTest,sans-serif}"
        : '';
      document.head.append(font);
      document.getElementById('root').style.display = 'none';
      const el = document.createElement('div');
      el.style =
        'height:100dvh;display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:24px';
      document.body.append(el);
      window.root = createRoot(el);
      window.draft = {
        text: '',
        attachments: [],
        skills: [],
        mode: 'default',
        model: 'gpt-6',
        effort: 'high',
      };
      window.context = 'a';
      window.changes = [];
      window.sends = [];
      window.stops = 0;
      window.active = false;
      window.excluded = [];
      window.busy = false;
      window.disabled = false;
      window.permission = 'workspace';
      window.total = 2097152;
      window.feedback = undefined;
      window.render = () =>
        window.root.render(
          React.createElement(Composer, {
            key: window.context,
            draft: window.draft,
            projectId: 'project-test',
            sessionId: 'session-test',
            request: async () => ({
              skills: [
                {
                  id: 'documents',
                  name: 'documents',
                  displayName: 'Documents',
                  description: 'Create and edit documents',
                  enabled: true,
                },
              ],
            }),
            models: window.testModels || [
              {
                id: 'gpt-6',
                displayName: window.longName || 'GPT-6',
                supportedReasoningEfforts: ['low', 'medium', 'high'],
                defaultReasoningEffort: 'medium',
              },
            ],
            supports: (k) => !window.excluded.includes(k),
            disabled: window.disabled,
            busy: window.busy,
            active: window.active,
            permission: window.permission,
            onPermission: (v) => {
              window.permission = v;
              window.render();
            },
            onChange: (change) => {
              window.changes.push(change);
              window.draft = { ...window.draft, ...change };
              window.render();
            },
            onSend: (kind) => window.sends.push(kind || 'send'),
            onStop: () => window.stops++,
            onPanel: (p) => (window.panel = p),
            onNew: () => {},
            attachmentTotalBytes: window.total,
            feedback: window.feedback,
          }),
        );
      window.render();
      window.blobs = new Set();
      const create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (b) => {
        const url = create(b);
        window.blobs.add(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        window.blobs.delete(url);
        revoke(url);
      };
    }, !!fontPath);
    const editor = page.getByRole('textbox', { name: '消息' });
    await editor.click();
    await editor.fill('/');
    await page.getByRole('listbox', { name: '命令' }).waitFor();
    await editor.press('Enter');
    assert.equal(await page.evaluate(() => window.draft.responseSpeed), 'fast');
    assert.equal(await page.evaluate(() => window.sends.length), 0);
    await editor.fill('/plan');
    await editor.press('Enter');
    assert.equal(await page.evaluate(() => window.draft.mode), 'plan');
    await editor.fill('@doc');
    await page.getByRole('option', { name: /Documents/ }).click();
    assert.equal(await editor.inputValue(), '');
    assert.equal(await page.evaluate(() => window.draft.skills[0].id), 'documents');
    await editor.fill('/');
    await editor.press('Escape');
    assert.equal(await page.getByRole('listbox').count(), 0);
    assert.equal(await editor.inputValue(), '/');
    for (const width of [320, 390, 1200]) {
      await page.setViewportSize({ width, height: 700 });
      await editor.fill('');
      await editor.fill('/');
      await page.getByRole('listbox').waitFor();
      const box = await page.getByRole('listbox').boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width && box.y >= 0);
      await page.screenshot({ path: out + width + '.png' });
    }
    await page.evaluate(async () => {
      const React = (await import('/node_modules/.vite/deps/react.js')).default;
      const { TaskBanners } = await import('/src/features/notifications/TaskBanners.tsx');
      window.root.render(
        React.createElement(TaskBanners, {
          notices: [{ id: 'n', sessionId: 'other', kind: 'completed' }],
          sessions: [{ sessionId: 'other', title: '查找项目启动方法' }],
          onOpen: (s) => {
            window.openedSession = s.sessionId;
          },
          onDismiss: (id) => {
            window.dismissedNotice = id;
          },
        }),
      );
    });
    await page.getByRole('button', { name: /Codex 任务已完成/ }).click();
    assert.equal(await page.evaluate(() => window.openedSession), 'other');
    assert.equal(await page.evaluate(() => window.dismissedNotice), 'n');
    assert.deepEqual(errors, []);
    console.log(
      'Passed command selection, mention catalog, Escape, mobile layout and completion navigation',
    );
  } finally {
    await browser.close();
  }
})();

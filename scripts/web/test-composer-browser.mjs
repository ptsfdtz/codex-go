/* global window, document, navigator, DataTransfer, File, KeyboardEvent, DragEvent, ClipboardEvent, HTMLImageElement, atob, btoa, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = fileURLToPath(new URL('../../artifacts/composer/', import.meta.url));
await mkdir(out, { recursive: true });
const fontPath = process.env.COMPOSER_TEST_FONT;
const origin = process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1430';
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
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
    const editor = page.getByRole('textbox', { name: '消息' }),
      add = page.getByRole('button', { name: '添加附件和操作', exact: true }),
      send = () => page.getByRole('button', { name: '发送', exact: true });
    await editor.waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert((await editor.boundingBox()).height <= 40);
    await page
      .locator('.composer-wrap')
      .screenshot({ animations: 'disabled', path: out + 'desktop-empty.png' });
    await editor.fill('请检查项目中的输入体验，并说明可以改进的地方。');
    await editor.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.sends), ['send']);
    await editor.press('Shift+Enter');
    assert((await editor.inputValue()).includes('\n'));
    await editor.evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
      ),
    );
    assert.equal(await page.evaluate(() => window.sends.length), 1);
    await editor.fill('自动换行与侧边文件预览宽度调整。'.repeat(8));
    const wideHeight = (await editor.boundingBox()).height;
    await page.locator('.composer-wrap').evaluate((el) => {
      el.style.width = '420px';
    });
    await page.waitForFunction(
      (height) => document.querySelector('textarea').getBoundingClientRect().height > height,
      wideHeight,
    );
    await page.locator('.composer-wrap').evaluate((el) => {
      el.style.width = '';
    });
    await editor.fill(
      Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行：检查自动高度与滚动。`).join('\n'),
    );
    assert((await editor.boundingBox()).height <= 221);
    assert.equal(await editor.evaluate((el) => getComputedStyle(el).overflowY), 'auto');
    await add.click();
    const menu = page.getByRole('menu', { name: '添加附件和操作' });
    await menu.waitFor();
    await page.waitForFunction(() => document.activeElement?.closest('[role=menu]'));
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '展开编辑器');
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '添加文件或图片');
    await page.keyboard.press('Escape');
    assert(await add.evaluate((el) => el === document.activeElement));
    await add.click();
    await menu.getByRole('menuitem', { name: '展开编辑器', exact: true }).click();
    assert((await editor.boundingBox()).height >= 280);
    await page
      .locator('.composer-wrap')
      .screenshot({ animations: 'disabled', path: out + 'expanded.png' });
    await page.getByRole('button', { name: '收起编辑器', exact: true }).click();
    await editor.fill('请参考这张界面截图优化布局。');
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(0, 0, 400, 240);
      ctx.fillStyle = '#212121';
      ctx.font = '24px sans-serif';
      ctx.fillText('AgentDeck', 28, 50);
      ctx.fillStyle = '#dedede';
      ctx.fillRect(28, 85, 344, 90);
      window.image = canvas.toDataURL('image/png').split(',')[1];
      window.draft = {
        ...window.draft,
        mode: 'plan',
        attachments: [
          { name: '界面参考.png', data: window.image, mime: 'image/png', bytes: 3000 },
          { name: 'requirements.md', data: btoa('requirements'), mime: 'text/markdown', bytes: 12 },
        ],
        skills: [{ id: 'review', name: 'review', displayName: '代码审查' }],
      };
      window.render();
    });
    await page.getByRole('button', { name: '预览图片 界面参考.png' }).click();
    await page.getByRole('dialog', { name: '界面参考.png' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert((await editor.boundingBox()).height <= 40);
    await page
      .locator('.composer-wrap')
      .screenshot({ animations: 'disabled', path: out + 'attachments.png' });
    await page.getByRole('button', { name: '移除附件 界面参考.png' }).click();
    await page.waitForFunction(() => window.blobs.size === 0);
    await page.getByRole('button', { name: '移除附件 requirements.md' }).click();
    await page.getByRole('button', { name: '移除技能 review' }).click();
    await page.getByRole('button', { name: '移除 Plan 模式' }).click();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['drop contents'], 'dropped.txt', { type: 'text/plain' }));
      document
        .querySelector('.composer')
        .dispatchEvent(
          new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
    });
    await page.getByText('dropped.txt', { exact: true }).waitFor();
    await page.getByRole('button', { name: '移除附件 dropped.txt' }).click();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([Uint8Array.from(atob(window.image), (c) => c.charCodeAt(0))], 'pasted.png', {
          type: 'image/png',
        }),
      );
      document
        .querySelector('textarea')
        .dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        );
    });
    await page.getByRole('button', { name: '预览图片 pasted.png' }).waitFor();
    await page.getByRole('button', { name: '移除附件 pasted.png' }).click();
    await page.locator('input[type=file]').setInputFiles({
      name: 'oversize.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(524289),
    });
    await page.getByRole('alert').filter({ hasText: '单文件最大' }).waitFor();
    assert((await editor.inputValue()).includes('请参考'));
    await page.evaluate(() => {
      window.active = true;
      window.render();
    });
    const queue = page.getByRole('button', { name: '加入队列', exact: true });
    await queue.click();
    assert.equal(await page.evaluate(() => window.sends.at(-1)), 'queue');
    await page.getByRole('button', { name: '停止', exact: true }).click();
    assert.equal(await page.evaluate(() => window.stops), 1);
    await add.click();
    await menu.getByRole('menuitem', { name: '立即补充到当前任务' }).click();
    assert.equal(await page.evaluate(() => window.sends.at(-1)), 'steer');
    await page.evaluate(() => {
      window.context = 'queue';
      window.render();
      document.documentElement.dataset.theme = 'dark';
    });
    await page.waitForFunction(() => !document.querySelector('.composer-feedback'));
    await page
      .locator('.composer-wrap')
      .screenshot({ animations: 'disabled', path: out + 'queue-dark.png' });
    await page.evaluate(() => {
      window.permission = 'full';
      window.draft = { ...window.draft, text: '' };
      window.render();
    });
    await page.getByRole('button', { name: '执行权限：完整访问' }).waitFor();
    await page
      .locator('.composer-actions')
      .screenshot({ animations: 'disabled', path: out + 'actions-empty-dark.png' });
    assert(await queue.isDisabled());
    await editor.fill('继续检查并完成任务');
    await page
      .locator('.composer-actions')
      .screenshot({ animations: 'disabled', path: out + 'actions-ready-dark.png' });
    await page.getByRole('button', { name: '执行权限：完整访问' }).click();
    await page.getByRole('group', { name: '执行权限', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
    await page
      .locator('.composer-actions')
      .screenshot({ animations: 'disabled', path: out + 'actions-ready-light.png' });
    await page.setViewportSize({ width: 320, height: 700 });
    assert(await page.locator('.composer').evaluate((el) => el.scrollWidth <= el.clientWidth));
    await page
      .locator('.composer-wrap')
      .screenshot({ animations: 'disabled', path: out + 'actions-mobile.png' });
    await page.setViewportSize({ width: 1200, height: 820 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      window.permission = 'workspace';
      window.render();
    });
    await page.evaluate(() => {
      window.excluded = ['nativeQueue'];
      window.render();
    });
    assert(await queue.isDisabled());
    await page.getByText('当前电脑不支持队列，请等待任务完成或立即补充。').waitFor();
    for (const [capability, resource] of [
      [
        'nativeQueueAttachments',
        { attachments: [{ name: 'queued.txt', data: 'YQ==', mime: 'text/plain', bytes: 1 }] },
      ],
      ['nativeQueueSkills', { attachments: [], skills: [{ id: 'skill', name: 'skill' }] }],
    ]) {
      await page.evaluate(
        ({ capability, resource }) => {
          window.excluded = [capability];
          window.draft = { ...window.draft, ...resource };
          window.render();
        },
        { capability, resource },
      );
      assert(await queue.isDisabled());
    }
    await page.evaluate(() => {
      window.draft = { ...window.draft, attachments: [], skills: [] };
    });
    await page.evaluate(() => {
      window.excluded = [];
      window.active = false;
      window.context = 'compression';
      window.render();
    });
    // Delay actual image decoding to exercise typing and context changes during compression.
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 900;
      const ctx = canvas.getContext('2d');
      const pixels = ctx.createImageData(900, 900);
      let n = 17;
      for (let i = 0; i < pixels.data.length; i += 4) {
        n = (n * 1664525 + 1013904223) >>> 0;
        pixels.data[i] = n & 255;
        pixels.data[i + 1] = (n >>> 8) & 255;
        pixels.data[i + 2] = (n >>> 16) & 255;
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      window.large = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      window.decodeOriginal = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        return new Promise(
          (resolve) => (window.releaseDecode = () => resolve(window.decodeOriginal.call(this))),
        );
      };
      const dt = new DataTransfer();
      dt.items.add(new File([window.large], 'large.png', { type: 'image/png' }));
      document
        .querySelector('.composer')
        .dispatchEvent(
          new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
    });
    await page.waitForFunction(() => !!window.releaseDecode);
    await editor.fill('压缩期间仍然可以输入');
    assert(await page.getByRole('button', { name: '正在读取或压缩附件…' }).isDisabled());
    await page.evaluate(() => window.releaseDecode());
    await page.getByText(/已压缩/).waitFor();
    assert.equal(await editor.inputValue(), '压缩期间仍然可以输入');
    assert((await page.evaluate(() => window.draft.attachments[0].bytes)) <= 524288);
    await page.evaluate(() => {
      window.draft = { ...window.draft, attachments: [] };
      window.render();
    });
    await page.waitForFunction(() => window.blobs.size === 0);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([window.large], 'old.png', { type: 'image/png' }));
      document
        .querySelector('.composer')
        .dispatchEvent(
          new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
    });
    await page.getByText('正在读取或压缩附件，可继续输入…').waitFor();
    await page.evaluate(() => {
      window.context = 'other-chat';
      window.draft = { ...window.draft, text: '另一段对话', attachments: [] };
      window.render();
    });
    await editor.fill('另一段对话的草稿');
    await page.evaluate(() => window.releaseDecode());
    await page.waitForFunction(() => window.blobs.size === 0);
    assert.equal(await page.locator('.composer-attachment').count(), 0);
    assert.equal(await editor.inputValue(), '另一段对话的草稿');
    await page.evaluate(() => {
      HTMLImageElement.prototype.decode = window.decodeOriginal;
      window.active = false;
      window.permission = 'full';
      window.render();
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page
        .locator('.composer-wrap')
        .screenshot({ animations: 'disabled', path: out + `mobile-${width}-dark.png` });
      assert(await page.locator('.composer').evaluate((el) => el.scrollWidth <= el.clientWidth));
      const box = await send().boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width);
      await add.click();
      const mb = await menu.boundingBox();
      assert(mb.x >= 0 && mb.y >= 0 && mb.x + mb.width <= width);
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
    await page
      .locator('.composer-wrap')
      .screenshot({ animations: 'disabled', path: out + 'mobile-light.png' });
    await page.evaluate(() => {
      window.longName = 'GPT-6 Extra Long Model Name For Narrow Screens';
      window.render();
    });
    await page.waitForFunction(() => {
      const label = document.querySelector('.model-picker-trigger span');
      return label.scrollWidth > label.clientWidth;
    });
    assert(await page.locator('.composer').evaluate((el) => el.scrollWidth <= el.clientWidth));
    await page.evaluate(() => {
      window.longName = '';
      window.render();
    });
    // Touch keyboard Enter must insert a newline, while Ctrl+Enter remains a send shortcut.
    await page.evaluate(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q === '(pointer: coarse)' ? { matches: true } : original(q));
      Object.defineProperty(navigator, 'maxTouchPoints', { value: 1, configurable: true });
    });
    const count = await page.evaluate(() => window.sends.length);
    await editor.press('Enter');
    assert.equal(await page.evaluate(() => window.sends.length), count);
    await editor.press('Control+Enter');
    assert.equal(await page.evaluate(() => window.sends.length), count + 1);
    await page.setViewportSize({ width: 390, height: 430 });
    await editor.fill('键盘打开后的长文本\n'.repeat(35));
    assert((await editor.boundingBox()).height <= 130);
    const sb = await send().boundingBox();
    assert(sb.y + sb.height <= 430);
    await page
      .locator('.composer-wrap')
      .screenshot({ animations: 'disabled', path: out + 'mobile-keyboard.png' });
    await page.evaluate(() => {
      window.feedback = '发送失败，草稿已保留';
      window.disabled = true;
      window.render();
    });
    await page.getByRole('alert').filter({ hasText: '发送失败，草稿已保留' }).waitFor();
    assert(await send().isDisabled());
    assert((await editor.inputValue()).length > 0);
    await page.setViewportSize({ width: 1200, height: 820 });
    await page.evaluate(() => {
      window.context = 'model-selection';
      window.disabled = false;
      window.feedback = undefined;
      window.active = false;
      window.testModels = [
        {
          id: 'catalog-default',
          model: 'wire-default',
          displayName: 'Default Test',
          isDefault: true,
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium',
        },
        {
          id: 'catalog-b',
          model: 'wire-b',
          displayName: 'Model B',
          supportedReasoningEfforts: ['low', 'high'],
          defaultReasoningEffort: 'low',
        },
      ];
      window.draft = { ...window.draft, text: 'first turn', model: '', effort: '' };
      window.render();
    });
    await page.getByRole('button', { name: '切换模型', exact: true }).click();
    const slider = page.getByRole('slider', { name: '推理强度' });
    await slider.fill('2');
    assert.deepEqual(
      await page.evaluate(() => ({ model: window.draft.model, effort: window.draft.effort })),
      { model: 'wire-default', effort: 'high' },
    );
    await page.getByRole('button', { name: '模型 · Default Test', exact: true }).click();
    await page.getByRole('button', { name: 'Model B', exact: true }).click();
    await slider.fill('1');
    assert.deepEqual(
      await page.evaluate(() => ({ model: window.draft.model, effort: window.draft.effort })),
      { model: 'wire-b', effort: 'high' },
    );
    const wire = await page.evaluate(async () => {
      const { turnOptions } = await import('/src/features/composer-input.ts');
      return turnOptions(window.draft, 'workspace');
    });
    assert.equal(wire.model, 'wire-b');
    assert.equal(wire.effort, 'high');
    await page.keyboard.press('Escape');
    // Exercise the inline editor with the same parent classes as the real timeline.
    await page.setViewportSize({ width: 1200, height: 820 });
    await page.evaluate(async () => {
      const React = (await import('/node_modules/.vite/deps/react.js')).default;
      const { MessageEditor } = await import('/src/features/MessageEditor.tsx');
      window.editText = '更新上线';
      window.editBusy = false;
      window.editDisabled = false;
      window.editError = '';
      window.editSends = 0;
      window.editCancels = 0;
      window.renderEditor = () =>
        window.root.render(
          React.createElement(
            'article',
            {
              className: 'turn user-turn',
              style: { width: 'calc(100% - 24px)', maxWidth: 760, margin: '0 auto' },
            },
            React.createElement(
              'div',
              { className: 'message-content editing-message' },
              React.createElement(MessageEditor, {
                text: window.editText,
                busy: window.editBusy,
                disabled: window.editDisabled,
                error: window.editError,
                onChange: (text) => {
                  window.editText = text;
                  window.renderEditor();
                },
                onSend: () => window.editSends++,
                onCancel: () => window.editCancels++,
              }),
            ),
          ),
        );
      document.documentElement.dataset.theme = 'dark';
      window.renderEditor();
    });
    const edited = page.getByRole('textbox', { name: '修改消息' });
    await edited.waitFor();
    assert((await edited.boundingBox()).height <= 42);
    await page
      .locator('.user-turn')
      .screenshot({ animations: 'disabled', path: out + 'message-editor-dark.png' });
    await edited.press('Enter');
    assert.equal(await page.evaluate(() => window.editSends), 0);
    await edited.press('Control+Enter');
    assert.equal(await page.evaluate(() => window.editSends), 1);
    await edited.evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          isComposing: true,
          bubbles: true,
        }),
      ),
    );
    assert.equal(await page.evaluate(() => window.editSends), 1);
    await edited.press('Escape');
    assert.equal(await page.evaluate(() => window.editCancels), 1);
    await edited.fill('');
    assert(await page.getByRole('button', { name: '保存并发送' }).isDisabled());
    await edited.fill('修改后的内容会保留，直到发送成功。');
    await page.evaluate(() => {
      window.editBusy = true;
      window.renderEditor();
    });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.message-editor button')].find(
          (button) => button.textContent === '取消',
        )?.disabled,
    );
    assert(await page.getByRole('button', { name: '取消', exact: true }).isDisabled());
    assert(await edited.evaluate((el) => el.readOnly));
    await edited.press('Control+Enter');
    assert.equal(await page.evaluate(() => window.editSends), 1);
    await page.evaluate(() => {
      window.editBusy = false;
      window.editError = '发送未完成，请核对后重试。';
      window.renderEditor();
    });
    await page.getByRole('alert').filter({ hasText: '发送未完成' }).waitFor();
    assert.equal(await edited.inputValue(), '修改后的内容会保留，直到发送成功。');
    await page.evaluate(() => {
      window.editError = '';
      window.editText = '更新上线';
      window.renderEditor();
      document.documentElement.dataset.theme = 'light';
    });
    await page
      .locator('.user-turn')
      .screenshot({ animations: 'disabled', path: out + 'message-editor-light.png' });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 700 });
      assert(
        await page.locator('.editing-message').evaluate((el) => el.scrollWidth <= el.clientWidth),
      );
      await page
        .locator('.user-turn')
        .screenshot({ animations: 'disabled', path: out + `message-editor-mobile-${width}.png` });
    }
    assert.deepEqual(errors, []);
    console.log(
      'PASS: auto-height/expand, Enter/IME/touch, menu keys/focus, thumbnail/preview/remove/revoke, drop/paste, oversized file, compression typing and cross-chat race, queue/steer/stop/capability guards, 320/390 layouts and keyboard viewport; inline edit layout, shortcuts, IME, busy guards and error preservation. Screenshots: ' +
        out,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

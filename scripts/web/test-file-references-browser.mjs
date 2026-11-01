import { fileURLToPath } from 'node:url';
/* global window, document, TextEncoder */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/file-references/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1200, height: 820 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => route.abort());
  if (process.env.COMPOSER_TEST_FONT)
    await page.route('**/__font', (route) =>
      route.fulfill({ path: process.env.COMPOSER_TEST_FONT }),
    );
  await page.goto(process.env.FILE_REFERENCE_TEST_ORIGIN || 'http://127.0.0.1:1492/');
  await page.evaluate(async (font) => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = dom.default || dom;
    const { Composer } = await import('/src/features/Composer.tsx');
    const { FileWorkspace } = await import('/src/features/files/FileWorkspace.tsx');
    const { RichContent, contentText, fileReferencePart } = await import('/src/RichContent.tsx');
    const { turnOptions } = await import('/src/features/composer-input.ts');
    document.getElementById('root').style.display = 'none';
    const el = document.createElement('div');
    el.style.cssText =
      'min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)';
    document.body.append(el);
    if (font) {
      const style = document.createElement('style');
      style.textContent =
        "@font-face{font-family:RefTest;src:url('/__font')} :root{font-family:RefTest,sans-serif}";
      document.head.append(style);
    }
    window.refsCalls = [];
    window.sent = [];
    window.opened = [];
    window.failed = false;
    window.allow = true;
    const path = '/tmp/引用项目/中文 file[1].txt';
    const part = {
      type: 'text',
      text: path,
      text_elements: [
        {
          byteRange: { start: 0, end: new TextEncoder().encode(path).length },
          placeholder: '@中文 file[1].txt',
        },
      ],
    };
    window.checks = {
      hiddenPath: contentText([part]) === '',
      invalid:
        fileReferencePart({
          ...part,
          text_elements: [{ byteRange: { start: 0, end: path.length }, placeholder: '@wrong' }],
        }) === undefined,
    };
    const request = async (action, payload) => {
      window.refsCalls.push({ action, payload });
      if (action === 'files.list')
        return { entries: [{ name: '中文 file[1].txt', path: '中文 file[1].txt', kind: 'file' }] };
      if (action === 'files.readText')
        return { text: '真实文件预览接口在 Host 测试中验证。', size: 30 };
      if (action === 'files.reference') {
        if (window.failed) throw new Error('读取失败');
        return { projectId: 'p', name: '中文 file[1].txt', path: '中文 file[1].txt' };
      }
      throw new Error(action);
    };
    function Test() {
      const [draft, setDraft] = React.useState({
        text: '已有草稿',
        attachments: [],
        skills: [],
        mode: 'default',
        model: '',
        effort: '',
      });
      const [tick, refresh] = React.useState(0);
      window.setTestDraft = setDraft;
      window.refresh = () => refresh(tick + 1);
      window.draft = draft;
      const onReference = (ref) =>
        setDraft((old) => ({
          ...old,
          references: (old.references || []).some((v) => v.path === ref.path)
            ? old.references
            : [...(old.references || []), ref],
        }));
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'div',
          {
            style: {
              padding: '24px',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'end',
            },
          },
          React.createElement(RichContent, {
            entry: {
              item: {
                id: 'history',
                type: 'userMessage',
                content: [{ type: 'text', text: '已发送消息' }, part],
              },
            },
            sessionId: 's',
            onFile: (p) => window.opened.push(p),
          }),
          React.createElement(Composer, {
            draft,
            models: [],
            supports: () => true,
            disabled: false,
            busy: false,
            active: false,
            permission: 'workspace',
            onChange: (v) => setDraft((old) => ({ ...old, ...v })),
            onSend: () => window.sent.push(turnOptions(draft, 'workspace')),
            onStop: () => {},
            onPanel: () => {},
            onPermission: () => {},
            onNew: () => {},
          }),
        ),
        React.createElement(FileWorkspace, {
          request,
          projectId: 'p',
          projectName: '引用项目',
          storageKey: 'refs-test',
          visible: true,
          initialPath: '中文 file[1].txt',
          openToken: 1,
          imagePreview: false,
          gitRead: false,
          gitBranchCompare: false,
          referenceAllowed: window.allow,
          expanded: false,
          onExpand: () => {},
          onClose: () => {},
          onReference,
        }),
      );
    }
    createRoot(el).render(React.createElement(Test));
    if (font) await document.fonts.load('14px RefTest');
  }, !!process.env.COMPOSER_TEST_FONT);
  const quote = page.getByRole('button', { name: /^(引用文件|升级 Host 后可添加文件引用)$/ });
  await quote.click();
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  assert.equal(await editor.inputValue(), '已有草稿');
  await page.getByRole('button', { name: '移除引用 中文 file[1].txt', exact: true }).waitFor();
  await quote.click();
  assert.equal(await page.evaluate(() => window.draft.references.length), 1);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.sent[0].references), [
    { projectId: 'p', path: '中文 file[1].txt' },
  ]);
  assert.equal(await page.evaluate(() => window.sent[0].text), '已有草稿');
  assert.deepEqual(await page.evaluate(() => window.checks), { hiddenPath: true, invalid: true });
  await page.locator('.file-references button').click();
  assert.equal(await page.evaluate(() => window.opened[0]), '/tmp/引用项目/中文 file[1].txt');
  await page.screenshot({ path: fileURLToPath(new URL('desktop.png', out)) });
  await editor.fill('');
  assert(await page.getByRole('button', { name: '发送', exact: true }).isEnabled());
  await page.getByRole('button', { name: '发送', exact: true }).click();
  assert.equal(await page.evaluate(() => window.sent[1].text), '');
  await page.getByRole('button', { name: '移除引用 中文 file[1].txt', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).count(), 0);
  await page.getByRole('button', { name: '语音输入', exact: true }).waitFor();
  await page.evaluate(() => {
    window.allow = false;
    window.refresh();
  });
  assert(await quote.isDisabled());
  assert.match(await quote.getAttribute('title'), /升级 Host/);
  await page.evaluate(() => {
    window.allow = true;
    window.failed = true;
    window.refresh();
  });
  await quote.click();
  await page.getByText('Error: 读取失败', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.draft.references.length), 0);
  await page.evaluate(() => {
    window.failed = false;
  });
  await quote.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.body.lastElementChild.style.gridTemplateColumns = 'minmax(0,1fr)';
    document.querySelector('.file-workspace')?.remove();
  });
  await page.screenshot({ path: fileURLToPath(new URL('mobile.png', out)) });
  const box = await page.locator('.composer-resources .file-reference-chip').boundingBox();
  assert(box.x >= 0 && box.x + box.width <= 390);
  assert.deepEqual(errors, []);
  console.log(
    'File references: card/removal, draft preservation, deduplication, structured payload, reference-only send, native history markers, open-file, old Host, error retention and 390px bounds passed',
  );
} finally {
  await browser.close();
}

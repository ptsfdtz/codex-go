/* global window, document, Event */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/selection-quote/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => route.abort());
  const font = process.env.SELECTION_QUOTE_TEST_FONT;
  if (font) await page.route('**/__test-font', (route) => route.fulfill({ path: font }));
  await page.goto(process.env.SELECTION_QUOTE_TEST_ORIGIN || 'http://127.0.0.1:1491/');
  await page.evaluate(async (font) => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { SelectionQuote, appendQuote } = await import('/src/features/SelectionQuote.tsx');
    document.getElementById('root').style.display = 'none';
    const element = document.createElement('div');
    document.body.append(element);
    const style = document.createElement('style');
    style.textContent =
      (font
        ? "@font-face{font-family:QuoteTest;src:url('/__test-font')} :root{font-family:QuoteTest,sans-serif}"
        : '') +
      '.quote-test{padding:70px 20px}.quote-test table{width:100%;margin:20px 0}.quote-test textarea{width:100%;min-height:140px;margin-top:40px}';
    document.head.append(style);
    document.documentElement.dataset.theme = 'dark';
    window.quoteCalls = 0;
    window.changeContext = undefined;
    function Test() {
      const container = React.useRef(null);
      const [draft, setDraft] = React.useState('已有草稿');
      const [context, setContext] = React.useState('one');
      window.changeContext = setContext;
      return React.createElement(
        'div',
        { ref: container, className: 'quote-test' },
        React.createElement(
          'div',
          { className: 'timeline-content' },
          React.createElement(
            'article',
            { className: 'message-content' },
            React.createElement('p', { id: 'text' }, '请选择这段消息，然后添加到对话。'),
            React.createElement(
              'table',
              null,
              React.createElement(
                'tbody',
                null,
                React.createElement(
                  'tr',
                  null,
                  React.createElement('td', { id: 'first' }, 'Windows 原版桌面共享'),
                  React.createElement('td', { id: 'last' }, '已实现，需要实机验证'),
                ),
              ),
            ),
          ),
          React.createElement('textarea', { id: 'ignored', defaultValue: '编辑中的文字' }),
        ),
        React.createElement('textarea', {
          'aria-label': '消息',
          value: draft,
          onChange: (e) => setDraft(e.target.value),
        }),
        React.createElement(SelectionQuote, {
          key: context,
          container,
          onQuote: (text) => {
            window.quoteCalls++;
            setDraft((d) => appendQuote(d, text));
            document.querySelector('textarea[aria-label="消息"]').focus();
          },
        }),
      );
    }
    (dom.default || dom).createRoot(element).render(React.createElement(Test));
    if (font) {
      await document.fonts.load('14px QuoteTest');
      await document.fonts.ready;
    }
  }, !!font);
  async function select(first, last = first) {
    return page.evaluate(
      ({ first, last }) => {
        document.activeElement?.blur();
        const range = document.createRange();
        range.setStart(document.querySelector(first).firstChild, 0);
        const node = document.querySelector(last).firstChild;
        range.setEnd(node, node.textContent.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString().trim();
      },
      { first, last },
    );
  }
  const selected = await select('#first', '#last');
  const button = page.getByRole('button', { name: '添加到对话', exact: true });
  await button.waitFor();
  const rect = await button.boundingBox();
  assert(rect.x >= 0 && rect.x + rect.width <= 390);
  await page.screenshot({ path: new URL('mobile-selected.png', out).pathname });
  await button.click();
  const draft = await page.getByLabel('消息', { exact: true }).inputValue();
  assert(draft.startsWith('已有草稿\n\n> '));
  assert(draft.includes(selected));
  assert(draft.endsWith('\n\n'));
  assert.equal(await page.evaluate(() => window.quoteCalls), 1);
  await button.waitFor({ state: 'hidden' });
  await page.screenshot({ path: new URL('mobile-added.png', out).pathname });
  await select('#text');
  await button.waitFor();
  await page.keyboard.press('Escape');
  await button.waitFor({ state: 'hidden' });
  await page.getByLabel('消息', { exact: true }).selectText();
  await page.waitForTimeout(150);
  assert.equal(await button.count(), 0);
  await page.locator('#ignored').selectText();
  await page.waitForTimeout(150);
  assert.equal(await button.count(), 0);
  await select('#text');
  await button.waitFor();
  await page.evaluate(() => window.changeContext('two'));
  await button.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.waitForTimeout(200);
  await select('#text');
  await button.waitFor();
  await page.screenshot({ path: new URL('desktop-selected.png', out).pathname });
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await button.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log(
    'Selection quote: table text, draft preservation, single insertion, Escape, input exclusion, context change, scrolling and mobile bounds passed',
  );
} finally {
  await browser.close();
}

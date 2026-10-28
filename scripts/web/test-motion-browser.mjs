/* global window, document, getComputedStyle */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  await page.route('**/api/**', (route) => route.abort());
  await page.goto(process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1430');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { FileWorkspace } = await import('/src/features/files/FileWorkspace.tsx');
    const { MotionList, Collapse } = await import('/src/motion.tsx');
    const { ModeSwitcher } = await import('/src/features/ModeSwitcher.tsx');
    const { deferred } = await import('/src/deferred.tsx');
    document.getElementById('root').style.display = 'none';
    const target = document.createElement('div');
    document.body.append(target);
    const root = (dom.default || dom).createRoot(target);
    let attempts = 0;
    const Recoverable = deferred(async () => {
      if (!attempts++) throw new Error('controlled chunk failure');
      return { default: () => React.createElement('div', null, '模块重试成功') };
    });
    const request = async (action) => {
      if (action === 'files.list')
        return { entries: [{ name: 'one.txt', path: 'one.txt', kind: 'file' }] };
      if (action === 'files.readText') return { text: 'Stable preview', size: 14 };
      throw new Error(action);
    };
    function Example() {
      const [open, setOpen] = React.useState(true);
      const [fold, setFold] = React.useState(true);
      const [reverse, setReverse] = React.useState(false);
      const [retry, setRetry] = React.useState(false);
      window.setPane = setOpen;
      window.setFold = setFold;
      window.reverseList = () => setReverse((value) => !value);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(ModeSwitcher, { mode: 'codex', onChange: () => {} }),
        React.createElement('button', { onClick: () => setRetry(true) }, '测试模块失败'),
        retry && React.createElement(Recoverable),
        React.createElement(
          'div',
          {
            className: `conversation-layout ${open ? 'with-file-workspace' : ''}`,
            style: { height: 420, width: '100%' },
          },
          React.createElement(
            'section',
            { className: 'conversation' },
            React.createElement('input', { defaultValue: '保留的草稿', 'aria-label': '草稿' }),
          ),
          React.createElement(FileWorkspace, {
            request,
            projectId: 'p',
            projectName: '项目',
            storageKey: 'motion-test',
            visible: open,
            initialPath: 'one.txt',
            imagePreview: false,
            gitRead: false,
            gitBranchCompare: false,
            referenceAllowed: false,
            expanded: false,
            onExpand: () => {},
            onClose: () => setOpen(false),
            onReference: () => {},
          }),
        ),
        React.createElement(
          Collapse,
          { open: fold },
          React.createElement('button', null, '折叠内容'),
        ),
        React.createElement(
          MotionList,
          { className: 'motion-test-list' },
          (reverse ? ['c', 'b', 'a'] : ['a', 'b', 'c']).map((key) =>
            React.createElement(
              'div',
              { key, 'data-motion-item': true, style: { height: 30 } },
              key,
            ),
          ),
        ),
      );
    }
    root.render(React.createElement(Example));
  });
  await page.getByText('Stable preview', { exact: true }).waitFor();
  const pane = page.getByRole('complementary', { name: '项目文件工作区' });
  const width = (await pane.boundingBox()).width;
  await page.evaluate(() => window.setPane(false));
  await page.waitForTimeout(70);
  const closingWidth = await page
    .locator('.file-workspace')
    .evaluate((node) => node.getBoundingClientRect().width);
  assert(closingWidth > 0 && closingWidth < width, 'Panel close interpolates width');
  await page.evaluate(() => window.setPane(true));
  await page.waitForTimeout(350);
  assert(Math.abs((await pane.boundingBox()).width - width) < 1);
  assert.equal(await page.getByRole('textbox', { name: '草稿' }).inputValue(), '保留的草稿');
  await page.evaluate(() => window.setPane(false));
  await page.waitForTimeout(350);
  assert.equal(
    await page.locator('.file-workspace').evaluate((node) => node.getBoundingClientRect().width),
    0,
  );
  assert.equal(await page.locator('.file-workspace').getAttribute('inert'), '');
  await page.evaluate(() => window.setFold(false));
  await page.waitForTimeout(60);
  await page.evaluate(() => window.setFold(true));
  await page.waitForTimeout(250);
  assert(await page.getByRole('button', { name: '折叠内容' }).isVisible());
  await page.evaluate(() => window.reverseList());
  await page.waitForTimeout(40);
  await page.evaluate(() => window.reverseList());
  await page.waitForTimeout(250);
  assert.deepEqual(await page.locator('.motion-test-list > div').allTextContents(), [
    'a',
    'b',
    'c',
  ]);
  assert.equal(
    await page
      .locator('.motion-test-list')
      .evaluate((node) => node.getAnimations({ subtree: true }).length),
    0,
  );
  await page.getByRole('button', { name: '切换工作模式' }).click();
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator('.mode-menu').evaluate((node) => getComputedStyle(node).opacity),
    '1',
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator('.mode-menu').evaluate((node) => node.matches(':popover-open')),
    false,
  );
  await page.getByRole('button', { name: '测试模块失败' }).click();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByText('模块重试成功').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.setPane(true));
  await page.waitForTimeout(120);
  assert.equal(
    await pane.evaluate((node) => getComputedStyle(node).transitionProperty.includes('width')),
    false,
  );
  await page.setViewportSize({ width: 390, height: 740 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(errors, []);
  console.log(
    'PASS: reversible file panel, preserved draft, collapse/list interruption, native popover, failed module retry, reduced motion and mobile bounds.',
  );
} finally {
  await browser.close();
}

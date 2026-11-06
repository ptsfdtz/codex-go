/* global window, document, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/send-motion/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const checks = [],
  errors = [];
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1100, height: 850 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', (route) => route.abort());
  await page.goto(process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1497/');
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Composer } = await import('/src/features/Composer.tsx');
    const { TurnChanges } = await import('/src/features/TurnChanges.tsx');
    document.getElementById('root').style.display = 'none';
    const mount = document.createElement('div');
    mount.style = 'height:100dvh;display:flex;flex-direction:column;justify-content:flex-end';
    document.body.append(mount);
    const root = (dom.default || dom).createRoot(mount);
    window.draft = {
      text: '',
      attachments: [],
      skills: [],
      mode: 'default',
      model: '',
      effort: '',
    };
    window.busy = false;
    window.feedback = '';
    window.context = 1;
    window.sends = 0;
    window.render = () =>
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(TurnChanges, {
            entries: [
              {
                turnId: 'turn-test',
                item: {
                  id: 'change',
                  type: 'fileChange',
                  status: 'completed',
                  changes: [
                    { path: 'src/first.ts', diff: '@@ -1 +1 @@\n-old\n+new' },
                    { path: 'README.md', diff: '@@ -1 +1 @@\n-before\n+after' },
                  ],
                },
              },
            ],
          }),
          React.createElement(Composer, {
            key: window.context,
            draft: window.draft,
            models: [],
            supports: () => false,
            disabled: false,
            busy: window.busy,
            active: false,
            permission: 'workspace',
            feedback: window.feedback,
            onChange: (change) => {
              window.draft = { ...window.draft, ...change };
              window.render();
            },
            onSend: () => {
              window.sends++;
              window.busy = true;
              window.feedback = '';
              window.render();
            },
            onStop: () => {},
            onPanel: () => {},
            onNew: () => {},
            onPermission: () => {},
          }),
        ),
      );
    window.finish = (success) => {
      window.busy = false;
      if (success)
        window.draft = { ...window.draft, text: '', attachments: [], skills: [], references: [] };
      else window.feedback = '发送结果未知，请核对后再操作。';
      window.render();
    };
    window.render();
  });
  await page.waitForTimeout(500);
  if (errors.length) throw new Error(JSON.stringify(errors));
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  const send = () => page.getByRole('button', { name: '发送', exact: true });
  await input.fill('第一行\n第二行\n第三行\n第四行');
  await page.waitForTimeout(100);
  const before = await input.boundingBox();
  await send().click();
  assert.equal(await input.inputValue(), '第一行\n第二行\n第三行\n第四行');
  assert.equal(await page.locator('.composer-send-flight').count(), 0);
  await page.evaluate(() => window.finish(true));
  await page.locator('.composer-send-flight').waitFor();
  assert.equal(await page.locator('.composer-send-flight').getAttribute('aria-hidden'), 'true');
  await page.screenshot({ path: fileURLToPath(new URL('send-midflight.png', out)) });
  await page.locator('.composer-send-flight').waitFor({ state: 'detached' });
  assert.equal(await input.inputValue(), '');
  assert(
    (await input.boundingBox()).height < before.height,
    JSON.stringify({
      before,
      after: await input.boundingBox(),
      style: await input.getAttribute('style'),
    }),
  );
  checks.push(
    'successful draft consumption lifts text and collapses multiline input without delaying submission',
  );
  await input.fill('失败时保留的内容');
  await input.press('Enter');
  await page.evaluate(() => window.finish(false));
  assert.equal(await input.inputValue(), '失败时保留的内容');
  assert.equal(await page.locator('.composer-send-flight').count(), 0);
  checks.push(
    'Enter follows the same path; unknown result retains draft and never animates completion',
  );
  await page.evaluate(() => {
    window.feedback = '';
    window.render();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await send().click();
  await page.evaluate(() => window.finish(true));
  await page.waitForTimeout(70);
  assert.equal(await page.locator('.composer-send-flight').count(), 0);
  assert.equal(await input.inputValue(), '');
  checks.push('reduced motion skips flight and height animations');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await input.fill('切换后不能留下动画');
  await send().click();
  await page.evaluate(() => window.finish(true));
  await page.locator('.composer-send-flight').waitFor();
  await page.evaluate(() => {
    window.context++;
    window.render();
  });
  await page.locator('.composer-send-flight').waitFor({ state: 'detached' });
  checks.push('switching composer identity cleans up overlays and running animations');
  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill('手机发送动画\n第二行');
  await send().click();
  await page.evaluate(() => window.finish(true));
  await page.locator('.composer-send-flight').waitFor();
  const flightBox = await page.locator('.composer-send-flight').boundingBox();
  assert(flightBox.x >= 0 && flightBox.x + flightBox.width <= 390);
  await page.locator('.composer-send-flight').waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  );
  checks.push('390px sending keeps the transient text within the viewport');
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.getByRole('button', { name: '查看改动', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: '改动文件', exact: true });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    await tabs.getByRole('tab').nth(1).click();
    await page.waitForTimeout(220);
    const selected = tabs.getByRole('tab', { selected: true });
    const style = await selected.evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopWidth, background: s.backgroundColor, outline: s.outlineStyle };
    });
    assert.equal(style.border, '0px');
    assert.equal(style.outline, 'none');
    assert.notEqual(style.background, 'rgb(255, 255, 255)');
    assert.notEqual(style.background, 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: fileURLToPath(new URL(`changes-${theme}.png`, out)) });
  }
  await tabs.getByRole('tab', { selected: true }).press('ArrowLeft');
  assert.equal(await tabs.getByRole('tab').first().getAttribute('aria-selected'), 'true');
  checks.push(
    'change tabs use subtle theme-aware background without borders; keyboard selection remains functional',
  );
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => window.sends), 5);
  await writeFile(
    new URL('verification.json', out),
    JSON.stringify({ checks, errors, realHost: false }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}

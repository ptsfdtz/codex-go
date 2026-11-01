import { fileURLToPath } from 'node:url';
/* global window, document */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/activity-stages/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1100, height: 720 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => route.abort());
  if (process.env.COMPOSER_TEST_FONT)
    await page.route('**/__font', (route) =>
      route.fulfill({ path: process.env.COMPOSER_TEST_FONT }),
    );
  await page.goto(process.env.ACTIVITY_TEST_ORIGIN || 'http://127.0.0.1:1430');
  const grouping = await page.evaluate(async (font) => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { ActivityStages, activityStages } = await import(
      '/src/features/activity/ActivityStages.tsx'
    );
    const { RichContent } = await import('/src/RichContent.tsx');
    document.getElementById('root').style.display = 'none';
    const el = document.createElement('main');
    el.className = 'timeline-content';
    el.style.cssText = 'min-height:100vh;max-width:850px';
    document.body.append(el);
    if (font) {
      const style = document.createElement('style');
      style.textContent =
        "@font-face{font-family:ActivityTest;src:url('/__font')} body{font-family:ActivityTest,sans-serif}";
      document.head.append(style);
    }
    const entry = (id, type, text, turnId = 't1') => ({ turnId, item: { id, type, text } });
    const first = entry(
      'intro',
      'agentMessage',
      '我会先检查消息列表的布局，再验证桌面和手机上的显示效果。',
    );
    const thinking = entry('think', 'reasoning', '检查已有组件，保留正文和计划的显示。');
    const commands = Array.from({ length: 7 }, (_, i) => ({
      turnId: 't1',
      item: {
        id: 'command' + i,
        type: 'commandExecution',
        command: [
          'rg -n "activity-turn" web/src',
          'pnpm --filter @agentdeck/web check',
          'pnpm exec eslint web/src/App.tsx',
        ][i % 3],
        status: 'completed',
        aggregatedOutput: '验证完成',
        exitCode: 0,
      },
    }));
    const phase = [first, thinking, ...commands];
    const next = entry('update', 'agentMessage', '布局已调整完成，接下来检查窄屏和折叠交互。');
    window.activityEntries = phase;
    const root = (dom.createRoot || dom.default.createRoot)(el);
    window.renderActivity = (entries, activeTurn) =>
      root.render(
        React.createElement(ActivityStages, { entries, activeTurn }, (item) =>
          React.createElement(
            'article',
            {
              key: item.item.id,
              className:
                'turn ' +
                (['agentMessage', 'userMessage'].includes(item.item.type)
                  ? 'assistant-turn'
                  : 'activity-turn'),
              'data-history-key': JSON.stringify([item.turnId, item.item.id]),
            },
            React.createElement(
              'div',
              { className: 'message-content' },
              React.createElement(RichContent, { entry: item, sessionId: 'test' }),
            ),
          ),
        ),
      );
    window.nextActivity = next;
    window.renderActivity(phase, 't1');
    return {
      split: activityStages(
        [...phase, next, entry('other', 'commandExecution', '', 't2')],
        't2',
      ).map((s) => [s.activity, s.active, s.indices.length]),
      empty: activityStages([entry('empty', 'reasoning', '')]).length,
    };
  }, !!process.env.COMPOSER_TEST_FONT);
  assert.deepEqual(grouping.split, [
    [false, false, 1],
    [true, false, 8],
    [false, false, 1],
    [true, true, 1],
  ]);
  assert.equal(grouping.empty, 0);
  const stage = page.locator('.activity-stage').first();
  await stage.waitFor();
  assert.equal(await stage.getAttribute('open'), '');
  assert.equal(await stage.locator('.tool-record').count(), 8);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: fileURLToPath(new URL('desktop-running.png', out)) });
  // A new assistant update ends a stage even while the task keeps running.
  await page.evaluate(() =>
    window.renderActivity([...window.activityEntries, window.nextActivity], 't1'),
  );
  await page.waitForFunction(() => !document.querySelector('.activity-stage').open);
  await stage.locator('.tool-record').first().waitFor({ state: 'hidden' });
  await page.screenshot({ path: fileURLToPath(new URL('desktop-collapsed.png', out)) });
  // Native disclosure supports keyboard and keeps manual expansion across updates.
  await stage.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.activity-stage').open);
  await page.evaluate(() =>
    window.renderActivity([...window.activityEntries, window.nextActivity], 't1'),
  );
  assert.equal(await stage.evaluate((el) => el.open), true);
  await page.evaluate(() => window.renderActivity(window.activityEntries, 't1'));
  await page.evaluate(() => window.renderActivity(window.activityEntries, undefined));
  await page.waitForFunction(() => !document.querySelector('.activity-stage').open);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 720 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.screenshot({ path: fileURLToPath(new URL(`mobile-${width}.png`, out)) });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.screenshot({ path: fileURLToPath(new URL('mobile-dark.png', out)) });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: phase boundaries, turn isolation, empty reasoning, running/completed disclosure, keyboard, manual expansion, 320/390px; screenshots:',
    out.pathname,
  );
} finally {
  await browser.close();
}

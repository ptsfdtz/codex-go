// Controlled file changes exercise the real preview without contacting a model.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startConversationServer } from './conversation-server.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const directory = resolve('artifacts/web-diff');
mkdirSync(directory, { recursive: true });
const { vite, state, origin } = await startConversationServer({
  cacheDir: resolve('.tmp/web-diff'),
});
state.extra = [
  {
    turnId: 'native-turn',
    item: {
      id: 'diff-width-check',
      type: 'fileChange',
      status: 'completed',
      changes: [
        {
          path: 'src/long.ts',
          diff: [
            '@@ -1 +1 @@',
            '-short',
            '+' + 'long line '.repeat(60) + 'END_OF_LONG_LINE',
            ...Array.from({ length: 100 }, (_, i) => '+short line ' + i),
            '+END_OF_DIFF',
          ].join('\n'),
        },
        { path: 'src/other.ts', diff: '@@ -1 +1 @@\n-old\n+other file' },
      ],
    },
  },
];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
  const page = await browser.newPage();
  for (const width of [1200, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(origin);
    await page.getByRole('button', { name: 'View changes', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '改动预览' });
    await dialog.waitFor();
    const diff = dialog.locator('.diff-text');
    await diff.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
      node.scrollTop = node.scrollHeight;
    });
    const result = await diff.evaluate((node) => {
      const rows = [...node.querySelectorAll('.diff-lines > span')];
      const content = node.querySelector('.diff-lines');
      return {
        scrollLeft: node.scrollLeft,
        overflowing: node.scrollWidth > node.clientWidth,
        allRowsFillContent: rows.every(
          (row) =>
            Math.abs(row.getBoundingClientRect().width - content.getBoundingClientRect().width) < 1,
        ),
        reachesBottom: Math.abs(node.scrollHeight - node.scrollTop - node.clientHeight) < 2,
        complete:
          node.textContent.includes('END_OF_LONG_LINE') &&
          rows.at(-1).textContent.includes('END_OF_DIFF'),
      };
    });
    assert.ok(result.overflowing && result.scrollLeft > 0, 'exercise horizontal overflow');
    assert.ok(result.allRowsFillContent, 'all line backgrounds span the longest line');
    assert.ok(result.reachesBottom && result.complete, 'the end of the diff remains reachable');
    await page.screenshot({ path: resolve(directory, `full-width-${width}.png`) });
    await dialog.getByRole('tab').first().press('ArrowRight');
    await dialog.getByRole('tabpanel').getByText('+other file', { exact: false }).waitFor();
    assert.equal(
      await diff.evaluate((node) => node.scrollLeft),
      0,
      'file switch resets horizontal scroll',
    );
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  console.log(
    'Diff preview passed: full-width short/long row backgrounds, complete scrollable content and file switching at desktop/mobile sizes.',
  );
} finally {
  await browser?.close();
  await vite.close();
}

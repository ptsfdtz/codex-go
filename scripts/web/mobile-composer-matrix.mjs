/* global window, document, Event */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function mobileComposerMatrix(page, main, out) {
  const results = [];
  const editor = main.getByRole('textbox', { name: '消息', exact: true });
  const add = main.getByRole('button', { name: '添加附件和操作', exact: true });
  const menu = page.locator('.composer-menu:popover-open');
  const inspect = async (label) => {
    const state = await main.locator('.composer').evaluate((node) => {
      const view = window.visualViewport;
      const box = node.getBoundingClientRect();
      const buttons = [...node.querySelectorAll('.composer-toolbar button')]
        .filter((button) => button.getClientRects().length && !button.closest('[popover]'))
        .map((button) => {
          const b = button.getBoundingClientRect();
          return {
            label: button.getAttribute('aria-label'),
            width: b.width,
            height: b.height,
            hit: [
              [b.x + 2, b.y + b.height / 2],
              [b.right - 2, b.y + b.height / 2],
              [b.x + b.width / 2, b.y + 2],
              [b.x + b.width / 2, b.bottom - 2],
            ].every(([x, y]) => button.contains(document.elementFromPoint(x, y))),
          };
        });
      return {
        layout: Array.from(node.closest('.conversation').children).map((n) => ({
          class: n.className,
          box: n.getBoundingClientRect().toJSON(),
        })),
        box: box.toJSON(),
        buttons,
        viewport: { top: view.offsetTop, height: view.height, width: view.width },
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        visibleSpeechError: !!node.querySelector('.speech-error'),
        compact: node.classList.contains('is-compact'),
      };
    });
    assert(!state.overflow && !state.visibleSpeechError, `${label}: overflow/error row`);
    assert(
      state.box.x >= -1 &&
        state.box.right <= state.viewport.width + 1 &&
        state.box.y >= state.viewport.top - 1 &&
        state.box.bottom <= state.viewport.top + state.viewport.height + 1,
      `${label}: composer outside viewport ${JSON.stringify(state)}`,
    );
    for (const button of state.buttons) {
      assert(
        button.width >= 44 && button.height >= 44 && button.hit,
        `${label}: ${JSON.stringify(button)}`,
      );
    }
    return state;
  };
  const inspectMenu = async (label) => {
    const box = await menu.boundingBox();
    const view = await page.evaluate(() => ({
      top: window.visualViewport.offsetTop,
      width: window.visualViewport.width,
      height: window.visualViewport.height,
    }));
    assert(
      box.x >= 0 &&
        box.x + box.width <= view.width + 1 &&
        box.y >= view.top - 1 &&
        box.y + box.height <= view.top + view.height + 1,
      `${label}: menu clipped ${JSON.stringify({ box, view })}`,
    );
  };
  const running = async (value) => {
    await page.evaluate((value) => {
      window.testSnapshot.turns = value
        ? [{ sessionId: 'main', turnId: 'matrix', status: 'running' }]
        : [];
      const packet = {
        type: 'event',
        sessionId: 'main',
        turnId: 'matrix',
        action: value ? 'upstream.progress' : 'turn.completed',
        payload: value ? { method: 'turn/started', turnId: 'matrix' } : {},
      };
      window.referenceBridge.events.forEach((handler) => handler(packet));
    }, value);
    await main.getByRole('button', { name: value ? '停止' : '发送', exact: true }).waitFor();
  };
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const width of [320, 360, 375, 390, 414, 430]) {
      for (const height of [844, 480, 320]) {
        const label = `${theme} ${width}x${height}`;
        await page.setViewportSize({ width, height });
        await editor.fill('');
        await page.touchscreen.tap(2, 80);
        await main.locator('.composer.is-compact').waitFor();
        const compact = await inspect(label + ' compact');
        assert(compact.box.height <= 50, `${label}: compact composer must stay one line`);
        for (let cycle = 0; cycle < 2; cycle++) {
          await add.tap();
          await menu.waitFor();
          await inspectMenu(label + ' actions');
          assert((await menu.locator(':scope > button').count()) <= 7);
          await page.keyboard.press('Escape');
        }
        await editor.tap();
        await page.keyboard.insertText('中文与 emoji 🙂，取消权限后继续编辑');
        const before = await inspect(label + ' editing');
        for (let cycle = 0; cycle < 2; cycle++) {
          await main.getByRole('button', { name: '语音输入', exact: true }).tap();
          await page.waitForFunction(() =>
            document
              .querySelector('.composer-speech-status')
              ?.textContent.includes('请允许麦克风权限'),
          );
          const denied = await inspect(label + ' denied');
          assert(
            Math.abs(before.box.height - denied.box.height) <= 1,
            `${label}: denial changed input height`,
          );
          await add.tap();
          await menu.waitFor();
          await inspectMenu(label + ' denied menu');
          await page.keyboard.press('Escape');
          await editor.tap();
          await page.keyboard.insertText('✓');
        }
        await add.tap();
        await menu.getByRole('menuitemcheckbox', { name: '方案模式', exact: true }).tap();
        await main.locator('.resource-chip.mode-chip').waitFor();
        await inspect(label + ' plan');
        await main.locator('.resource-chip.mode-chip').tap();
        await main.getByRole('button', { name: '执行权限：工作区权限', exact: true }).tap();
        const permission = page.getByRole('dialog', {
          name: '应如何批准 Codex 操作？',
          exact: true,
        });
        await permission.waitFor();
        await page.waitForFunction(() => {
          const node = document.querySelector('.permission-sheet[open]');
          if (!node) return false;
          const box = node.getBoundingClientRect();
          return box.y >= 0 && box.bottom <= window.innerHeight + 1;
        });
        const p = await permission.boundingBox();
        assert(p.y >= 0 && p.y + p.height <= height + 1, `${label}: permission sheet clipped`);
        await page.keyboard.press('Escape');
        await permission.waitFor({ state: 'hidden' });
        await main.getByRole('button', { name: '切换模型', exact: true }).tap();
        await page.locator('.model-picker-popup:popover-open').waitFor();
        const m = await page.locator('.model-picker-popup:popover-open').boundingBox();
        assert(
          m.y >= 0 && m.y + m.height <= height + 1 && m.x >= 0 && m.x + m.width <= width + 1,
          `${label}: model clipped`,
        );
        await page.keyboard.press('Escape');
        await running(true);
        const active = await inspect(label + ' queued controls');
        assert(
          active.buttons.some((b) => b.label === '加入队列') &&
            active.buttons.some((b) => b.label === '停止'),
        );
        await running(false);
        await editor.tap();
        await inspect(label + ' focused');
        await editor.fill('多行输入与滚动检查\n'.repeat(25));
        await inspect(label + ' multiline');
        if (width === 390 && height === 844) {
          await editor.fill('');
          await main
            .locator('.composer')
            .screenshot({ path: fileURLToPath(new URL(`rebuilt-composer-${theme}.png`, out)) });
        }
        results.push({
          theme,
          width,
          height,
          compactHeight: compact.box.height,
          states: 8,
          menuCycles: 4,
          denials: 2,
          passed: true,
        });
      }
    }
  }
  // Exercise iOS-style panning independently of a layout viewport resize.
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.fill('键盘上方继续输入');
  for (const height of [480, 360, 480]) {
    await editor.focus();
    await page.evaluate((height) => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: height });
      Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: 24 });
      window.visualViewport.dispatchEvent(new Event('resize'));
      window.visualViewport.dispatchEvent(new Event('scroll'));
    }, height);
    await inspect(`keyboard ${height}`);
    await add.tap();
    await menu.waitFor();
    await inspectMenu(`keyboard menu ${height}`);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => {
    delete window.visualViewport.height;
    delete window.visualViewport.offsetTop;
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await editor.fill('');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await writeFile(
    new URL('mobile-matrix.json', out),
    JSON.stringify(
      {
        cases: results.length,
        states: results.length * 8,
        denials: results.length * 2,
        menuCycles: results.length * 4,
        results,
      },
      null,
      2,
    ),
  );
  return `Mobile matrix: ${results.length} layouts, ${results.length * 8} states, ${results.length * 2} permission denials and ${results.length * 4} menu cycles; keyboard panning and normal motion`;
}

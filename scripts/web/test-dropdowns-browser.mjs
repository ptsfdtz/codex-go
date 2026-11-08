import { fileURLToPath } from 'node:url';
/* global window, document, FormData, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/dropdowns/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const checks = [];
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1100, height: 850 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => route.abort());
  if (process.env.COMPOSER_TEST_FONT)
    await page.route('**/__dropdown-font', (route) =>
      route.fulfill({ path: process.env.COMPOSER_TEST_FONT }),
    );
  await page.goto(process.env.DROPDOWN_TEST_ORIGIN || 'http://127.0.0.1:1434/');
  await page.evaluate(async (font) => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Select } = await import('/src/components/Select.tsx');
    const { Modal } = await import('/src/ui.tsx');
    const { BranchComparison } = await import('/src/features/files/BranchComparison.tsx');
    const { ModeSwitcher } = await import('/src/features/ModeSwitcher.tsx');
    const { ModelPicker } = await import('/src/features/ModelPicker.tsx');
    const { PermissionPicker } = await import('/src/features/PermissionPicker.tsx');
    document.getElementById('root').style.display = 'none';
    const el = document.createElement('main');
    el.id = 'dropdown-test';
    el.style.cssText = 'max-width:940px;padding:24px;margin:auto;display:grid;gap:24px';
    document.body.append(el);
    if (font) {
      const style = document.createElement('style');
      style.textContent =
        "@font-face{font-family:DropdownTest;src:url('/__dropdown-font')} :root{font-family:DropdownTest,sans-serif}";
      document.head.append(style);
    }
    window.selectChanges = [];
    window.submits = 0;
    window.branchCalls = [];
    const h = React.createElement;
    const branches = [
      'refs/heads/deploy/agentchat-local-20261028',
      'refs/heads/main',
      'refs/heads/release',
      'refs/remotes/origin/feat/macos-host-support',
      'refs/remotes/origin/feat/macos-release',
      'refs/remotes/origin/main',
      'refs/remotes/origin/release',
      ...Array.from(
        { length: 24 },
        (_, i) => `refs/heads/feature/long-branch-${i}-with-a-very-long-name-中文分支名称`,
      ),
    ];
    const request = async (action, payload) => {
      window.branchCalls.push({ action, ...payload });
      if (action === 'git.branches')
        return {
          branches: branches.map((name) => ({ name, commit: 'abc' })),
          current: 'refs/heads/main',
          truncated: false,
        };
      if (action === 'git.compare')
        return { base: payload.base, head: payload.head, files: [], truncated: false };
      throw new Error(action);
    };
    function Test() {
      const [value, setValue] = React.useState('a');
      const [disabled, setDisabled] = React.useState(false);
      const [modal, setModal] = React.useState(false);
      const [mode, setMode] = React.useState('codex');
      const [permission, setPermission] = React.useState('workspace');
      const [draft, setDraft] = React.useState({ model: 'model-a', effort: '' });
      window.setSelectDisabled = setDisabled;
      const basic = h(
        Select,
        {
          'aria-label': '测试选择',
          value,
          disabled,
          name: 'choice',
          onValueChange: (next) => {
            window.selectChanges.push(next);
            setValue(next);
          },
        },
        h('option', { value: 'a' }, 'Alpha'),
        h('option', { value: 'disabled', disabled: true }, '禁用选项'),
        h('option', { value: 'b' }, 'Beta'),
        h('option', { value: 'c' }, '中文选项'),
        h(
          'optgroup',
          { label: '禁用分组', disabled: true },
          h('option', { value: 'group-disabled' }, '不可选分组'),
        ),
      );
      return h(
        React.Fragment,
        null,
        h(
          'form',
          {
            id: 'select-form',
            style: { display: 'grid', gap: 12, maxWidth: 320 },
            onSubmit: (e) => {
              e.preventDefault();
              window.submits++;
            },
          },
          h('label', null, '基础选择', basic),
          h('button', { type: 'button', onClick: () => setModal(true) }, '打开选择弹窗'),
          h('button', { type: 'submit' }, '提交表单'),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 16, alignItems: 'center' } },
          h(ModeSwitcher, { mode, onChange: setMode }),
          h(ModelPicker, {
            draft,
            disabled: false,
            allowDefault: true,
            allowResponseSpeed: true,
            onChange: (change) => setDraft((old) => ({ ...old, ...change })),
            models: ['a', 'b', 'c'].map((id) => ({
              id: `model-${id}`,
              displayName: `Model ${id.toUpperCase()}`,
              fastServiceTier: 'fast',
              supportedReasoningEfforts: ['low', 'medium', 'high'],
            })),
          }),
          h(PermissionPicker, { permission, disabled: false, onConfirm: setPermission }),
        ),
        h(
          'section',
          { className: 'branch-comparison', style: { minHeight: 280 } },
          h(BranchComparison, { request, projectId: 'dropdown-project', supported: true }),
        ),
        h('button', { type: 'button', id: 'outside' }, '菜单外部'),
        modal &&
          h(
            Modal,
            { title: '选择弹窗', onClose: () => setModal(false) },
            h(
              'label',
              null,
              '弹窗选择',
              h(
                Select,
                { 'aria-label': '弹窗选择', value, onValueChange: setValue },
                ['a', 'b', 'c'].map((v) => h('option', { key: v, value: v }, v.toUpperCase())),
              ),
            ),
          ),
      );
    }
    (dom.default || dom).createRoot(el).render(h(Test));
  }, Boolean(process.env.COMPOSER_TEST_FONT));

  const basic = page.getByRole('combobox', { name: '测试选择', exact: true });
  await basic.waitFor();
  assert.equal(await page.locator('#dropdown-test select').count(), 0);
  await basic.focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('listbox', { name: '测试选择' }).waitFor();
  assert.equal(await basic.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await basic.innerText(), 'Beta');
  assert.deepEqual(await page.evaluate(() => window.selectChanges), ['b']);
  assert.equal(await page.evaluate(() => window.submits), 0);
  assert.equal(
    await page.evaluate(() => new FormData(document.getElementById('select-form')).get('choice')),
    'b',
  );
  assert(await basic.evaluate((el) => el === document.activeElement));
  await basic.click();
  await page.getByRole('option', { name: '禁用选项', exact: true }).click({ force: true });
  assert.equal(await basic.innerText(), 'Beta');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  assert.equal(await basic.innerText(), '中文选项');
  await basic.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  assert.equal(await basic.innerText(), 'Alpha');
  await basic.focus();
  await page.keyboard.press('b');
  await page.keyboard.press('Enter');
  assert.equal(await basic.innerText(), 'Beta');
  await basic.click();
  await page.keyboard.press('Escape');
  assert.equal(await basic.getAttribute('aria-expanded'), 'false');
  await basic.click();
  await page.locator('#outside').click();
  await page.waitForFunction(() => !document.querySelector('.select-popup:popover-open'));
  await basic.click();
  await page.keyboard.press('Tab');
  assert.equal(await basic.getAttribute('aria-expanded'), 'false');
  await basic.click();
  await page.evaluate(() => window.setSelectDisabled(true));
  await page.waitForFunction(() => !document.querySelector('.select-popup:popover-open'));
  assert(await basic.isDisabled());
  await page.evaluate(() => window.setSelectDisabled(false));
  checks.push(
    'keyboard navigation skips disabled options/groups; typeahead; controlled updates; form value without unintended submit; Escape/Tab/outside/disabled dismissal',
  );

  await page.getByRole('button', { name: '打开选择弹窗' }).click();
  const dialog = page.getByRole('dialog', { name: '选择弹窗' });
  assert.equal(
    await dialog.evaluate((el) => getComputedStyle(el, '::backdrop').backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  assert.equal(
    await dialog.evaluate((el) => getComputedStyle(el, '::backdrop').backdropFilter),
    'none',
  );
  await page.getByRole('combobox', { name: '弹窗选择', exact: true }).click();
  await page.getByRole('option', { name: 'C', exact: true }).click();
  assert(await dialog.isVisible());
  assert.equal(
    await page.getByRole('combobox', { name: '弹窗选择', exact: true }).innerText(),
    'C',
  );
  await page.getByRole('combobox', { name: '弹窗选择', exact: true }).click();
  await page.keyboard.press('Escape');
  assert(await dialog.isVisible());
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  checks.push(
    'top-layer options inside native modal, label activation and Escape closes dropdown before dialog',
  );

  const branch = page.getByRole('combobox', { name: '基准分支', exact: true });
  await branch.click();
  const search = page.getByRole('searchbox', { name: '搜索基准分支' });
  await page.keyboard.press('Tab');
  assert(await search.evaluate((el) => el === document.activeElement));
  await page.keyboard.press('Shift+Tab');
  assert(await branch.evaluate((el) => el === document.activeElement));
  await search.fill('not-a-branch');
  await page.getByText('没有匹配的选项', { exact: true }).waitFor();
  await search.fill('macos-host');
  assert.equal(await page.getByRole('option').count(), 1);
  await search.press('ArrowDown');
  await search.press('Enter');
  assert((await branch.innerText()).includes('macos-host-support'));
  await page.getByRole('button', { name: '比较分支', exact: true }).click();
  await page.waitForFunction(() => window.branchCalls.some((c) => c.action === 'git.compare'));
  assert.equal(
    await page.evaluate(() => window.branchCalls.find((c) => c.action === 'git.compare').base),
    'refs/remotes/origin/feat/macos-host-support',
  );
  checks.push(
    'real BranchComparison searchable local/remote groups, empty search, full branch identity reaches comparison RPC',
  );

  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    for (const width of [1100, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await branch.click();
      const popup = page.locator('.select-popup:popover-open');
      await popup.waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(180);
      const box = await popup.boundingBox();
      assert(
        box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 851,
        JSON.stringify(box),
      );
      assert(
        await popup.locator('.select-options').evaluate((el) => el.scrollHeight > el.clientHeight),
      );
      const colors = await popup.evaluate((el) => ({
        bg: getComputedStyle(el).backgroundColor,
        radius: getComputedStyle(el).borderRadius,
      }));
      assert.equal(colors.radius, '20px');
      const mobileBackground = theme === 'dark' ? 'rgb(34, 34, 34)' : 'rgb(244, 244, 244)';
      const desktopBackground = theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
      assert.equal(colors.bg, width <= 760 ? mobileBackground : desktopBackground);
      await page.screenshot({
        path: fileURLToPath(new URL(`branches-${theme}-${width}.png`, out)),
      });
      await page.keyboard.press('Escape');
    }
  }
  // Place the control near the bottom and right edge to exercise upward placement.
  await page.evaluate(() => {
    document.getElementById('select-form').style.cssText =
      'position:fixed;bottom:8px;right:8px;width:220px;z-index:2';
  });
  await basic.click();
  await page.waitForTimeout(180);
  const up = await page.locator('.select-popup:popover-open').boundingBox();
  const trigger = await basic.boundingBox();
  assert(up.y + up.height <= trigger.y && up.x + up.width <= 320);
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.getElementById('select-form').removeAttribute('style'));
  checks.push(
    'light/dark, 320/390/1100px bounds, scrolling long branches and upward/right-edge placement',
  );

  await page.setViewportSize({ width: 1100, height: 850 });
  for (const [name, popupSelector] of [
    ['切换工作模式', '.mode-menu'],
    ['切换模型', '.model-picker-popup'],
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    const popup = page.locator(`${popupSelector}:popover-open`);
    await popup.waitFor();
    assert.equal(
      await popup.evaluate((el) => getComputedStyle(el).borderRadius),
      popupSelector === '.model-picker-popup' ? '0px' : '20px',
    );
    await page.waitForTimeout(180);
    if (popupSelector === '.mode-menu') {
      const anchor = await page.getByRole('button', { name, exact: true }).boundingBox();
      const box = await popup.boundingBox();
      assert(Math.abs(box.y - anchor.y - anchor.height - 6) <= 1);
    }
    await popup.screenshot({ path: fileURLToPath(new URL(`${popupSelector.slice(1)}.png`, out)) });
    await page.keyboard.press('Escape');
  }
  const modelTrigger = page.getByRole('button', { name: '切换模型', exact: true });
  await modelTrigger.click();
  const speed = page.getByRole('group', { name: '响应速度' });
  assert.equal(await speed.count(), 0);
  await page.locator('.model-picker-model-toggle').click();
  assert.equal(await speed.count(), 0);
  assert.equal(
    await page.getByRole('button', { name: '跟随电脑默认模型', exact: true }).count(),
    0,
  );
  const fast = page.locator('.model-fast-toggle');
  await fast.click();
  assert.equal(await fast.getAttribute('aria-pressed'), 'true');
  await fast.click();
  assert.equal(await fast.getAttribute('aria-pressed'), 'false');
  const models = page.getByRole('group', { name: '模型', exact: true });
  await models.getByRole('button', { name: 'Model B', exact: true }).click();
  assert.equal(await modelTrigger.innerText(), 'Model B');
  await page.keyboard.press('Escape');
  await modelTrigger.click();
  await page.locator('.model-picker-model-toggle').click();
  assert.equal(
    await models.getByRole('button', { name: 'Model B', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  assert(await models.getByRole('button', { name: 'Model A', exact: true }).isVisible());
  await page.keyboard.press('Escape');
  checks.push(
    'expanded list contains only models; heading lightning toggles speed and model choices update the draft',
  );
  // Anchored button menus use one keyboard contract and expose open state.
  for (const [name, selector] of [['切换工作模式', '.mode-menu']]) {
    const trigger = page.getByRole('button', { name, exact: true });
    await trigger.focus();
    await page.waitForTimeout(100);
    await trigger.press('ArrowDown');
    const menu = page.locator(`${selector}:popover-open`);
    await menu.waitFor();
    await page.waitForTimeout(180);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert(
      await menu
        .locator('button:not(:disabled)')
        .first()
        .evaluate((el) => el === document.activeElement),
    );
    await page.keyboard.press('End');
    assert(
      await menu
        .locator('button:not(:disabled)')
        .last()
        .evaluate((el) => el === document.activeElement),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(180);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert(await trigger.evaluate((el) => el === document.activeElement));
  }
  // Model/permission pickers also work when their trigger is near the top edge.
  for (const width of [320, 1100]) {
    await page.setViewportSize({ width, height: 480 });
    for (const [name, selector] of [['切换模型', '.model-picker-popup']]) {
      const trigger = page.getByRole('button', { name, exact: true });
      await trigger.click();
      await page.waitForTimeout(180);
      const box = await page.locator(`${selector}:popover-open`).boundingBox();
      assert(
        box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 481,
        JSON.stringify(box),
      );
      await page.keyboard.press('Escape');
    }
  }
  const permissionTrigger = page.getByRole('button', { name: '执行权限：工作区权限', exact: true });
  for (const width of [320, 1100]) {
    await page.setViewportSize({ width, height: 480 });
    await permissionTrigger.click();
    const sheet = page.getByRole('dialog', { name: '应如何批准 Codex 操作？' });
    await sheet.waitFor();
    await page.waitForFunction(() => {
      const dialog = document.querySelector('.permission-sheet[open][data-motion="open"]');
      return (
        dialog && !dialog.getAnimations().some((animation) => animation.playState === 'running')
      );
    });
    const box = await sheet.boundingBox();
    assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 481);
    await page.keyboard.press('Tab');
    assert(await sheet.evaluate((node) => node.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden' });
    assert(await permissionTrigger.evaluate((node) => node === document.activeElement));
  }
  checks.push(
    'transparent dialog backdrop; menu keyboard focus/open state; short viewport picker bounds',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await basic.click();
  await page.keyboard.press('Escape');
  assert.equal(await basic.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(errors, []);
  checks.push(
    'model/effort, permission and work-mode surfaces share menu styling; reduced-motion dismissal; no page errors',
  );
  const touch = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 390, height: 700 },
    hasTouch: true,
  });
  await touch.route('**/api/**', (route) => route.abort());
  await touch.goto(process.env.DROPDOWN_TEST_ORIGIN || 'http://127.0.0.1:1434/');
  await touch.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Select } = await import('/src/components/Select.tsx');
    document.getElementById('root').style.display = 'none';
    const fixture = document.createElement('div');
    fixture.style.cssText = 'position:fixed;bottom:12px;right:12px;width:240px';
    document.body.append(fixture);
    function Test() {
      const [value, setValue] = React.useState('a');
      return React.createElement(
        Select,
        { value, onValueChange: setValue, 'aria-label': 'Touch select' },
        ['a', 'b', 'c'].map((v) => React.createElement('option', { key: v, value: v }, v)),
      );
    }
    (dom.default || dom).createRoot(fixture).render(React.createElement(Test));
  });
  const touchTrigger = touch.getByRole('combobox', { name: 'Touch select' });
  await touchTrigger.tap();
  const touchOption = touch.getByRole('option', { name: 'b', exact: true });
  assert((await touchOption.evaluate((el) => el.offsetHeight)) >= 44);
  await touchOption.tap();
  assert.equal(await touchTrigger.innerText(), 'b');
  assert.equal(await touchTrigger.getAttribute('aria-expanded'), 'false');
  await touch.close();
  checks.push('touch viewport uses 44px option targets and tap selection closes the upward popup');
  await writeFile(
    new URL('verification.json', out),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        checks,
        errors,
        scope:
          'Controlled real Web components and comparison RPC fixture; no production update or real Host actions.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`PASS: ${checks.join('; ')}`);
} finally {
  await browser.close();
}

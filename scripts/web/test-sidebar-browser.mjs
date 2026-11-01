import { fileURLToPath } from 'node:url';
/* global window, document, requestAnimationFrame */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/sidebar-desktop/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1200, height: 850 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => route.abort());
  if (process.env.COMPOSER_TEST_FONT)
    await page.route('**/__font', (route) =>
      route.fulfill({ path: process.env.COMPOSER_TEST_FONT }),
    );
  await page.goto(process.env.SIDEBAR_TEST_ORIGIN || 'http://127.0.0.1:1430');
  const mount = async (font) => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Sidebar } = await import('/src/features/Sidebar.tsx');
    const { ModeSwitcher } = await import('/src/features/ModeSwitcher.tsx');
    document.getElementById('root').style.display = 'none';
    const el = document.createElement('div');
    el.className = 'shell with-sidebar';
    document.body.append(el);
    if (font) {
      const style = document.createElement('style');
      style.textContent =
        "@font-face{font-family:SidebarTest;src:url('/__font')} body{font-family:SidebarTest,sans-serif}";
      document.head.append(style);
    }
    const initial = [
      {
        sessionId: 'a1',
        projectId: 'a',
        title: '制定计划并询问是否开发',
        updatedAt: '2026-10-29T12:00:00Z',
      },
      {
        sessionId: 'a2',
        projectId: 'a',
        title: 'New conversation',
        updatedAt: '2026-10-29T11:00:00Z',
      },
      {
        sessionId: 'b1',
        projectId: 'b',
        title: '当前项目我原先在发布0.4.0版本 你能帮我检查一下吗',
        updatedAt: '2026-10-29T10:00:00Z',
      },
      {
        sessionId: 'a3',
        projectId: 'a',
        title: '拉取最新的main分支',
        updatedAt: '2026-10-29T09:00:00Z',
      },
      {
        sessionId: 'b2',
        projectId: 'b',
        title: '排查 Codex 未就绪原因',
        updatedAt: '2026-10-29T08:00:00Z',
      },
      {
        sessionId: 'plain',
        projectId: 'agentdeck-chat',
        title: '普通聊天记录',
        updatedAt: '2026-10-29T07:00:00Z',
      },
      {
        sessionId: 'running',
        projectId: 'a',
        title: '正在检查项目',
        status: 'running',
        updatedAt: '2026-10-29T06:00:00Z',
      },
      { sessionId: 'old', projectId: 'b', title: '已归档记录', archived: 1 },
    ];
    window.sidebarCalls = [];
    window.sidebarFail = false;
    function Test() {
      const [sessions, setSessions] = React.useState(initial);
      const [sessionId, select] = React.useState('a1');
      const [filter, setFilter] = React.useState('all');
      const [connected, setConnected] = React.useState(true);
      window.sidebarConnection = setConnected;
      return React.createElement(Sidebar, {
        brand: React.createElement(ModeSwitcher, { mode: 'codex', onChange: () => {} }),
        sessions,
        projects: [
          { projectId: 'a', name: 'outsourced-projects' },
          { projectId: 'b', name: 'AgentHub' },
        ],
        host: { hostId: 'test', displayName: '工作电脑', online: true },
        connected,
        sessionId,
        projectId: 'a',
        open: true,
        onClose: () => window.sidebarCalls.push(['close']),
        onNew: () => window.sidebarCalls.push(['new']),
        chatAvailable: true,
        onChat: () => window.sidebarCalls.push(['chat']),
        onSelect: (s) => {
          select(s.sessionId);
          window.sidebarCalls.push(['select', s.sessionId]);
        },
        onProject: (id) => window.sidebarCalls.push(['project', id]),
        onRefresh: () => window.sidebarCalls.push(['refresh']),
        onSettings: () => window.sidebarCalls.push(['settings']),
        onComputers: () => window.sidebarCalls.push(['computers']),
        onManage: (s) => window.sidebarCalls.push(['manage', s.sessionId]),
        onSearch: () => window.sidebarCalls.push(['search']),
        filter,
        setFilter,
        onSessionAction: async (action, s) => {
          window.sidebarCalls.push([action, s.sessionId]);
          if (window.sidebarHold)
            await new Promise((resolve) => {
              window.sidebarRelease = resolve;
            });
          if (window.sidebarFail) throw new Error('测试：请求失败，原有会话已保留');
          setSessions((items) =>
            items.map((item) =>
              item.sessionId !== s.sessionId
                ? item
                : {
                    ...item,
                    ...(action === 'pin'
                      ? { pinned: item.pinned === 1 ? 0 : 1 }
                      : { archived: action === 'archive' ? 1 : 0 }),
                  },
            ),
          );
        },
      });
    }
    (dom.createRoot || dom.default.createRoot)(el).render(React.createElement(Test));
  };
  await page.evaluate(mount, !!process.env.COMPOSER_TEST_FONT);
  const settle = async (target = page) =>
    target.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
    });
  const sidebar = page.locator('aside.sidebar');
  const recent = page.getByRole('navigation', { name: '最近对话列表', exact: true });
  const project = page.getByRole('navigation', { name: 'outsourced-projects 的对话', exact: true });
  await sidebar.waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await recent.locator('.session-row').count(), 7);
  assert.equal(await recent.getByText('普通聊天记录', { exact: true }).count(), 1);
  assert.equal(await project.locator('.session-row').count(), 3);
  await page.getByRole('button', { name: '显示更多（1）', exact: true }).click();
  await project.getByText('正在检查项目', { exact: true }).waitFor();
  const menu = page.getByRole('menu', { name: '会话操作', exact: true });
  const more = (row) => row.getByRole('button', { name: /^更多操作 / });
  const openMore = async (row) => {
    await settle();
    await row.hover();
    await more(row).click();
    await menu.waitFor();
  };
  const startArchive = async (row, restore = false) => {
    await openMore(row);
    await menu
      .getByRole('menuitem', { name: restore ? '恢复会话' : '归档会话', exact: true })
      .click();
    const confirmation = page.getByRole('dialog', {
      name: restore ? '恢复会话' : '归档会话',
      exact: true,
    });
    await confirmation.waitFor();
    return confirmation;
  };
  const working = project.locator('.session-row').filter({ hasText: '正在检查项目' });
  await openMore(working);
  assert(await menu.getByRole('menuitem', { name: '标记会话', exact: true }).isDisabled());
  assert(await menu.getByRole('menuitem', { name: '归档会话', exact: true }).isDisabled());
  await page.keyboard.press('Escape');
  await project.getByRole('button', { name: '收起', exact: true }).click();
  await page.getByRole('button', { name: 'outsourced-projects', exact: true }).click();
  await project.waitFor({ state: 'hidden' });
  assert.equal(await recent.isVisible(), true);
  await page.getByRole('button', { name: 'outsourced-projects', exact: true }).click();
  await project.waitFor({ state: 'visible' });
  const row = recent.locator('.session-row').filter({ hasText: '制定计划并询问是否开发' });
  assert.equal(await row.locator('.sidebar-session-actions button').count(), 2);
  assert.equal(await row.getByRole('button', { name: /^(置顶|归档) / }).count(), 0);
  await row.getByRole('button', { name: '编辑会话 制定计划并询问是否开发', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.sidebarCalls.at(-1)), ['manage', 'a1']);
  await openMore(row);
  assert.equal(await more(row).getAttribute('aria-expanded'), 'true');
  assert.equal(
    await more(project.locator('[data-session-id="a1"]')).getAttribute('aria-expanded'),
    'false',
  );
  await menu.getByRole('menuitem', { name: '标记会话', exact: true }).click();
  await menu.waitFor({ state: 'hidden' });
  const marked = page.getByRole('navigation', { name: '已标记对话列表', exact: true });
  const markedRow = marked.locator('[data-session-id="a1"]');
  await markedRow.waitFor();
  assert.equal(await row.count(), 0);
  assert.equal(await project.locator('[data-session-id="a1"]').count(), 0);
  assert.equal(await sidebar.locator('[data-session-id="a1"]').count(), 1);
  await page.getByRole('button', { name: '已标记', exact: true }).click();
  await marked.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '已标记', exact: true }).click();
  await marked.waitFor();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.mouse.move(700, 600);
  await settle();
  await sidebar.screenshot({ path: fileURLToPath(new URL('desktop-dark.png', out)) });
  // Mouse and keyboard both use the same menu; Escape restores the source focus.
  await markedRow.locator('.session').click({ button: 'right' });
  await menu.waitFor();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '取消标记');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement.classList.contains('session'));
  await page.keyboard.press('Shift+F10');
  await menu.waitFor();
  await settle();
  await page.screenshot({ path: fileURLToPath(new URL('context-menu.png', out)) });
  await page.mouse.click(700, 600);
  await menu.waitFor({ state: 'hidden' });
  // Archive confirms in place, with cancel as the initial focus. Failure permits retry.
  let confirmation = await startArchive(markedRow);
  await settle();
  const box = await confirmation.boundingBox();
  const source = await more(markedRow).boundingBox();
  assert(box.x < 100 && box.width <= 305 && Math.abs(box.y - source.y - source.height - 6) <= 2);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert(
    await confirmation
      .getByRole('button', { name: '取消', exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  await page.screenshot({ path: fileURLToPath(new URL('archive-dark.png', out)) });
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await confirmation.waitFor({ state: 'hidden' });
  assert.equal(await markedRow.count(), 1);
  confirmation = await startArchive(markedRow);
  await page.evaluate(() => window.sidebarConnection(false));
  assert(await confirmation.getByRole('button', { name: '归档', exact: true }).isDisabled());
  await page.evaluate(() => window.sidebarConnection(true));
  await page.mouse.click(700, 600);
  await confirmation.waitFor({ state: 'hidden' });
  assert.equal(await markedRow.count(), 1);
  confirmation = await startArchive(markedRow);
  await page.evaluate(() => {
    window.sidebarFail = true;
  });
  await confirmation.getByRole('button', { name: '归档', exact: true }).click();
  await confirmation.getByRole('alert').waitFor();
  assert.equal(await markedRow.count(), 1);
  await page.evaluate(() => {
    window.sidebarFail = false;
    window.sidebarHold = true;
  });
  const countBefore = await page.evaluate(
    () => window.sidebarCalls.filter(([action]) => action === 'archive').length,
  );
  await confirmation.getByRole('button', { name: '归档', exact: true }).click();
  await confirmation.getByRole('button', { name: '处理中…', exact: true }).waitFor();
  assert(await confirmation.getByRole('button', { name: '取消', exact: true }).isDisabled());
  assert(await confirmation.getByRole('button', { name: '处理中…', exact: true }).isDisabled());
  assert.equal(
    await page.evaluate(
      () => window.sidebarCalls.filter(([action]) => action === 'archive').length,
    ),
    countBefore + 1,
  );
  await page.evaluate(() => {
    window.sidebarHold = false;
    window.sidebarRelease();
  });
  await confirmation.waitFor({ state: 'hidden' });
  assert.equal(await markedRow.count(), 0);
  await settle();
  await page.getByRole('button', { name: '筛选和排序会话', exact: true }).click();
  await settle();
  await page.getByRole('combobox', { name: '会话筛选', exact: true }).click();
  await page.getByRole('option', { name: '归档', exact: true }).click();
  const archived = recent.locator('[data-session-id="a1"]');
  confirmation = await startArchive(archived, true);
  await confirmation.getByRole('button', { name: '恢复', exact: true }).click();
  await confirmation.waitFor({ state: 'hidden' });
  await page.getByRole('combobox', { name: '会话筛选', exact: true }).click();
  await page.getByRole('option', { name: '全部对话', exact: true }).click();
  await page.getByRole('button', { name: '筛选和排序会话', exact: true }).click();
  await markedRow.waitFor();
  await page.evaluate(() => window.sidebarConnection(false));
  await openMore(markedRow);
  assert(await menu.getByRole('menuitem', { name: '归档会话', exact: true }).isDisabled());
  assert(await menu.getByRole('menuitem', { name: '取消标记', exact: true }).isDisabled());
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.sidebarConnection(true));
  // Removing a mark restores project/recent membership.
  await openMore(markedRow);
  await menu.getByRole('menuitem', { name: '取消标记', exact: true }).click();
  await menu.waitFor({ state: 'hidden' });
  await row.waitFor();
  assert.equal(await project.locator('[data-session-id="a1"]').count(), 1);
  assert.equal(await sidebar.getByRole('region', { name: '已标记', exact: true }).count(), 0);
  await page.getByRole('button', { name: '在 AgentHub 中新建对话', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.sidebarCalls.at(-1)), ['project', 'b']);
  // Choosing a conversation in another project is still possible in global Recents.
  await recent.getByRole('button', { name: '排查 Codex 未就绪原因', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.sidebarCalls.at(-1)), ['select', 'b2']);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.mouse.move(700, 600);
  await settle();
  await sidebar.screenshot({ path: fileURLToPath(new URL('desktop-light.png', out)) });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    const sidebarBox = await sidebar.boundingBox();
    assert.ok(sidebarBox.width <= width * 0.85 + 1);
    confirmation = await startArchive(row);
    await settle();
    const card = await confirmation.boundingBox();
    assert(
      card.x >= 0 && card.x + card.width <= width && card.y >= 0 && card.y + card.height <= 844,
    );
    await page.screenshot({ path: fileURLToPath(new URL(`archive-mobile-${width}.png`, out)) });
    await page.keyboard.press('Escape');
    await confirmation.waitFor({ state: 'hidden' });
    // Bottom-edge menus open above their trigger, rather than leaving the screen.
    await row.evaluate((el) => {
      el.style.cssText = 'position:fixed;bottom:8px;left:8px;width:240px;z-index:5';
    });
    confirmation = await startArchive(row);
    await settle();
    const up = await confirmation.boundingBox();
    const anchor = await more(row).boundingBox();
    assert(up.y + up.height <= anchor.y);
    await page.keyboard.press('Escape');
    await row.evaluate((el) => el.removeAttribute('style'));
    await page.screenshot({ path: fileURLToPath(new URL(`mobile-${width}.png`, out)) });
  }
  const touch = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  await touch.route('**/api/**', (route) => route.abort());
  await touch.goto(process.env.SIDEBAR_TEST_ORIGIN || 'http://127.0.0.1:1430');
  await touch.evaluate(mount, false);
  const touchRecent = touch.getByRole('navigation', { name: '最近对话列表', exact: true });
  const touchRow = touchRecent
    .locator('.session-row')
    .filter({ hasText: '制定计划并询问是否开发' });
  await touchRow
    .getByRole('button', { name: '编辑会话 制定计划并询问是否开发', exact: true })
    .tap();
  assert.deepEqual(await touch.evaluate(() => window.sidebarCalls.at(-1)), ['manage', 'a1']);
  await touchRow
    .getByRole('button', { name: '更多操作 制定计划并询问是否开发', exact: true })
    .tap();
  await touch.getByRole('menuitem', { name: '归档会话', exact: true }).tap();
  const touchCard = touch.getByRole('dialog', { name: '归档会话', exact: true });
  await settle(touch);
  const touchBox = await touchCard.boundingBox();
  assert(touchBox.x >= 0 && touchBox.x + touchBox.width <= 390);
  assert(
    (await touchCard.getByRole('button', { name: '归档', exact: true }).boundingBox()).height >= 44,
  );
  await touch.screenshot({ path: fileURLToPath(new URL('archive-touch.png', out)) });
  await touchCard.getByRole('button', { name: '取消', exact: true }).tap();
  await touch.getByRole('button', { name: '在 AgentHub 中新建对话', exact: true }).tap();
  assert.deepEqual(await touch.evaluate(() => window.sidebarCalls.at(-1)), ['project', 'b']);
  await settle(touch);
  await touch.screenshot({ path: fileURLToPath(new URL('mobile-touch.png', out)) });
  await touch.close();
  assert.deepEqual(errors, []);
  await writeFile(
    new URL('verification.json', out),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        checks: [
          'project/recents, two action buttons and editor',
          'exclusive marked section, collapse/unmark/restore',
          'menu click/right-click/keyboard/Escape/focus/outside',
          'anchored archive confirmation: cancel/failure/retry/pending/restore',
          'disconnected/running guards',
          '320/390px bounds, bottom-edge upward placement, touch actions',
        ],
        errors,
        scope: 'Controlled real Sidebar; no production deployment or real Host actions.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS: project/recents, more/edit buttons, exclusive marks, anchored archive cancel/failure/retry/pending/restore, guards, keyboard/focus, 320/390px and touch. Screenshots:',
    out.pathname,
  );
} finally {
  await browser.close();
}

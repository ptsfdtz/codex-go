/* global window, document, requestAnimationFrame */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/sidebar-desktop/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
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
  assert.equal(
    await project.getByRole('button', { name: '置顶 正在检查项目', exact: true }).isDisabled(),
    true,
  );
  await project.getByRole('button', { name: '收起', exact: true }).click();
  await page.getByRole('button', { name: 'outsourced-projects', exact: true }).click();
  await project.waitFor({ state: 'hidden' });
  assert.equal(await recent.isVisible(), true);
  await page.getByRole('button', { name: 'outsourced-projects', exact: true }).click();
  await project.waitFor({ state: 'visible' });
  const row = recent.locator('.session-row').filter({ hasText: '制定计划并询问是否开发' });
  await row.getByRole('button', { name: '置顶 制定计划并询问是否开发', exact: true }).click();
  await row.getByRole('button', { name: '取消置顶 制定计划并询问是否开发', exact: true }).waitFor();
  assert.equal(
    await project
      .getByRole('button', { name: '取消置顶 制定计划并询问是否开发', exact: true })
      .count(),
    1,
  );
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.mouse.move(700, 600);
  await settle();
  await sidebar.screenshot({ path: new URL('desktop-dark.png', out).pathname });
  // Context menu keyboard navigation, native Escape and focus restoration.
  await row.locator('.session').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '会话操作', exact: true });
  await menu.waitFor();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '取消置顶');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await row.locator('.session').evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Shift+F10');
  await menu.waitFor();
  await page.screenshot({ path: new URL('context-menu.png', out).pathname });
  await page.mouse.click(700, 600);
  await menu.waitFor({ state: 'hidden' });
  // Archive requires confirmation; failures preserve the row and allow retry.
  await row.getByRole('button', { name: '归档 制定计划并询问是否开发', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await row.count(), 1);
  await row.getByRole('button', { name: '归档 制定计划并询问是否开发', exact: true }).click();
  await page.evaluate(() => {
    window.sidebarFail = true;
  });
  await modal.getByRole('button', { name: '确认', exact: true }).click();
  await modal.getByRole('alert').waitFor();
  assert.equal(await row.count(), 1);
  await page.evaluate(() => {
    window.sidebarFail = false;
  });
  await modal.getByRole('button', { name: '确认', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  assert.equal(await row.count(), 0);
  await page.getByRole('button', { name: '筛选和排序会话', exact: true }).click();
  await page.getByRole('combobox', { name: '会话筛选', exact: true }).click();
  await page.getByRole('option', { name: '归档', exact: true }).click();
  const archived = recent.locator('.session-row').filter({ hasText: '制定计划并询问是否开发' });
  await archived.locator('.session').hover();
  await archived.getByRole('button', { name: '恢复 制定计划并询问是否开发', exact: true }).click();
  await modal.getByRole('button', { name: '确认', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  await page.getByRole('combobox', { name: '会话筛选', exact: true }).click();
  await page.getByRole('option', { name: '全部对话', exact: true }).click();
  await page.getByRole('button', { name: '筛选和排序会话', exact: true }).click();
  await page.evaluate(() => window.sidebarConnection(false));
  assert.equal(
    await row
      .getByRole('button', { name: '归档 制定计划并询问是否开发', exact: true })
      .isDisabled(),
    true,
  );
  await page.evaluate(() => window.sidebarConnection(true));
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
  await sidebar.screenshot({ path: new URL('desktop-light.png', out).pathname });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    const box = await sidebar.boundingBox();
    assert.ok(box.width <= width * 0.85 + 1);
    await page.screenshot({ path: new URL(`mobile-${width}.png`, out).pathname });
  }
  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await touch.route('**/api/**', (route) => route.abort());
  await touch.goto(process.env.SIDEBAR_TEST_ORIGIN || 'http://127.0.0.1:1430');
  await touch.evaluate(mount, false);
  const touchRecent = touch.getByRole('navigation', { name: '最近对话列表', exact: true });
  const touchRow = touchRecent
    .locator('.session-row')
    .filter({ hasText: '制定计划并询问是否开发' });
  await touchRow
    .getByRole('button', { name: '管理会话 制定计划并询问是否开发', exact: true })
    .tap();
  assert.deepEqual(await touch.evaluate(() => window.sidebarCalls.at(-1)), ['manage', 'a1']);
  await touch.getByRole('button', { name: '在 AgentHub 中新建对话', exact: true }).tap();
  assert.deepEqual(await touch.evaluate(() => window.sidebarCalls.at(-1)), ['project', 'b']);
  await settle(touch);
  await touch.screenshot({ path: new URL('mobile-touch.png', out).pathname });
  await touch.close();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: project grouping, global Recents, expand/collapse, more, selection, pin, archive/cancel/failure/retry/restore, disconnected/running guards, context menu keyboard/Escape/outside click, 320/390px. Screenshots:',
    out.pathname,
  );
} finally {
  await browser.close();
}

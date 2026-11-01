import { fileURLToPath } from 'node:url';
/* global window, document, localStorage */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1430';
const out = new URL('../../artifacts/project-settings/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1100, height: 850 },
  });
  await context.addInitScript(() => {
    localStorage.setItem('agentdeck.web.work-mode', '"codex"');
    localStorage.setItem('agentdeck.web.theme', 'dark');
  });
  await context.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const result = path.endsWith('/web/session')
      ? { accountId: 'project-settings-test', cloudDeviceId: 'browser', mustChangePassword: false }
      : path.endsWith('/hosts')
        ? { hosts: [] }
        : path.endsWith('/devices')
          ? { devices: [] }
          : path.endsWith('/web/csrf')
            ? { csrfToken: 'test' }
            : {};
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
  });
  const page = await context.newPage();
  if (process.env.COMPOSER_TEST_FONT) {
    await page.route('**/__project-settings-font.ttf', (route) =>
      route.fulfill({ path: process.env.COMPOSER_TEST_FONT, contentType: 'font/ttf' }),
    );
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(8000);
  await page.goto(origin);
  if (process.env.COMPOSER_TEST_FONT) {
    await page.addStyleTag({
      content:
        "@font-face{font-family:ProjectSettingsTest;src:url('/__project-settings-font.ttf')} :root{--font-sans:ProjectSettingsTest,sans-serif;font-family:var(--font-sans)}",
    });
    await page.evaluate(() => document.fonts.ready);
  }
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '对话', exact: true })
    .click();
  await page
    .getByRole('region', { name: '项目管理' })
    .getByText('连接电脑后查看和管理项目。')
    .waitFor();
  assert(await page.getByRole('button', { name: '同步项目', exact: true }).isDisabled());
  // Mount the production component inside the production settings layout. The
  // controlled transport verifies UI behavior without touching daily projects.
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Modal } = await import('/src/ui.tsx');
    const { SettingsLayout } = await import('/src/features/SettingsLayout.tsx');
    const { ProjectSettings } = await import('/src/features/project-settings/ProjectSettings.tsx');
    document.getElementById('root').style.display = 'none';
    const target = document.createElement('div');
    document.body.append(target);
    const root = (dom.default || dom).createRoot(target, { identifierPrefix: 'project-test-' });
    const initial = [
      { projectId: 'workspace', name: 'workspace', canonicalPath: '/root/workspace' },
      { projectId: 'codex-go', name: 'codex-go', canonicalPath: '/root/workspace/codex-go' },
      { projectId: 'website', name: '个人网站', canonicalPath: '/root/projects/personal-website' },
      { projectId: 'agentdeck', name: 'AgentDeck', canonicalPath: '/root/projects/agentdeck' },
      { projectId: 'tools', name: '开发工具', canonicalPath: '/root/projects/developer-tools' },
      {
        projectId: 'long',
        name: '一个很长的项目名称用于测试小屏幕上的省略显示',
        canonicalPath: '/root/projects/a-very-long-directory-name/nested/project-with-long-name',
      },
    ];
    window.projectTest = { calls: [], remote: initial, failure: '', connected: true };
    function Example() {
      const [projects, setProjects] = React.useState(initial);
      const [connected, setConnected] = React.useState(true);
      const [canSync, setCanSync] = React.useState(true);
      const [tab, setTab] = React.useState('conversations');
      window.projectTest.setProjects = setProjects;
      window.projectTest.setConnected = setConnected;
      window.projectTest.setCanSync = setCanSync;
      const request = async (action, payload) => {
        window.projectTest.calls.push({ action, payload });
        if (window.projectTest.hold)
          await new Promise((resolve) => {
            window.projectTest.release = resolve;
          });
        if (window.projectTest.failure) throw new Error(window.projectTest.failure);
        if (action === 'projects.remove')
          window.projectTest.remote = window.projectTest.remote.filter(
            (project) => project.projectId !== payload.projectId,
          );
        return { status: action === 'projects.remove' ? 'removed' : 'synced' };
      };
      return React.createElement(
        Modal,
        { title: '设置', onClose: () => {}, className: 'settings-modal', wide: true },
        React.createElement(
          SettingsLayout,
          { active: tab, onChange: setTab },
          React.createElement(
            'div',
            { className: 'panel-stack' },
            ...['查看归档对话', '未发送草稿', '同步电脑已有对话'].map((name) =>
              React.createElement(
                'button',
                { key: name, className: 'settings-action' },
                React.createElement('strong', null, name),
              ),
            ),
            React.createElement(ProjectSettings, {
              request,
              projects,
              connected,
              canSync,
              currentProject: 'codex-go',
              hostName: '我的开发电脑',
              onChanged: () => setProjects(window.projectTest.remote),
              onProject: (id) => {
                window.projectTest.opened = id;
              },
            }),
          ),
        ),
      );
    }
    root.render(React.createElement(Example));
  });
  const region = page.getByRole('region', { name: '项目管理' });
  await region.getByRole('button', { name: '打开项目 codex-go', exact: true }).click();
  assert.equal(await page.evaluate(() => window.projectTest.opened), 'codex-go');
  const search = region.getByRole('searchbox', { name: '搜索项目' });
  await search.fill('codex-go');
  assert.equal(await region.locator('.project-settings-row').count(), 1);
  await search.fill('no-such-project');
  await region.getByText('没有匹配的项目').waitFor();
  await search.fill('');
  await page.evaluate(() => window.projectTest.setProjects(window.projectTest.remote.slice(0, 2)));
  await search.waitFor({ state: 'hidden' });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.screenshot({ path: fileURLToPath(new URL(`settings-${theme}.png`, out)) });
  }
  await page.evaluate(() => window.projectTest.setProjects(window.projectTest.remote));
  await search.waitFor();
  await page.evaluate(() => {
    window.projectTest.hold = true;
  });
  await region.getByRole('button', { name: '同步项目', exact: true }).click();
  assert(await region.getByRole('button', { name: '同步中…', exact: true }).isDisabled());
  assert(await region.getByRole('button', { name: '移除项目 codex-go', exact: true }).isDisabled());
  assert.equal(await page.evaluate(() => window.projectTest.calls.length), 1);
  await page.evaluate(() => {
    window.projectTest.hold = false;
    window.projectTest.release();
  });
  await region.getByRole('status').filter({ hasText: '项目已同步' }).waitFor();
  const remove = region.getByRole('button', { name: '移除项目 codex-go', exact: true });
  await remove.click();
  const confirmation = region.getByRole('group', { name: '移除“codex-go”？' });
  await confirmation
    .getByText('将撤销此项目的 Web 访问。电脑文件和 Codex 会话会保留，项目不会自动重新添加。')
    .waitFor();
  await confirmation.getByRole('button', { name: '取消' }).click();
  assert(await remove.evaluate((node) => document.activeElement === node));
  assert.equal(await page.evaluate(() => window.projectTest.calls.length), 1);
  await remove.click();
  await confirmation.getByRole('button', { name: '取消' }).focus();
  await page.keyboard.press('Escape');
  await confirmation.waitFor({ state: 'hidden' });
  assert(await remove.evaluate((node) => document.activeElement === node));
  await remove.click();
  await page.evaluate(() => {
    window.projectTest.failure = '项目有正在运行的任务，请稍后重试';
  });
  await confirmation.getByRole('button', { name: '移除项目', exact: true }).click();
  await region.getByRole('alert').filter({ hasText: '项目有正在运行的任务' }).waitFor();
  assert.equal(await confirmation.count(), 1);
  assert.equal(await region.locator('.project-settings-row').count(), 6);
  await page.evaluate(() => {
    window.projectTest.failure = '';
  });
  await search.fill('codex-go');
  await confirmation.getByRole('button', { name: '移除项目', exact: true }).click();
  await region.getByRole('status').filter({ hasText: '已移除“codex-go”' }).waitFor();
  assert.equal(
    await search.count(),
    1,
    'A nonempty filter remains editable after project count drops',
  );
  await search.fill('');
  assert.equal(await region.locator('.project-settings-row').count(), 5);
  const calls = await page.evaluate(() => window.projectTest.calls);
  assert.deepEqual(calls.at(-1), { action: 'projects.remove', payload: { projectId: 'codex-go' } });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 780 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await region.scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert(await region.evaluate((node) => node.scrollWidth <= node.clientWidth));
    await region.getByRole('button', { name: '移除项目 workspace', exact: true }).click();
    const group = region.getByRole('group', { name: '移除“workspace”？' });
    assert(await group.evaluate((node) => node.scrollWidth <= node.clientWidth));
    await page.screenshot({ path: fileURLToPath(new URL(`settings-${width}.png`, out)) });
    await group.getByRole('button', { name: '取消' }).click();
  }
  await page.evaluate(() => window.projectTest.setProjects([]));
  await region.getByText('还没有已同步的项目').waitFor();
  await page.evaluate(() => window.projectTest.setCanSync(false));
  assert(await region.getByRole('button', { name: '同步项目', exact: true }).isDisabled());
  await page.evaluate(() => {
    window.projectTest.setConnected(false);
  });
  await region.getByText('连接电脑后查看和管理项目。').waitFor();
  assert.equal(await region.locator('.project-settings-row').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: settings entry, open, search, sync and duplicate prevention, removal confirmation/cancel/Escape/focus, failure/retry, transport payload, empty/offline/old Host and 320/390px layouts. Controlled transport; screenshots in artifacts/project-settings/.',
  );
} finally {
  await browser.close();
}

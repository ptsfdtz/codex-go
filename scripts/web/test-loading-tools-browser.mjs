/* global window, document */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/loading-tools/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', (route) => route.abort());
  await page.goto(process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1542');
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Sidebar } = await import('/src/features/Sidebar.tsx');
    const { LoadingPlaceholder } = await import('/src/features/LoadingPlaceholder.tsx');
    const { RichContent } = await import('/src/RichContent.tsx');
    const { ActivityStages } = await import('/src/features/activity/ActivityStages.tsx');
    document.getElementById('root').style.display = 'none';
    const target = document.createElement('div');
    document.body.append(target);
    const noop = () => {};
    function Example() {
      const [loading, setLoading] = React.useState(true);
      const [mode, setMode] = React.useState('list');
      const [status, setStatus] = React.useState('inProgress');
      window.loadingTools = { setLoading, setMode, setStatus };
      const entries = [
        {
          turnId: 't',
          item: {
            id: 'skill',
            type: 'commandExecution',
            status: 'completed',
            command: 'cat /skills/imagegen/SKILL.md',
            commandActions: [{ type: 'read', path: '/skills/imagegen/SKILL.md' }],
            aggregatedOutput: 'Skill instructions',
          },
        },
        {
          turnId: 't',
          item: {
            id: 'plugin',
            type: 'mcpToolCall',
            status,
            pluginId: 'example',
            appContext: { appName: '文档插件', actionName: '搜索' },
            server: 'docs',
            tool: 'search',
            arguments: { query: 'hello' },
            output: '正在检索资料',
            result:
              status === 'completed'
                ? {
                    content: [{ type: 'text', text: '找到两篇文档' }],
                    structuredContent: { count: 2 },
                  }
                : null,
          },
        },
        {
          turnId: 't',
          item: {
            id: 'mcp',
            type: 'mcpToolCall',
            status: 'failed',
            server: 'remote',
            tool: 'lookup',
            arguments: {},
            error: { message: '连接超时' },
          },
        },
        {
          turnId: 't',
          item: {
            id: 'dynamic',
            type: 'dynamicToolCall',
            status: 'completed',
            tool: 'render',
            namespace: 'images',
            success: true,
            contentItems: [{ type: 'inputText', text: '渲染已完成' }],
          },
        },
      ];
      if (mode === 'list')
        return React.createElement(
          'div',
          { className: 'shell with-sidebar' },
          React.createElement(Sidebar, {
            projects: [],
            sessions: [],
            loading,
            connected: !loading,
            projectId: 'p',
            open: true,
            chatAvailable: false,
            filter: 'all',
            onClose: noop,
            onNew: noop,
            onChat: noop,
            onSelect: noop,
            onProject: noop,
            onRefresh: noop,
            onSettings: noop,
            onComputers: noop,
            onManage: noop,
            onSearch: noop,
            setFilter: noop,
            onSessionAction: async () => {},
          }),
        );
      return React.createElement(
        'main',
        { className: 'shell', style: { display: 'block', padding: 20, overflow: 'auto' } },
        loading
          ? React.createElement(LoadingPlaceholder, { conversation: true })
          : React.createElement(ActivityStages, { entries, activeTurn: 't' }, (entry) =>
              React.createElement(RichContent, { key: entry.item.id, entry, sessionId: 's' }),
            ),
      );
    }
    (dom.default || dom).createRoot(target).render(React.createElement(Example));
  });
  await page.locator('.loading-list').first().waitFor();
  assert.equal(await page.getByText('暂无项目', { exact: true }).count(), 0);
  assert.equal(await page.getByText('暂无会话', { exact: true }).count(), 0);
  assert.equal(await page.locator('.loading-list').count(), 2);
  await page.screenshot({ path: fileURLToPath(new URL('sidebar-loading.png', out)) });
  await page.evaluate(() => window.loadingTools.setLoading(false));
  await page.getByText('暂无会话', { exact: true }).waitFor();
  assert.equal(await page.locator('.loading-list').count(), 0);
  await page.evaluate(() => {
    window.loadingTools.setMode('history');
    window.loadingTools.setLoading(true);
  });
  await page.locator('.loading-conversation').waitFor();
  await page.screenshot({ path: fileURLToPath(new URL('history-loading.png', out)) });
  await page.evaluate(() => window.loadingTools.setLoading(false));
  await page.locator('.activity-stage > summary').click();
  await page.locator('.tool-record').first().waitFor();
  assert.equal(await page.locator('.tool-record').count(), 4);
  await page.locator('.tool-record > summary').filter({ hasText: '读取技能 · imagegen' }).waitFor();
  const plugin = page.locator('.tool-record').filter({ hasText: '插件调用 · 文档插件' });
  await plugin.locator('summary').first().click();
  await plugin.getByText('正在检索资料', { exact: true }).waitFor();
  await plugin.getByText('等待工具返回结果…', { exact: true }).waitFor();
  await page.evaluate(() => window.loadingTools.setStatus('completed'));
  await plugin.getByText('找到两篇文档', { exact: true }).waitFor();
  assert.equal(await plugin.getAttribute('data-tool-state'), 'completed');
  await plugin.getByText('调用参数', { exact: true }).click();
  assert((await plugin.textContent()).includes('hello'));
  const mcp = page.locator('.tool-record').filter({ hasText: 'MCP 调用 · remote' });
  await mcp.locator('summary').first().click();
  await mcp.getByText('连接超时', { exact: true }).waitFor();
  const dynamic = page.locator('.tool-record').filter({ hasText: '工具调用 · images' });
  await dynamic.locator('summary').first().click();
  await dynamic.getByText('渲染已完成', { exact: true }).waitFor();
  for (const width of [320, 390, 1100]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({ path: fileURLToPath(new URL(`tools-${theme}-${width}.png`, out)) });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    new URL('verification.json', out),
    JSON.stringify(
      {
        checks: [
          'loading versus empty',
          'conversation skeleton',
          'native skill read',
          'plugin progress to result',
          'MCP error',
          'dynamic tool result',
          'parameters',
          '320/390/1100 dark/light',
        ],
        errors,
        realHost: false,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: loading states and skill/plugin/MCP/dynamic tool progress, results, errors, parameters and mobile bounds',
  );
} finally {
  await browser.close();
}

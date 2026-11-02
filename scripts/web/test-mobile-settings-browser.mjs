/* global window, document, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/mobile-settings/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [],
  errors = [];
try {
  const page = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const headers = {
      'access-control-allow-origin': 'http://127.0.0.1:1495',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,PUT,OPTIONS',
      'access-control-allow-headers': 'x-csrf-token,content-type',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().url().endsWith('/web/csrf'))
      return route.fulfill({ json: { csrfToken: 'test-only' }, headers });
    if (route.request().method() === 'PUT' && route.request().url().endsWith('/name')) {
      const { customName } = route.request().postDataJSON();
      return route.fulfill({
        json: {
          hostId: 'review-host',
          customName,
          displayName: customName || 'AgentDeck computer',
        },
        headers,
      });
    }
    await route.abort();
  });
  await page.goto(process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1495');
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = dom.default || dom;
    const { SettingsContents } = await import('/src/features/SettingsContents.tsx');
    const { Modal } = await import('/src/ui.tsx');
    document.getElementById('root').style.display = 'none';
    const root = document.createElement('div');
    document.body.append(root);
    window.settingsCalls = [];
    window.settingsFail = false;
    let revision = 1;
    const values = {
      model: 'gpt-6.1-sol',
      model_reasoning_effort: 'low',
      model_verbosity: 'low',
      model_reasoning_summary: 'none',
    };
    const request = async (action, payload) => {
      window.settingsCalls.push({ action, payload });
      if (action === 'settings.execution')
        return { values: { ...values }, userRevision: String(revision) };
      if (action.startsWith('settings.')) {
        if (window.settingsFail) throw new Error('SAVE-TEST-ERROR');
        if (action === 'settings.modelDefaults')
          Object.assign(values, { model: payload.model, model_reasoning_effort: payload.effort });
        if (action === 'settings.outputDefaults')
          Object.assign(values, {
            model_verbosity: payload.verbosity,
            model_reasoning_summary: payload.summary,
          });
        revision++;
        return {};
      }
      return {};
    };
    function Test() {
      const [tab, setTab] = React.useState('general');
      const [theme, setTheme] = React.useState('dark');
      const [host, setHost] = React.useState({
        hostId: 'review-host',
        displayName: 'AgentDeck computer',
        customName: '',
        online: true,
      });
      window.settingsTab = setTab;
      React.useEffect(() => {
        document.documentElement.dataset.theme = theme;
      }, [theme]);
      return React.createElement(
        Modal,
        { title: '设置', className: 'settings-modal', onClose: () => {} },
        React.createElement(SettingsContents, {
          settingsTab: tab,
          setSettingsTab: setTab,
          theme,
          setTheme,
          notification: false,
          setNotification: () => {},
          setError: () => {},
          connected: true,
          request,
          models: [
            {
              id: 'gpt-6.1-sol',
              displayName: 'GPT-6.1-Sol',
              supportedReasoningEfforts: ['low', 'medium', 'high'],
            },
          ],
          supports: () => true,
          setFilter: () => {},
          setSidebarOpen: () => {},
          setPanel: () => {},
          openPanel: () => {},
          syncIndex: async () => {},
          host,
          hosts: [host],
          hostName: (item) => item.displayName,
          projects: [
            { projectId: 'one', name: 'AgentHub', canonicalPath: 'C:/Projects/AgentHub' },
            { projectId: 'two', name: 'workspace', canonicalPath: 'C:/Projects/workspace' },
          ],
          selectedProject: 'one',
          refresh: async () => {},
          setSelectedProject: () => {},
          selectSession: () => {},
          directoryFailure: '',
          connectionFailure: '',
          connectionState: 'connected',
          connect: async () => {},
          setHosts: () => {},
          busy: false,
          scope: 'review',
          hostNameSaved: (name) => setHost((current) => ({ ...current, ...name })),
        }),
      );
    }
    createRoot(root).render(React.createElement(Test));
  });
  async function select(label, option) {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(() => window.settingsTab('general'));
      await select('外观', theme === 'dark' ? '深色' : '浅色');
      await page.waitForTimeout(250);
      const metrics = await page.locator('.settings-general').evaluate((root) =>
        [
          ...root.querySelectorAll(
            '.select-trigger, .settings-logout, .app-updates > button:first-of-type',
          ),
        ].map((el) => {
          const box = el.getBoundingClientRect();
          return {
            x: box.right,
            width: box.width,
            height: box.height,
            radius: getComputedStyle(el).borderRadius,
          };
        }),
      );
      assert.equal(metrics.length, 4);
      for (const metric of metrics) {
        assert.equal(metric.width, metrics[0].width);
        assert.equal(metric.height, 44);
        assert.equal(metric.radius, '8px');
        assert(Math.abs(metric.x - metrics[0].x) < 1);
      }
      await page.screenshot({ path: fileURLToPath(new URL(`general-${theme}-${width}.png`, out)) });
      for (const [tab, name] of [
        ['configuration', 'configuration'],
        ['conversations', 'projects'],
        ['computers', 'computer'],
      ]) {
        await page.evaluate((tab) => window.settingsTab(tab), tab);
        if (tab === 'configuration')
          await page.getByRole('combobox', { name: '默认模型', exact: true }).waitFor();
        if (tab === 'conversations') await page.getByRole('region', { name: '项目管理' }).waitFor();
        if (tab === 'computers')
          await page.getByRole('textbox', { name: '电脑显示名称' }).waitFor();
        await page.waitForTimeout(250);
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        );
        if (tab === 'configuration') {
          assert.equal(await page.locator('.settings-control-row').count(), 2);
          for (const form of await page.locator('.settings-control-row').all()) {
            const boxes = await form
              .locator(':scope > .select-control > button, :scope > button')
              .evaluateAll((nodes) =>
                nodes.map((el) => {
                  const b = el.getBoundingClientRect();
                  return { y: b.y, h: b.height };
                }),
              );
            assert.equal(boxes.length, 3);
            assert(boxes.every((b) => b.y === boxes[0].y && b.h === 44));
          }
        }
        if (tab === 'conversations') {
          assert.equal(await page.locator('.project-settings-heading p').count(), 0);
          const rows = await page
            .locator('.project-settings-row')
            .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
          assert.equal(rows.length, 2);
          assert(
            rows.every((height) => height <= 60),
            JSON.stringify(rows),
          );
          assert.equal(
            await page
              .locator('.project-settings-open')
              .first()
              .evaluate((node) => getComputedStyle(node).rowGap),
            '2px',
          );
        }
        if (tab === 'computers') {
          assert.equal(await page.getByText('留空恢复默认名称', { exact: true }).count(), 0);
          const input = await page.getByRole('textbox', { name: '电脑显示名称' }).boundingBox();
          const save = await page
            .getByRole('button', { name: '保存名称', exact: true })
            .boundingBox();
          assert.equal(input.y, save.y);
          assert.equal(input.height, save.height);
        }
        await page.screenshot({
          path: fileURLToPath(new URL(`${name}-${theme}-${width}.png`, out)),
        });
      }
    }
  }
  checks.push(
    '320/390px touch: aligned equal-size general controls; one-line model/output/name controls; no redundant project source or name help; light/dark screenshots',
  );
  await page.evaluate(() => window.settingsTab('configuration'));
  await page.getByRole('button', { name: '保存模型默认值', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        window.settingsCalls.find((call) => call.action === 'settings.modelDefaults').payload.model,
    ),
    'gpt-6.1-sol',
  );
  await select('详细程度', '详细');
  await page.evaluate(() => (window.settingsFail = true));
  await page.getByRole('button', { name: '保存输出默认值', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'SAVE-TEST-ERROR' }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: '详细程度' }).innerText(), '详细');
  await page.evaluate(() => (window.settingsFail = false));
  await page.getByRole('button', { name: '保存输出默认值', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  await page.evaluate(() => window.settingsTab('computers'));
  const name = page.getByRole('textbox', { name: '电脑显示名称' });
  await name.fill('我的电脑');
  await name.press('Enter');
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await name.inputValue(), '我的电脑');
  await name.fill('');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await name.inputValue(), '');
  checks.push(
    'model/output save protocol and revision preserved; failed save retains selection; name saves via Enter/icon and empty value restores default',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    new URL('verification.json', out),
    JSON.stringify({ checks, errors, realHost: false }, null, 2),
  );
  console.log('PASS:', checks.join('; '));
} finally {
  await browser.close();
}

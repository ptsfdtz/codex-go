import { fileURLToPath } from 'node:url';
/* global window, document, localStorage, navigator, Event, StorageEvent */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.I18N_TEST_ORIGIN || 'http://127.0.0.1:1434/';
const out = new URL('../../artifacts/i18n/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const errors = [],
  checks = [];
async function observe(page) {
  page.setDefaultTimeout(9000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (request) => {
    if (request.url().includes('/api/'))
      console.log('request failed', request.url(), request.failure());
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, (route) => route.abort());
}
async function choose(page, label, option) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
try {
  for (const [locale, login, language] of [
    ['en-US', 'Sign in', 'Language'],
    ['zh-CN', '登录', '语言'],
  ]) {
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    await observe(page);
    await page.route('**/api/**', (route) =>
      route.fulfill({
        status: 401,
        json: { code: 'UNAUTHORIZED', message: '登录已失效或凭据无效' },
      }),
    );
    await page.goto(origin);
    await page.getByRole('button', { name: login, exact: true }).waitFor();
    assert.equal(
      await page.locator('html').getAttribute('lang'),
      locale === 'zh-CN' ? 'zh-CN' : 'en',
    );
    const username = page.getByRole('textbox').first();
    await username.fill('Keep my username 用户');
    await choose(page, language, locale === 'en-US' ? '简体中文' : 'English');
    assert.equal(await username.inputValue(), 'Keep my username 用户');
    await page
      .getByRole('button', { name: locale === 'en-US' ? '登录' : 'Sign in', exact: true })
      .waitFor();
    await page.reload();
    assert.equal(
      await page.locator('html').getAttribute('lang'),
      locale === 'en-US' ? 'zh-CN' : 'en',
    );
    await context.close();
  }
  checks.push(
    'System language, login language picker, form preservation, explicit language persistence',
  );

  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 850 },
  });
  const page = await context.newPage();
  await observe(page);
  let ready = false;
  await context.addInitScript(() => localStorage.setItem('agentdeck.web.work-mode', '"codex"'));
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const value = path.endsWith('/web/session')
      ? { accountId: 'i18n-test', cloudDeviceId: 'browser', mustChangePassword: false }
      : path.endsWith('/web/csrf')
        ? { csrfToken: 'test' }
        : path.endsWith('/hosts')
          ? { hosts: [{ hostId: 'host-test', displayName: '电脑 My Host', online: true }] }
          : path.endsWith('/access')
            ? {
                hostId: 'host-test',
                fingerprint: 'a'.repeat(64),
                credential: 'b'.repeat(43),
                endpoints: [],
              }
            : {};
    return route.fulfill({
      status: route.request().method() === 'OPTIONS' ? 204 : ready ? 200 : 401,
      headers: {
        'access-control-allow-origin': new URL(origin).origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'content-type,x-csrf-token',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      },
      ...(route.request().method() === 'OPTIONS' ? {} : { json: value }),
    });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  ready = true;
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Bridge } = await import('/src/transport/bridge.ts');
    const { App } = await import('/src/App.tsx');
    window.localeApi = await import('/src/i18n/index.ts');
    window.calls = [];
    window.testSnapshot = {
      cursor: '1',
      projects: [{ projectId: 'p', name: '项目 <b>{{p0}}</b>' }],
      sessions: [
        { sessionId: 'main', projectId: 'p', title: '我的对话 User content', status: 'idle' },
        { sessionId: 'other', projectId: 'p', title: '后台对话', status: 'idle' },
      ],
      turns: [],
      approvals: [],
    };
    Bridge.prototype.connect = async function () {
      window.testBridge = this;
      this.hostId = 'host-test';
    };
    Bridge.prototype.probe = async () => undefined;
    Bridge.prototype.reconcile = async () => undefined;
    Bridge.prototype.request = async function (action, payload) {
      window.calls.push({ action, payload });
      if (action === 'snapshot.get') return structuredClone(window.testSnapshot);
      if (action === 'events.replay') return { events: [], cursor: '1', hasMore: false };
      if (action === 'system.capabilities')
        return { features: { sessionManagement: true, fileWorkspace: true } };
      if (action === 'models.list')
        return { models: [{ id: 'm', model: 'model-id', name: 'Model 标识', isDefault: true }] };
      if (action === 'sessions.history') return { data: [] };
      return {};
    };
    localStorage.setItem('agentdeck.web.selection.i18n-test:browser.host-test', 'main');
    document.getElementById('root').style.display = 'none';
    const fixture = document.createElement('main');
    document.body.append(fixture);
    window.testRoot = (dom.default || dom).createRoot(fixture);
    window.testRoot.render(React.createElement(App));
  });
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.waitFor().catch(async (error) => {
    console.log(await page.locator('body').innerText());
    console.log(await page.evaluate(() => window.calls));
    console.log(errors);
    throw error;
  });
  await page
    .waitForFunction(
      () => [...document.querySelectorAll('textarea')].some((node) => !node.disabled),
      { timeout: 9000 },
    )
    .catch(async (error) => {
      console.log(await page.locator('body').innerText());
      console.log(await page.evaluate(() => window.calls));
      throw error;
    });
  await input.fill('草稿 {{p0}} <b>keep</b> draft');
  await input.evaluate((node) => {
    window.originalComposer = node;
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('dialog').evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished));
  });
  await choose(page, 'Language', '简体中文');
  await page.getByRole('navigation', { name: '设置分类', exact: true }).waitFor();
  await page.getByRole('button', { name: '电脑', exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  const chineseInput = page.locator('textarea:visible').first();
  assert.equal(await chineseInput.inputValue(), '草稿 {{p0}} <b>keep</b> draft');
  assert(
    await chineseInput.evaluate((node) => node === window.originalComposer),
    'Language switching must not remount the composer',
  );
  await page
    .getByRole('button', { name: '更多操作 我的对话 User content', exact: true })
    .first()
    .click();
  await page.getByRole('menuitem', { name: '归档会话', exact: true }).waitFor();
  await page.evaluate(() => window.localeApi.setLanguagePreference('en'));
  await page.getByRole('menuitem', { name: 'Archive conversation', exact: true }).waitFor();
  assert.equal(await chineseInput.inputValue(), '草稿 {{p0}} <b>keep</b> draft');
  await page.keyboard.press('Escape');
  assert.equal(
    await page.locator('.project-group').first().locator('b').count(),
    0,
    'Project names are escaped text',
  );
  await page.evaluate(() => {
    const packet = {
      type: 'event',
      eventId: '2',
      action: 'turn.completed',
      sessionId: 'other',
      turnId: 't',
      payload: { turn: { turnId: 't', upstreamTurnId: 'n', status: 'completed' } },
    };
    [...window.testBridge.events].forEach((listener) => listener(packet));
  });
  await page.locator('[data-session-id="other"] .session-unread-dot').first().waitFor();
  assert.equal(await page.getByRole('region', { name: 'Task notifications' }).count(), 0);
  assert.equal(
    await page
      .locator('[data-session-id="other"] .session')
      .first()
      .getAttribute('aria-description'),
    'Task completed, unread notifications',
  );
  await page.evaluate(() => window.localeApi.setLanguagePreference('zh-CN'));
  assert.equal(await page.getByRole('region', { name: '任务提醒' }).count(), 0);
  assert.equal(
    await page
      .locator('[data-session-id="other"] .session')
      .first()
      .getAttribute('aria-description'),
    '任务已完成，有未读提醒',
  );
  checks.push(
    'Live App/settings/menu/status/notification labels; composer DOM and unsent draft preserved; user names remain text',
  );

  // Real lazy-loaded feature modules, including module-level label getters.
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = dom.default || dom;
    const { BranchComparison } = await import('/src/features/files/BranchComparison.tsx');
    const { SettingsLayout } = await import('/src/features/SettingsLayout.tsx');
    const { LanguageSelect } = await import('/src/i18n/LanguageSelect.tsx');
    const fixture = document.createElement('section');
    fixture.id = 'lazy-language-test';
    document.body.append(fixture);
    createRoot(fixture).render(
      React.createElement(
        SettingsLayout,
        { active: 'general', onChange() {} },
        React.createElement(LanguageSelect),
        React.createElement(BranchComparison, {
          supported: false,
          projectId: 'p',
          request: async () => ({}),
        }),
      ),
    );
  });
  await page
    .locator('#lazy-language-test')
    .getByText('当前电脑尚不支持分支比较，请升级 Host。')
    .waitFor();
  await page.evaluate(() => window.localeApi.setLanguagePreference('en'));
  await page
    .locator('#lazy-language-test')
    .getByText('This computer does not support branch comparison. Update Host.')
    .waitFor();
  await page
    .locator('#lazy-language-test')
    .getByRole('button', { name: 'Projects', exact: true })
    .waitFor();
  await page.evaluate(() => document.getElementById('lazy-language-test').remove());
  assert.equal(
    await page.evaluate(() => window.localeApi.errorText('UNAUTHORIZED: 登录已失效或凭据无效')),
    'UNAUTHORIZED: Your session expired or credentials are invalid',
  );
  assert.equal(
    await page.evaluate(() => window.localeApi.errorText('会话历史读取失败：保留 <b>{{p0}}</b>')),
    'Failed to read conversation history: 保留 <b>{{p0}}</b>',
  );
  assert.equal(
    await page.evaluate(() => window.localeApi.errorText('私有供应商错误 ABC')),
    '私有供应商错误 ABC',
  );
  assert.equal(
    await page.evaluate(() => window.localeApi.t('files.changed', { count: 1 })),
    '1 file changed',
  );
  assert.equal(
    await page.evaluate(() =>
      window.localeApi.t('remove.project.confirm', { name: '<b>{{name}} 用户</b>' }),
    ),
    'Remove “<b>{{name}} 用户</b>”?',
  );
  checks.push(
    'Lazy feature switching, labels declared at module scope, plurals, safe interpolation, localized errors with stable codes',
  );

  const second = await context.newPage();
  await observe(second);
  await second.route('**/api/**', (route) => route.fulfill({ status: 401, json: {} }));
  await second.goto(origin);
  await second.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  await choose(second, 'Language', '简体中文');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await page.evaluate(() => {
    localStorage.removeItem('agentdeck.language');
    window.dispatchEvent(new StorageEvent('storage', { key: 'agentdeck.language' }));
  });
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['zh-CN'] });
    window.dispatchEvent(new Event('languagechange'));
  });
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await second.close();
  checks.push('Cross-tab preference sync, storage clear, system languagechange');

  await page.evaluate(() => window.localeApi.setLanguagePreference('en'));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await page.waitForTimeout(250);
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      'No page overflow',
    );
    await page.screenshot({ path: fileURLToPath(new URL(`settings-en-${width}.png`, out)) });
  }
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter(({ action }) => /turn\.start|turn\.steer|approval\.decide/.test(action))
          .length,
    ),
    0,
  );
  checks.push('English settings at 320/390/1280px; no mutation caused by language switches');
  await context.close();

  // Serve actual admin assets in isolation; never connect to a production account.
  const admin = await browser.newPage({ locale: 'en-US', viewport: { width: 1100, height: 850 } });
  await observe(admin);
  await admin.route('**/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/')) return route.fallback();
    let file =
      path === '/admin/'
        ? 'server/admin/index.html'
        : path.startsWith('/admin/locales/')
          ? 'web/src/i18n/' + path.split('/').at(-1)
          : 'server/admin/' + path.split('/').at(-1);
    const contentType = file.endsWith('.js')
      ? 'application/javascript'
      : file.endsWith('.json')
        ? 'application/json'
        : file.endsWith('.css')
          ? 'text/css'
          : 'text/html';
    await route.fulfill({
      contentType,
      body: await readFile(new URL('../../' + file, import.meta.url), 'utf8'),
    });
  });
  await admin.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const value = path.endsWith('/session')
      ? { username: '管理员 User', accountId: 'a', mustChangePassword: false }
      : path.endsWith('/status')
        ? { connections: { onlineHosts: 1, tunnels: 1, maxTunnels: 4, relayedBytes: 2048 } }
        : path.endsWith('/accounts')
          ? {
              accounts: [
                {
                  accountId: 'a',
                  username: '保留 Name',
                  role: 'admin',
                  maxHosts: 4,
                  maxMobileDevices: 4,
                  maxTunnels: 4,
                  bandwidthBytesPerSecond: 1048576,
                },
              ],
            }
          : { devices: [], entries: [] };
    return route.fulfill({ json: value });
  });
  await admin.goto(new URL('admin/', origin).href);
  await admin.getByRole('button', { name: 'Create account', exact: true }).click();
  const adminUser = admin.getByRole('dialog').locator('input[name="username"]');
  await adminUser.fill('Keep_user');
  await admin.locator('#language').selectOption('zh-CN');
  await admin.getByRole('dialog').getByRole('heading', { name: '创建账户', exact: true }).waitFor();
  assert.equal(await adminUser.inputValue(), 'Keep_user');
  await admin.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await admin.locator('#language').selectOption('en');
  await admin.getByRole('button', { name: 'Edit', exact: true }).click();
  await admin
    .getByRole('dialog')
    .getByRole('heading', { name: 'Edit 保留 Name', exact: true })
    .waitFor();
  await admin.locator('input[name="maxHosts"]').fill('7');
  await admin.locator('#language').selectOption('zh-CN');
  await admin
    .getByRole('dialog')
    .getByRole('heading', { name: '编辑 保留 Name', exact: true })
    .waitFor();
  assert.equal(await admin.locator('input[name="maxHosts"]').inputValue(), '7');
  await admin.getByRole('dialog').getByText('最多电脑数', { exact: true }).waitFor();
  await admin.screenshot({ path: fileURLToPath(new URL('admin-zh.png', out)) });
  await admin.close();
  checks.push(
    'Actual admin HTML/JS/shared catalogs; static/dynamic labels and open editor update without losing form values',
  );

  assert.deepEqual(errors, []);
  await writeFile(new URL('results.json', out), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}

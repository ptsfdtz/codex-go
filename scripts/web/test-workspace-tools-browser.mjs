import { fileURLToPath } from 'node:url';
/* global window, document, localStorage, TextEncoder, btoa, StorageEvent, getComputedStyle, navigator */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/workspace-tools/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const checks = [],
  errors = [];
let activePage;
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 960 } });
  activePage = page;
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => errors.push(e.message));
  let ready = false;
  // All account and Host data are controlled fixtures; no production request or model call.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, (route) => route.abort());
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let value;
    if (path.endsWith('/web/session'))
      value = { accountId: 'tools-test', cloudDeviceId: 'browser', mustChangePassword: false };
    else if (path.endsWith('/web/csrf')) value = { csrfToken: 'test-only' };
    else if (path === '/api/v1/hosts')
      value = {
        hosts: [
          {
            hostId: 'host-test',
            displayName: 'Test Host',
            customNameConfigured: true,
            online: true,
          },
        ],
      };
    else if (path.endsWith('/access'))
      value = {
        hostId: 'host-test',
        fingerprint: 'a'.repeat(64),
        credential: 'b'.repeat(43),
        endpoints: [],
      };
    else value = {};
    await route.fulfill({
      status: ready ? 200 : 401,
      json: value,
      headers: {
        'access-control-allow-origin': route.request().headers().origin || 'http://127.0.0.1:1495',
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'x-csrf-token,content-type',
        'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      },
    });
  });
  await page.goto(process.env.WORKSPACE_TOOLS_TEST_ORIGIN || 'http://127.0.0.1:1495/');
  await page.getByRole('button', { name: '登录', exact: true }).waitFor();
  ready = true;
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Bridge } = await import('/src/transport/bridge.ts');
    window.calls = [];
    window.sshOutput = 'Project test terminal\r\n';
    window.sshInput = '';
    window.sshClosed = 0;
    window.failNext = false;
    window.testSnapshot = {
      cursor: '1',
      projects: [
        { projectId: 'p1', name: 'Project one', canonicalPath: '/test/p1' },
        { projectId: 'p2', name: 'Project two', canonicalPath: '/test/p2' },
      ],
      sessions: [
        { sessionId: 'main', projectId: 'p1', title: 'Primary conversation', status: 'idle' },
        { sessionId: 'side', projectId: 'p1', title: 'Side conversation', status: 'idle' },
      ],
      turns: [],
      approvals: [],
    };
    window.testHistory = {
      main: [
        {
          turnId: 'native-main',
          item: {
            id: 'msg-main',
            type: 'agentMessage',
            text: 'PRIMARY-HISTORY',
            status: 'inProgress',
          },
        },
      ],
      side: [
        {
          turnId: 'native-side',
          item: {
            id: 'msg-side',
            type: 'agentMessage',
            text: 'SIDE-HISTORY',
            status: 'inProgress',
          },
        },
      ],
    };
    window.emit = (packet) => {
      packet.type = 'event';
      packet.eventId = String(Number(window.testSnapshot.cursor) + 1);
      window.testSnapshot.cursor = packet.eventId;
      for (const handler of [...window.testBridge.events]) handler(packet);
    };
    Bridge.prototype.connect = async function () {
      window.testBridge = this;
      this.hostId = 'host-test';
    };
    Bridge.prototype.probe = async () => undefined;
    Bridge.prototype.reconcile = async () => undefined;
    Bridge.prototype.request = async function (action, payload = {}) {
      window.calls.push({ action, payload });
      if (action === 'snapshot.get') return structuredClone(window.testSnapshot);
      if (action === 'events.replay')
        return { events: [], cursor: window.testSnapshot.cursor, hasMore: false };
      if (action === 'system.capabilities')
        return {
          features: {
            projectFileBrowser: true,
            projectTextPreview: true,
            gitRead: true,
            sessionManagement: true,
            sessionFork: true,
            attachments: true,
            activeTurnSteering: true,
            externalThreadObservation: true,
            latestUpstreamTurn: true,
            projectTerminal: window.sshSupported !== false,
          },
        };
      if (action === 'models.list')
        return {
          models: [{ id: 'test-model', model: 'test-model', name: 'Test model', isDefault: true }],
        };
      if (action === 'sessions.history')
        return structuredClone({
          data: [...(window.testHistory[payload.sessionId] || [])].reverse(),
        });
      if (action === 'files.list')
        return { entries: [{ path: 'README.md', name: 'README.md', kind: 'file', size: 20 }] };
      if (action === 'files.readText') return { text: '# File preview from Host', size: 24 };
      if (action === 'git.status') return { available: true, files: [] };
      if (action === 'sessions.create') {
        const session = {
          sessionId: 'created-' + window.testSnapshot.sessions.length,
          projectId: payload.projectId,
          title: payload.title,
          status: 'idle',
        };
        window.testSnapshot.sessions.push(session);
        window.testHistory[session.sessionId] = [];
        return { session };
      }
      if (
        ['sessions.rename', 'sessions.pin', 'sessions.archive', 'sessions.restore'].includes(action)
      ) {
        const item = window.testSnapshot.sessions.find((s) => s.sessionId === payload.sessionId);
        if (action === 'sessions.rename') item.title = payload.title;
        if (action === 'sessions.pin') item.pinned = payload.pinned ? 1 : 0;
        if (action === 'sessions.archive') item.archived = 1;
        if (action === 'sessions.restore') item.archived = 0;
        return {};
      }
      if (action === 'sessions.fork') {
        const original = window.testSnapshot.sessions.find(
          (s) => s.sessionId === payload.sessionId,
        );
        const session = { ...original, sessionId: 'forked', title: 'Forked conversation' };
        window.testSnapshot.sessions.push(session);
        window.testHistory.forked = structuredClone(window.testHistory[payload.sessionId]);
        return { session };
      }
      if (action === 'turn.start') {
        if (window.failNext) {
          window.failNext = false;
          localStorage.setItem(
            'agentdeck.web.receipts.tools-test:browser.host-test',
            '["unknown-test"]',
          );
          throw new Error('Host request timed out; outcome may be unknown');
        }
        const turn = {
          sessionId: payload.sessionId,
          turnId: 'bridge-' + payload.sessionId,
          upstreamTurnId: 'native-' + payload.sessionId,
          status: 'running',
        };
        window.testSnapshot.turns.push(turn);
        window.testHistory[payload.sessionId].push({
          turnId: turn.upstreamTurnId,
          item: {
            id: 'user-' + window.calls.length,
            type: 'userMessage',
            content: [{ type: 'inputText', text: payload.text }],
          },
        });
        return { turn };
      }
      if (action === 'turn.latest') {
        const turn = window.testSnapshot.turns.find((t) => t.sessionId === payload.sessionId);
        return { turn: turn ? { ...turn, status: 'inProgress' } : null };
      }
      if (action === 'turn.active') return { upstreamTurnId: 'native-' + payload.sessionId };
      if (action === 'terminal.open') {
        window.sshId = payload.terminalId;
        return { terminalId: payload.terminalId };
      }
      if (action === 'terminal.read') {
        const bytes = new TextEncoder().encode(window.sshOutput);
        return {
          data: btoa(String.fromCharCode(...bytes.slice(payload.offset))),
          offset: bytes.length,
          truncated: false,
          eof: false,
        };
      }
      if (action === 'terminal.write') {
        window.sshInput += payload.data;
        window.sshOutput += payload.data;
        return { sequence: payload.sequence + 1 };
      }
      if (action === 'terminal.close') {
        window.sshClosed++;
        return { closed: true };
      }
      if (action === 'terminal.resize') return { resized: true };
      return {};
    };
    localStorage.setItem('agentdeck.web.selection.tools-test:browser.host-test', 'main');
    document.getElementById('root').style.display = 'none';
    const el = document.createElement('main');
    el.id = 'tools-test';
    document.body.append(el);
    const root = (dom.default || dom).createRoot(el);
    const { App } = await import('/src/App.tsx');
    root.render(React.createElement(App));
  });
  const host = page.locator('#tools-test');
  const primary = host.locator('.conversation-layout > .conversation');
  const mainInput = primary.getByRole('textbox', { name: '消息', exact: true });
  await primary.getByText('PRIMARY-HISTORY', { exact: true }).waitFor();
  await mainInput.fill('PRIMARY-DRAFT');
  await host.getByRole('button', { name: '打开工具', exact: true }).click();
  await host.getByRole('region', { name: '工具', exact: true }).waitFor();
  await page.waitForTimeout(350);
  assert.equal(await host.locator('.tools-menu').count(), 0);
  assert(await host.getByRole('tab', { name: '新标签页', exact: true }).isVisible());
  await page.screenshot({ path: fileURLToPath(new URL('launcher.png', out)) });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await page.waitForTimeout(180);
  await page.screenshot({ path: fileURLToPath(new URL('launcher-dark.png', out)) });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await host
    .locator('.tools-grid')
    .getByRole('button', { name: /侧边对话/ })
    .click();
  const side = host.getByRole('region', { name: '侧边对话', exact: true });
  const sideInput = side.getByRole('textbox', { name: '消息', exact: true });
  await sideInput.fill('NEW-SIDE-DRAFT');
  const headerControls = await side.locator('.side-chat-header').evaluate((el) =>
    [...el.querySelectorAll('button')].map((button) => ({
      height: button.getBoundingClientRect().height,
      radius: getComputedStyle(button).borderRadius,
    })),
  );
  assert(
    headerControls.every((control) => control.height === 32 && control.radius === '8px'),
    JSON.stringify(headerControls),
  );
  checks.push('side header dropdowns and icon buttons share 32px height and 8px corners');
  async function choose(label, option, value) {
    const select = side.getByRole('combobox', { name: label, exact: true });
    if ((await select.evaluate((el) => el.tagName)) === 'SELECT') await select.selectOption(value);
    else {
      await select.click();
      await page.getByRole('option', { name: option, exact: true }).click();
    }
  }
  await choose('侧边会话', 'Side conversation', 'side');
  await side.getByText('SIDE-HISTORY', { exact: true }).waitFor();
  await sideInput.fill('SIDE-DRAFT');
  assert.equal(await mainInput.inputValue(), 'PRIMARY-DRAFT');
  await page.evaluate(() => {
    window.testHistory.main[0].item.text += '-LIVE';
    window.testHistory.side[0].item.text += '-LIVE';
    window.emit({
      sessionId: 'main',
      action: 'turn.progress',
      payload: {
        upstreamTurnId: 'native-main',
        itemId: 'msg-main',
        method: 'item/agentMessage/delta',
        delta: '-LIVE',
      },
    });
    window.emit({
      sessionId: 'side',
      action: 'turn.progress',
      payload: {
        upstreamTurnId: 'native-side',
        itemId: 'msg-side',
        method: 'item/agentMessage/delta',
        delta: '-LIVE',
      },
    });
  });
  await primary.getByText('PRIMARY-HISTORY-LIVE', { exact: true }).waitFor();
  await side.getByText('SIDE-HISTORY-LIVE', { exact: true }).waitFor();
  assert.equal(await primary.getByText('SIDE-HISTORY-LIVE', { exact: true }).count(), 0);
  assert.equal(await side.getByText('PRIMARY-HISTORY-LIVE', { exact: true }).count(), 0);
  checks.push(
    'two conversations stream independently with isolated drafts and native item identities',
  );
  assert.ok(
    (await side.locator('.side-chat-header').boundingBox()).y < 80,
    'side header must sit directly below tool tabs',
  );
  await page.screenshot({ path: fileURLToPath(new URL('two-chats-desktop.png', out)) });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.screenshot({ path: fileURLToPath(new URL('two-chats-dark.png', out)) });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  const nav = host.getByRole('tablist', { name: '工作区工具', exact: true });
  await host.getByRole('button', { name: '新建工具标签页' }).click();
  await host.locator('.tools-grid').getByRole('button', { name: /文件/ }).click();
  await host.getByRole('treeitem', { name: /README.md/ }).dblclick();
  await host.getByText('# File preview from Host', { exact: true }).waitFor();
  await nav.getByRole('tab', { name: '侧边对话', exact: true }).click();
  assert.equal(await sideInput.inputValue(), 'SIDE-DRAFT');
  await host.getByRole('button', { name: '关闭工具栏' }).click();
  await host.getByRole('button', { name: '打开工具', exact: true }).click();
  assert.equal(await sideInput.inputValue(), 'SIDE-DRAFT');
  checks.push('file preview, tab switching and closing/reopening preserve side drafts');
  await side.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() =>
    window.calls.some(
      (c) =>
        c.action === 'turn.start' &&
        c.payload.sessionId === 'side' &&
        c.payload.text === 'SIDE-DRAFT',
    ),
  );
  await page.waitForFunction(
    () => document.querySelector('.side-chat textarea[aria-label="消息"]').value === '',
  );
  assert.equal(await mainInput.inputValue(), 'PRIMARY-DRAFT');
  await side.getByRole('button', { name: '新建侧边对话', exact: true }).click();
  assert.equal(await sideInput.inputValue(), 'NEW-SIDE-DRAFT');
  await sideInput.fill('CREATE-SIDE');
  await side.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() =>
    window.calls.some(
      (c) =>
        c.action === 'turn.start' &&
        c.payload.sessionId.startsWith('created-') &&
        c.payload.text === 'CREATE-SIDE',
    ),
  );
  assert.equal(await mainInput.inputValue(), 'PRIMARY-DRAFT');
  checks.push('existing and new side conversations send to their own sessions');
  await page.evaluate(() => {
    const id = window.testSnapshot.sessions.at(-1).sessionId;
    window.testSnapshot.approvals = [
      {
        approvalId: 'side-approval',
        sessionId: id,
        turnId: 'bridge-' + id,
        method: 'item/commandExecution/requestApproval',
        status: 'pending',
        context: { command: 'printf test' },
        allowedDecisions: ['approve', 'reject'],
      },
    ];
  });
  await side.getByRole('button', { name: '刷新侧边对话', exact: true }).click();
  await side.getByRole('button', { name: '允许一次', exact: true }).click();
  await side.getByRole('button', { name: '确认允许一次', exact: true }).click();
  await page.waitForFunction(() =>
    window.calls.some(
      (c) =>
        c.action === 'approvals.decide' &&
        c.payload.approvalId === 'side-approval' &&
        c.payload.sessionId === 'created-2' &&
        c.payload.decision === 'approve',
    ),
  );
  assert.equal(await primary.getByRole('button', { name: '允许一次', exact: true }).count(), 0);
  checks.push('side approval confirmation sends the side session and turn identities');
  assert.equal(await page.getByRole('region', { name: '任务提醒', exact: true }).count(), 0);
  await page.evaluate(() => {
    window.testSnapshot.approvals = [];
  });

  await side.getByRole('button', { name: '新建侧边对话', exact: true }).click();
  await sideInput.fill('UNKNOWN-SEND');
  await page.evaluate(() => {
    window.failNext = true;
  });
  await side.getByRole('button', { name: '发送', exact: true }).click();
  await side.getByText(/上一条发送结果曾不确定/).waitFor();
  await page.evaluate(() => {
    localStorage.removeItem('agentdeck.web.receipts.tools-test:browser.host-test');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'agentdeck.web.receipts.tools-test:browser.host-test' }),
    );
  });
  assert.equal(await side.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  const unknownCalls = await page.evaluate(
    () =>
      window.calls.filter((c) => c.action === 'turn.start' && c.payload.text === 'UNKNOWN-SEND')
        .length,
  );
  assert.equal(unknownCalls, 1);
  await side.getByRole('button', { name: '已核对，继续编辑草稿' }).click();
  checks.push(
    'unknown sends retain drafts, block resending after receipt reconciliation and require explicit review',
  );
  await host.getByRole('button', { name: '新建工具标签页' }).click();
  await host.locator('.tools-grid').getByRole('button', { name: /终端/ }).click();
  assert.equal(await host.getByLabel('主机 / SSH 别名').count(), 0);
  await host
    .locator('.ssh-status')
    .getByText(/终端已启动/)
    .waitFor();
  await host.getByRole('button', { name: 'Ctrl+C', exact: true }).click();
  await page.waitForFunction(() => window.sshInput.includes('\x03'));
  const ssh = host.locator('.ssh-screen textarea');
  await ssh.focus();
  await page.keyboard.type('whoami');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.sshInput.includes('whoami\r'));
  const opens = await page.evaluate(
    () => window.calls.filter((c) => c.action === 'terminal.open').length,
  );
  await nav.getByRole('tab', { name: '侧边对话', exact: true }).click();
  await nav.getByRole('tab', { name: '终端', exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.action === 'terminal.open').length),
    opens,
  );
  const opened = await page.evaluate(
    () => window.calls.find((c) => c.action === 'terminal.open').payload,
  );
  assert.equal(opened.projectId, 'p1');
  assert.equal('host' in opened, false);
  checks.push(
    'Project shell automatically opens without SSH configuration; inputs, Ctrl+C and tool switching use one terminal without replay',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await host.locator('.ssh-status').waitFor();
  await page.waitForFunction(() =>
    window.calls.some((c) => c.action === 'terminal.resize' && c.payload.cols < 70),
  );
  await page.screenshot({ path: fileURLToPath(new URL('ssh-mobile.png', out)) });
  assert.equal(await primary.isVisible(), false);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
    false,
  );
  await nav.getByRole('tab', { name: '侧边对话', exact: true }).click();
  await page.screenshot({ path: fileURLToPath(new URL('side-chat-mobile.png', out)) });
  assert.equal(await side.isVisible(), true);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.waitForTimeout(180);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
    false,
  );
  await page.screenshot({ path: fileURLToPath(new URL('tabs-320.png', out)) });
  await host.getByRole('button', { name: '关闭工具栏' }).click();
  assert.equal(await page.evaluate(() => window.sshClosed), 0);
  await primary.getByRole('button', { name: '更多操作', exact: true }).click();
  await primary.getByRole('menuitem', { name: '更多操作', exact: true }).click();
  await primary.getByRole('menuitem', { name: '工具', exact: true }).click();
  await host.getByRole('button', { name: '关闭标签页：终端', exact: true }).click();
  await page.waitForFunction(() => window.sshClosed > 0);
  await host.getByRole('button', { name: '关闭工具栏' }).click();
  assert.equal(await primary.isVisible(), true);
  checks.push(
    '390px layout switches between main and tools; hiding tools preserves SSH; closing its tab closes SSH',
  );
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => {
    window.sshSupported = false;
    window.testBridge.close();
  });
  await host.getByRole('button', { name: '打开工具', exact: true }).click();
  await host.getByRole('button', { name: '新建工具标签页' }).click();
  await host.locator('.tools-grid').getByRole('button', { name: /终端/ }).click();
  await host
    .getByText('当前 Host 尚不支持项目终端，请升级 Host 后使用。', { exact: true })
    .waitFor();
  // Two instances of the same tool have independent form state.
  await host.getByRole('button', { name: '新建工具标签页' }).click();
  await host
    .locator('.tools-grid')
    .getByRole('button', { name: /侧边对话/ })
    .click();
  const secondSide = host.locator('.tool-tab-panel:not([hidden]) .side-chat');
  await secondSide.getByRole('textbox', { name: '消息', exact: true }).fill('SECOND-TAB-DRAFT');
  await host.getByRole('button', { name: '新建工具标签页' }).click();
  await host
    .locator('.tools-grid')
    .getByRole('button', { name: /侧边对话/ })
    .click();
  const thirdSide = host.locator('.tool-tab-panel:not([hidden]) .side-chat');
  assert.equal(
    await thirdSide.getByRole('textbox', { name: '消息', exact: true }).inputValue(),
    '',
  );
  await thirdSide.getByRole('textbox', { name: '消息', exact: true }).fill('THIRD-TAB-DRAFT');
  const chatTabs = nav.getByRole('tab', { name: '侧边对话', exact: true });
  await chatTabs.nth(1).click();
  assert.equal(
    await host.locator('.tool-tab-panel:not([hidden]) textarea[aria-label="消息"]').inputValue(),
    'SECOND-TAB-DRAFT',
  );
  await page.screenshot({ path: fileURLToPath(new URL('multiple-tabs.png', out)) });
  await chatTabs.nth(2).click();
  assert.equal(
    await host.locator('.tool-tab-panel:not([hidden]) textarea[aria-label="消息"]').inputValue(),
    'THIRD-TAB-DRAFT',
  );
  await nav.getByRole('tab', { name: '终端', exact: true }).click();
  checks.push('multiple same-tool tabs preserve independent new conversation drafts');
  const openCount = await page.evaluate(
    () => window.calls.filter((c) => c.action === 'terminal.open').length,
  );
  await page.evaluate(() => {
    window.sshSupported = true;
    window.testBridge.close();
  });
  await host.getByRole('button', { name: '启动终端', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.action === 'terminal.open').length),
    openCount,
  );
  checks.push('old Hosts show an upgrade message; reconnecting never restarts SSH');
  await host.getByRole('button', { name: '新建工具标签页' }).click();
  await host.locator('.tools-grid').getByRole('button', { name: /文件/ }).click();
  const activeFileTab = await nav.getByRole('tab', { selected: true }).getAttribute('id');
  await page.keyboard.press('Control+p');
  assert.equal(await nav.getByRole('tab', { selected: true }).getAttribute('id'), activeFileTab);
  assert.equal(await nav.getByRole('tab', { name: '文件', exact: true }).count(), 2);
  checks.push('same-project file tabs remain independent; shortcuts reuse the active instance');
  // Keyboard tabs and closing the final tab return to an actual launcher page.
  const terminalTab = nav.getByRole('tab', { name: '终端', exact: true });
  await terminalTab.focus();
  await terminalTab.press('Home');
  assert.equal(await nav.getByRole('tab').first().getAttribute('aria-selected'), 'true');
  await page.keyboard.press('End');
  assert.equal(await nav.getByRole('tab').last().getAttribute('aria-selected'), 'true');
  while ((await nav.locator('.tool-tab-close').count()) > 1)
    await nav.locator('.tool-tab-close').last().click();
  await nav.locator('.tool-tab-close').last().click();
  await host.getByRole('region', { name: '工具', exact: true }).waitFor();
  assert.equal(await nav.getByRole('tab').count(), 1);
  assert.equal(await nav.getByRole('tab').innerText(), '新标签页');
  checks.push('tab keyboard navigation, individual closure and final-tab launcher');
  await host.getByRole('button', { name: '关闭工具栏', exact: true }).click();
  const more = primary.getByRole('button', { name: '更多操作', exact: true });
  await more.click();
  const topMenu = primary.getByRole('menu', { name: '更多操作', exact: true });
  for (const name of ['会话历史', '待发送消息', '未发送草稿', '会话目标', '管理当前会话'])
    assert.equal(await topMenu.getByRole('menuitem', { name, exact: true }).count(), 0);
  await page.waitForTimeout(220);
  const renameItem = topMenu.getByRole('menuitem', { name: '重命名会话', exact: true });
  assert(
    await renameItem.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }),
  );
  await page.screenshot({ path: fileURLToPath(new URL('conversation-menu-desktop.png', out)) });
  await topMenu.getByRole('menuitem', { name: '重命名会话', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名会话', exact: true });
  await rename.getByRole('textbox', { name: '对话名称' }).fill('Renamed main');
  await rename.getByRole('button', { name: '保存名称' }).click();
  await rename.waitFor({ state: 'hidden' });
  assert(
    await page.evaluate(() =>
      window.calls.some(
        (c) =>
          c.action === 'sessions.rename' &&
          c.payload.sessionId === 'main' &&
          c.payload.title === 'Renamed main',
      ),
    ),
  );
  await more.click();
  await topMenu.getByRole('menuitem', { name: '置顶会话', exact: true }).click();
  await topMenu.waitFor({ state: 'hidden' });
  await more.click();
  await topMenu.getByRole('menuitem', { name: '取消置顶', exact: true }).waitFor();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await topMenu.getByRole('menuitem', { name: '更多操作', exact: true }).click();
  await topMenu.getByRole('menuitem', { name: '复制会话标题', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Renamed main');
  await more.click();
  await topMenu.getByRole('menuitem', { name: '更多操作', exact: true }).click();
  await topMenu.getByRole('menuitem', { name: '在右侧打开当前会话', exact: true }).click();
  await host
    .locator('.tool-tab-panel:not([hidden]) .side-chat')
    .getByText('PRIMARY-HISTORY-LIVE', { exact: true })
    .waitFor();
  assert.equal(await mainInput.inputValue(), 'PRIMARY-DRAFT');
  await more.click();
  await topMenu.getByRole('menuitem', { name: '更多操作', exact: true }).click();
  await topMenu.getByRole('menuitem', { name: '新建侧边对话', exact: true }).click();
  assert.equal(
    await host
      .locator('.tool-tab-panel:not([hidden]) .side-chat')
      .getByRole('textbox', { name: '消息', exact: true })
      .inputValue(),
    '',
  );
  await host.getByRole('button', { name: '关闭工具栏', exact: true }).click();
  await more.click();
  await topMenu.getByRole('menuitem', { name: '归档会话', exact: true }).click();
  const archive = page.getByRole('dialog', { name: '归档会话', exact: true });
  await archive.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.action === 'sessions.archive').length),
    0,
  );
  await more.click();
  await topMenu.getByRole('menuitem', { name: '更多操作', exact: true }).click();
  await topMenu.getByRole('menuitem', { name: '分叉会话', exact: true }).click();
  await page
    .getByRole('dialog', { name: '分叉会话', exact: true })
    .getByRole('button', { name: '创建分叉' })
    .click();
  await primary.getByText('Forked conversation', { exact: true }).first().waitFor();
  await more.click();
  await topMenu.getByRole('menuitem', { name: '归档会话', exact: true }).click();
  await page
    .getByRole('dialog', { name: '归档会话', exact: true })
    .getByRole('button', { name: '归档', exact: true })
    .click();
  await page.getByRole('dialog', { name: '归档会话', exact: true }).waitFor({ state: 'hidden' });
  assert(
    await page.evaluate(() =>
      window.calls.some((c) => c.action === 'sessions.archive' && c.payload.sessionId === 'forked'),
    ),
  );
  await more.click();
  await topMenu.getByRole('menuitem', { name: '恢复会话', exact: true }).click();
  await page
    .getByRole('dialog', { name: '恢复会话', exact: true })
    .getByRole('button', { name: '恢复', exact: true })
    .click();
  await page.getByRole('dialog', { name: '恢复会话', exact: true }).waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  await more.click();
  await topMenu.waitFor();
  const box = await topMenu.boundingBox();
  assert(box.x >= 0 && box.x + box.width <= 391 && box.y + box.height <= 844);
  await page.waitForTimeout(220);
  await page.screenshot({ path: fileURLToPath(new URL('conversation-menu-mobile.png', out)) });
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '更多操作');
  await page.keyboard.press('Enter');
  await topMenu.getByRole('menuitem', { name: '设置', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await topMenu.waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    window.testSnapshot.sessions.find((s) => s.sessionId === 'forked').status = 'unknown';
    window.emit({ action: 'session.updated', payload: {}, sessionId: 'forked' });
  });
  await more.click();
  await topMenu.getByRole('menuitem', { name: '重命名会话', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.top-menu button').disabled);
  for (const name of ['重命名会话', '取消置顶', '归档会话'])
    assert(await topMenu.getByRole('menuitem', { name, exact: true }).isDisabled());
  await topMenu.getByRole('menuitem', { name: '更多操作', exact: true }).click();
  assert(await topMenu.getByRole('menuitem', { name: '分叉会话', exact: true }).isDisabled());
  await page.keyboard.press('Escape');
  checks.push(
    'conversation menu removes four obsolete entries; rename, pin, fork, archive cancellation, current/new side chats and mobile keyboard navigation work',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    new URL('verification.json', out),
    JSON.stringify({ checks, errors, realHost: false, realModel: false }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  if (activePage) {
    console.error(
      JSON.stringify(
        await activePage.evaluate(() => ({
          text: document.body.innerText,
          calls: window.calls,
          errors: window.testErrors,
        })),
        null,
        2,
      ),
    );
    await activePage.screenshot({ path: fileURLToPath(new URL('failure.png', out)) });
  }
  console.error(errors);
  throw error;
} finally {
  await browser.close();
}

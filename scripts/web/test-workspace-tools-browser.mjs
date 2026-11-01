/* global window, document, localStorage, TextEncoder, btoa, StorageEvent */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/workspace-tools/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
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
    window.sshOutput = 'SSH test terminal\r\n';
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
            attachments: true,
            activeTurnSteering: true,
            externalThreadObservation: true,
            latestUpstreamTurn: true,
            sshTerminal: window.sshSupported !== false,
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
      if (action === 'ssh.open') {
        window.sshId = payload.terminalId;
        return { terminalId: payload.terminalId };
      }
      if (action === 'ssh.read') {
        const bytes = new TextEncoder().encode(window.sshOutput);
        return {
          data: btoa(String.fromCharCode(...bytes.slice(payload.offset))),
          offset: bytes.length,
          truncated: false,
          eof: false,
        };
      }
      if (action === 'ssh.write') {
        window.sshInput += payload.data;
        window.sshOutput += payload.data;
        return { sequence: payload.sequence + 1 };
      }
      if (action === 'ssh.close') {
        window.sshClosed++;
        return { closed: true };
      }
      if (action === 'ssh.resize') return { resized: true };
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
  await page.screenshot({ path: new URL('launcher.png', out).pathname });
  await host
    .locator('.tools-grid')
    .getByRole('button', { name: /侧边对话/ })
    .click();
  const side = host.getByRole('region', { name: '侧边对话', exact: true });
  const sideInput = side.getByRole('textbox', { name: '消息', exact: true });
  await sideInput.fill('NEW-SIDE-DRAFT');
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
  await page.screenshot({ path: new URL('two-chats-desktop.png', out).pathname });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.screenshot({ path: new URL('two-chats-dark.png', out).pathname });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  const nav = host.getByRole('navigation', { name: '工作区工具', exact: true });
  await nav.getByRole('button', { name: '文件', exact: true }).click();
  await host.getByRole('treeitem', { name: /README.md/ }).dblclick();
  await host.getByText('# File preview from Host', { exact: true }).waitFor();
  await nav.getByRole('button', { name: '侧边对话', exact: true }).click();
  assert.equal(await sideInput.inputValue(), 'SIDE-DRAFT');
  await host.getByRole('button', { name: '关闭工具栏' }).click();
  await host.getByRole('button', { name: '打开工具', exact: true }).click();
  await host
    .locator('.tools-grid')
    .getByRole('button', { name: /侧边对话/ })
    .click();
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
  const approvalNotice = page.getByRole('region', { name: '任务提醒', exact: true });
  await approvalNotice.getByRole('button', { name: '关闭提醒', exact: true }).click();
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
  await nav.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  await host.getByLabel('主机 / SSH 别名').fill('server.test');
  await host.getByRole('button', { name: '连接', exact: true }).click();
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
    () => window.calls.filter((c) => c.action === 'ssh.open').length,
  );
  await nav.getByRole('button', { name: '侧边对话', exact: true }).click();
  await nav.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.action === 'ssh.open').length),
    opens,
  );
  checks.push('SSH inputs, Ctrl+C and tool switching use one terminal without replay');
  await page.setViewportSize({ width: 390, height: 844 });
  await host.locator('.ssh-status').waitFor();
  await page.waitForFunction(() =>
    window.calls.some((c) => c.action === 'ssh.resize' && c.payload.cols < 70),
  );
  await page.screenshot({ path: new URL('ssh-mobile.png', out).pathname });
  assert.equal(await primary.isVisible(), false);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
    false,
  );
  await nav.getByRole('button', { name: '侧边对话', exact: true }).click();
  await page.screenshot({ path: new URL('side-chat-mobile.png', out).pathname });
  assert.equal(await side.isVisible(), true);
  await host.getByRole('button', { name: '关闭工具栏' }).click();
  await page.waitForFunction(() => window.sshClosed > 0);
  assert.equal(await primary.isVisible(), true);
  checks.push('390px layout switches between main and tools; closing tools closes SSH');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => {
    window.sshSupported = false;
    window.testBridge.close();
  });
  await host.getByRole('button', { name: '打开工具', exact: true }).click();
  await host
    .locator('.tools-grid')
    .getByRole('button', { name: /SSH 终端/ })
    .click();
  await host
    .getByText('当前 Host 尚不支持 SSH 终端，请升级 Host 后使用。', { exact: true })
    .waitFor();
  const openCount = await page.evaluate(
    () => window.calls.filter((c) => c.action === 'ssh.open').length,
  );
  await page.evaluate(() => {
    window.sshSupported = true;
    window.testBridge.close();
  });
  await host.getByLabel('主机 / SSH 别名').waitFor();
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.action === 'ssh.open').length),
    openCount,
  );
  checks.push('old Hosts show an upgrade message; reconnecting never restarts SSH');
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
    await activePage.screenshot({ path: new URL('failure.png', out).pathname });
  }
  console.error(errors);
  throw error;
} finally {
  await browser.close();
}

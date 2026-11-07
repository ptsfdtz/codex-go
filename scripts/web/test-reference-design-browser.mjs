/* global window, document, localStorage, Event, PointerEvent, MouseEvent */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1430';
const out = new URL(
  `../../artifacts/${process.env.REFERENCE_ARTIFACT_DIR || 'reference-design'}/`,
  import.meta.url,
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const errors = [],
  checks = [];
let activePage;
try {
  const page = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(12000);
  activePage = page;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((nativeSpeech) => {
    const NativeRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const DeniedRecognition = class {
      start() {
        window.deniedRecognition = this;
        setTimeout(() => {
          document.activeElement?.blur();
          this.onerror?.({ error: 'not-allowed' });
        }, 0);
      }
      abort() {
        this.aborts = (this.aborts || 0) + 1;
      }
    };
    const Recognition = nativeSpeech
      ? function () {
          const recognition = new NativeRecognition();
          const abort = recognition.abort.bind(recognition);
          recognition.abort = () => {
            recognition.aborts = (recognition.aborts || 0) + 1;
            abort();
          };
          window.deniedRecognition = recognition;
          return recognition;
        }
      : DeniedRecognition;
    window.SpeechRecognition = window.webkitSpeechRecognition = Recognition;
    localStorage.setItem('agentdeck.web.theme', 'dark');
    localStorage.setItem('agentdeck.web.work-mode', '"codex"');
  }, process.env.REFERENCE_NATIVE_SPEECH === '1');
  let ready = false;
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, (route) => route.abort());
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const hosts = [
      { hostId: 'reference-host', customName: 'Laptop', customNameConfigured: true, online: true },
      { hostId: 'desktop', customName: 'Desktop', customNameConfigured: true, online: false },
    ];
    const value = path.endsWith('/web/session')
      ? { accountId: 'reference-test', cloudDeviceId: 'browser', mustChangePassword: false }
      : path === '/api/v1/hosts'
        ? { hosts }
        : path.endsWith('/access')
          ? {
              hostId: 'reference-host',
              fingerprint: 'a'.repeat(64),
              credential: 'b'.repeat(43),
              endpoints: [],
            }
          : path === '/api/v1/chat/keys'
            ? { enabled: true }
            : { csrfToken: 'test-only' };
    return route.fulfill({ status: ready ? 200 : 401, json: value });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: '登录', exact: true }).waitFor();
  ready = true;
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Bridge } = await import('/src/transport/bridge.ts');
    window.calls = [];
    window.testSnapshot = {
      cursor: '1',
      projects: [
        { projectId: 'p1', name: 'LiYa', canonicalPath: 'C:/Projects/LiYa' },
        { projectId: 'p2', name: 'AgentHub', canonicalPath: 'C:/Projects/AgentHub' },
      ],
      sessions: [
        { sessionId: 'main', projectId: 'p1', title: '梳理 QQ 聊天机器人的能力', status: 'idle' },
        { sessionId: 'other', projectId: 'p1', title: '查看 QQ 机器人聊天功能', status: 'idle' },
        {
          sessionId: 'work',
          upstreamThreadId: 'agent-work',
          projectId: 'p2',
          title: '重构 Web 的设计和交互',
          status: 'running',
        },
      ],
      turns: [],
      approvals: [],
    };
    const history = [
      {
        turnId: 't1',
        item: {
          id: 'agent-tool',
          type: 'collabAgentToolCall',
          receiverThreadIds: ['agent-work'],
          status: 'completed',
        },
      },
      {
        turnId: 't1',
        item: {
          id: 'user',
          type: 'userMessage',
          content: [{ type: 'inputText', text: '梳理当前功能，并继续完善聊天体验。' }],
        },
      },
      {
        turnId: 't1',
        item: {
          id: 'reply',
          type: 'agentMessage',
          text: '首批本地测试已通过，接下来继续核对消息发送和失败处理。\n\n目前已完成会话列表、项目切换与文件浏览；发送结果未知时会保留草稿，等待核对后再继续。',
          status: 'completed',
        },
      },
      {
        turnId: 't1',
        item: {
          id: 'tool',
          type: 'commandExecution',
          command: 'pnpm check',
          status: 'completed',
          exitCode: 0,
          aggregatedOutput: 'All checks passed',
        },
      },
      {
        turnId: 't1',
        item: {
          id: 'reply2',
          type: 'agentMessage',
          text: '已保留项目授权、执行审批及重连恢复语义。现在可以继续下一步。',
          status: 'completed',
        },
      },
    ];
    Bridge.prototype.connect = async function () {
      this.hostId = 'reference-host';
      window.referenceBridge = this;
    };
    Bridge.prototype.probe = async () => undefined;
    Bridge.prototype.reconcile = async () => undefined;
    Bridge.prototype.request = async function (action, payload = {}) {
      window.calls.push({ action, payload });
      if (action === 'snapshot.get') return structuredClone(window.testSnapshot);
      if (action === 'events.replay') return { events: [], cursor: '1', hasMore: false };
      if (action === 'system.capabilities')
        return {
          features: Object.fromEntries(
            [
              'projectFileBrowser',
              'projectTextPreview',
              'gitRead',
              'sessionManagement',
              'sessionFork',
              'attachments',
              'activeTurnSteering',
              'externalThreadObservation',
              'latestUpstreamTurn',
              'projectTerminal',
              'nativeQueue',
              'hostUpdateCheck',
              'hostUpdateManage',
              'turnResponseSpeed',
              'sessionTokenUsage',
              'sessionGoalView',
              'plan',
              'goal',
              'projectlessChat',
            ].map((key) => [key, true]),
          ),
        };
      if (action === 'models.list')
        return {
          models: [
            {
              id: 'gpt-6.1-sol',
              model: 'gpt-6.1-sol',
              displayName: 'GPT-6.1 Sol',
              isDefault: true,
              fastServiceTier: 'fast',
              defaultReasoningEffort: 'high',
              supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
            },
          ],
        };
      if (action === 'sessions.history') return { data: structuredClone(history).reverse() };
      if (action === 'sessions.goal')
        return { goal: { objective: '完善聊天体验', status: 'active', timeUsedSeconds: 1182 } };
      if (action === 'sessions.detail')
        return {
          events: [
            {
              action: 'session.tokenUsage',
              payload: {
                tokenUsage: {
                  last: { totalTokens: 310000 },
                  total: { totalTokens: 420000 },
                  modelContextWindow: 480000,
                },
              },
            },
          ],
        };
      if (action === 'queue.list') return { sessionId: payload.sessionId, data: [] };
      if (action === 'system.updateStatus') return { job: null };
      if (action === 'system.updateCheck')
        return {
          current: '0.4.3',
          latest: '0.4.3',
          platform: 'windows',
          installation: 'release',
          updateAvailable: false,
        };
      if (action === 'turn.latest') return { turn: null };
      if (action === 'git.status') return { available: true, files: [] };
      if (action === 'files.list')
        return { entries: [{ path: 'README.md', name: 'README.md', kind: 'file', size: 20 }] };
      if (action === 'files.readText') return { text: '# Project', size: 9 };
      if (action === 'sessions.rename') {
        window.testSnapshot.sessions.find((item) => item.sessionId === payload.sessionId).title =
          payload.title;
        return {};
      }
      if (action === 'sessions.pin') {
        window.testSnapshot.sessions.find((item) => item.sessionId === payload.sessionId).pinned =
          payload.pinned ? 1 : 0;
        return {};
      }
      if (action === 'sessions.archive') {
        window.testSnapshot.sessions.find((item) => item.sessionId === payload.sessionId).archived =
          1;
        return {};
      }
      return {};
    };
    localStorage.setItem('agentdeck.web.selection.reference-test:browser.reference-host', 'main');
    document.getElementById('root').style.display = 'none';
    const target = document.createElement('div');
    target.id = 'reference-app';
    document.body.append(target);
    const { App } = await import('/src/App.tsx');
    (dom.default || dom).createRoot(target).render(React.createElement(App));
  });
  const app = page.locator('#reference-app');
  const main = app.locator('.conversation-layout > .conversation');
  const shot = async (name) => {
    await page.waitForTimeout(200);
    await page.screenshot({ path: fileURLToPath(new URL(name + '.png', out)) });
  };
  await app.locator('.host-chip').filter({ hasText: 'Laptop' }).click();
  await app.locator('.sidebar .session-title').first().waitFor();
  assert.equal(Math.round((await app.locator('.sidebar').boundingBox()).width), 390);
  await shot('projects-390-dark');
  const firstRow = app.locator('.sidebar-project-sessions .session').first();
  await firstRow.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 80, clientY: 180 });
  await firstRow.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 80, clientY: 220 });
  await page.waitForTimeout(550);
  assert.equal(await app.locator('.sidebar-context-menu:popover-open').count(), 0);
  await firstRow.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 80, clientY: 180 });
  await app.locator('.sidebar-context-menu:popover-open').waitFor();
  await firstRow.dispatchEvent('pointerup', { pointerType: 'touch' });
  await page.keyboard.press('Escape');
  assert.equal(await app.locator('.shell.with-sidebar').count(), 1);
  checks.push('Touch long press opens session actions; scroll movement cancels the gesture');
  checks.push(
    'Mobile project list fills viewport and uses real account/Host component paths with controlled transport',
  );
  await app.locator('.sidebar-project-sessions .session').first().click();
  await main.getByRole('textbox', { name: '消息', exact: true }).waitFor();
  await main
    .getByText('已保留项目授权、执行审批及重连恢复语义。现在可以继续下一步。', { exact: true })
    .waitFor();
  await shot('conversation-390-compact-dark');
  const addBounds = await main
    .getByRole('button', { name: '添加附件和操作', exact: true })
    .boundingBox();
  await page.touchscreen.tap(addBounds.x + addBounds.width / 2, addBounds.y + addBounds.height / 2);
  await page.getByRole('menuitem', { name: '相机', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  checks.push('A first touch on the compact composer plus button opens its action menu');
  await main.getByRole('button', { name: '语音输入', exact: true }).tap();
  await main
    .locator('.composer-speech-status')
    .filter({ hasText: '请允许麦克风权限' })
    .waitFor({ state: 'attached' });
  assert.equal(await main.locator('.speech-error').count(), 0);
  const cancelledPointer = await main.locator('.composer-add').evaluate((node) => {
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
    });
    node.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(
    cancelledPointer,
    false,
    'Composer must preserve the native touch sequence after permission denial',
  );
  assert.equal(await page.evaluate(() => window.deniedRecognition.aborts || 0), 0);
  assert.equal(
    await main.locator('.composer-add').evaluate((node) => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }),
    false,
  );
  await main.getByRole('button', { name: '添加附件和操作', exact: true }).tap();
  await page.getByRole('menuitem', { name: '相机', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(
    await main
      .locator('.composer-speech-status')
      .evaluate((node) => node.getBoundingClientRect().height),
    1,
  );
  checks.push(
    'Mobile microphone permission errors leave the compact action menu and dismissal usable',
  );
  await main.getByRole('textbox', { name: '消息', exact: true }).focus();
  await main.locator('.composer.is-compact').waitFor({ state: 'hidden' });
  // Safari blurs the editor before its keyboard finishes closing. The app
  // must stay in the visual viewport until the keyboard resize arrives.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 480 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await main.getByRole('button', { name: '添加附件和操作', exact: true }).tap();
  await page.getByRole('menuitem', { name: '相机', exact: true }).waitFor();
  await page.waitForTimeout(50);
  assert.equal(await page.locator('html').getAttribute('data-keyboard'), 'open');
  assert.equal(
    await page.locator('html').evaluate((node) => node.style.getPropertyValue('--app-height')),
    '480px',
  );
  await page.evaluate(() => {
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  assert.equal(await page.locator('html').getAttribute('data-keyboard'), 'closed');
  await shot('touch-actions-390-dark');
  await page.keyboard.press('Escape');
  checks.push(
    'Focus transfer keeps the keyboard viewport until its actual resize; touch actions remain usable',
  );
  const editorAfterDenial = main.getByRole('textbox', { name: '消息', exact: true });
  await main.getByRole('button', { name: '语音输入', exact: true }).tap();
  await main
    .locator('.composer-speech-status')
    .filter({ hasText: '请允许麦克风权限' })
    .waitFor({ state: 'attached' });
  assert.equal(await main.locator('.speech-error').count(), 0);
  assert.equal(
    await main.locator('.composer.is-compact').count(),
    0,
    'Permission blur must not move composer actions',
  );
  await editorAfterDenial.tap();
  await page.keyboard.type('取消权限后可继续输入');
  assert.equal(await editorAfterDenial.inputValue(), '取消权限后可继续输入');
  await main.getByRole('button', { name: '添加附件和操作', exact: true }).tap();
  await page.getByRole('menuitem', { name: '相机', exact: true }).waitFor();
  await shot('permission-denied-actions-390');
  await page.keyboard.press('Escape');
  await main.getByRole('button', { name: '切换模型', exact: true }).tap();
  await page.locator('.model-picker-popup:popover-open').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await main.locator('.speech-error').count(), 0);
  await editorAfterDenial.fill('');
  checks.push(
    'Asynchronous microphone denial/null-focus preserves native pointer/mouse events, editor typing, add/model menus without visible error rows; no terminal abort',
  );
  await shot('conversation-390-editing-dark');
  const sheet = page.locator('.permission-sheet');
  await main.getByRole('button', { name: '执行权限：工作区权限', exact: true }).click();
  const permission = page.getByRole('dialog', { name: '应如何批准 Codex 操作？' });
  await permission.waitFor();
  const box = await permission.boundingBox();
  assert.equal(Math.round(box.x), 0);
  assert.equal(Math.round(box.y + box.height), 844);
  await shot('permissions-390-dark');
  await page.keyboard.press('Escape');
  await permission.waitFor({ state: 'hidden' });
  assert(await main.locator('.permission').evaluate((node) => document.activeElement === node));
  checks.push('Permission sheet bottom alignment, Escape and focus restoration');
  await main.getByRole('button', { name: '切换模型', exact: true }).click();
  const model = page.locator('.model-picker-popup:popover-open');
  await model.waitFor();
  const modelBounds = await model.boundingBox();
  assert(Math.abs(modelBounds.x + modelBounds.width / 2 - 195) <= 1);
  const rail = await model.locator('.effort-slider').boundingBox();
  const range = model.getByRole('slider');
  const needle = main.locator('path.model-gauge-needle');
  const rangeBounds = await range.boundingBox();
  assert.equal(Math.round(rail.height), 64);
  assert(Math.abs(rail.y + rail.height - 840) <= 1, 'Capsule sits at the bottom of the viewport');
  assert(Math.abs(rangeBounds.height - rail.height) <= 1, 'Entire visible rail accepts input');
  await page.mouse.click(rail.x + 32 + (rail.width - 64) * 0.4, rail.y + rail.height / 2);
  await shot('model-390-dark');
  await page.mouse.click(rail.x + rail.width - 12, rail.y + rail.height - 8);
  assert.equal(await range.inputValue(), await range.getAttribute('max'));
  assert.equal(await needle.evaluate((node) => node.style.transform), 'rotate(112deg)');
  assert.equal(await needle.evaluate((node) => node.getAnimations().length), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.mouse.click(rail.x + 12, rail.y + rail.height - 8);
  assert.equal(await range.inputValue(), '0');
  assert.equal(await needle.evaluate((node) => node.style.transform), 'rotate(-112deg)');
  await page.waitForFunction(() =>
    document
      .querySelector('path.model-gauge-needle')
      ?.getAnimations()
      .some((animation) => animation.transitionProperty === 'transform'),
  );
  await model.getByRole('slider').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await needle.evaluate((node) => node.getAnimations().length), 0);
  assert.equal(await model.getByRole('button', { name: '快速模式', exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  const fast = main.getByRole('button', { name: '快速模式', exact: true });
  assert(await fast.isVisible());
  assert.equal(await fast.getAttribute('aria-pressed'), 'false');
  await fast.tap();
  assert.equal(await fast.getAttribute('aria-pressed'), 'true');
  await editorAfterDenial.fill('验证快速模式');
  await shot('model-gauge-390-dark');
  await main.getByRole('button', { name: '发送', exact: true }).tap();
  await page.waitForFunction(() =>
    window.calls.some(
      (call) => call.action === 'turn.start' && call.payload.text === '验证快速模式',
    ),
  );
  const speedRequest = await page.evaluate(
    () =>
      window.calls.find(
        (call) => call.action === 'turn.start' && call.payload.text === '验证快速模式',
      ).payload,
  );
  assert.equal(speedRequest.responseSpeed, 'fast');
  assert.equal(speedRequest.model, 'gpt-6.1-sol');
  assert.equal(speedRequest.effort, 'medium');
  await editorAfterDenial.tap();
  await fast.tap();
  assert.equal(await fast.getAttribute('aria-pressed'), 'false');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  checks.push(
    'Needle follows effort with pointer motion and updates immediately on keyboard/reduced motion; Fast reaches turn.start without changing effort',
  );
  checks.push('Mobile model overlay is centered; lower-half taps reach both slider endpoints');
  await main.getByRole('button', { name: '添加附件和操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '相机', exact: true }).waitFor();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: '照片', exact: true }).click();
  assert.equal(await (await chooser).element().getAttribute('accept'), 'image/*');
  await main.getByRole('button', { name: '添加附件和操作', exact: true }).click();
  await shot('attachments-390-dark');
  await page.keyboard.press('Escape');
  checks.push('Model slider keyboard interaction and image-only photo chooser');
  await main.getByRole('button', { name: '上下文已使用 65%', exact: true }).click();
  await page.getByText('剩余 35%', { exact: true }).waitFor();
  await shot('context-390-dark');
  await page.getByRole('button', { name: '查看用量详情', exact: true }).click();
  await page.getByRole('dialog', { name: '用量', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await main.getByRole('button', { name: '更多操作', exact: true }).click();
  await shot('menu-390-dark');
  await page.getByRole('menuitem', { name: '重命名会话', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名会话', exact: true });
  await rename.getByRole('textbox', { name: '对话名称' }).fill('重构设计参考');
  await rename.getByRole('button', { name: '保存名称', exact: true }).click();
  await rename.waitFor({ state: 'hidden' });
  assert(
    await main
      .locator('.workspace-title')
      .innerText()
      .then((text) => text.includes('重构设计参考')),
  );
  checks.push('Context usage opens actual detail; rename updates through sessions.rename');
  await main.getByRole('textbox', { name: '消息', exact: true }).focus();
  await main.getByRole('button', { name: '1 个智能体', exact: true }).click();
  await page
    .locator('.agent-tray-popup:popover-open')
    .getByRole('button', { name: /重构 Web 的设计和交互/ })
    .waitFor();
  await shot('agents-390-dark');
  await page.keyboard.press('Escape');
  checks.push('Agent tray derives upstream identities and resolves authorized session titles');
  if (process.env.REFERENCE_MOBILE_STRESS === '1') {
    const { mobileComposerMatrix } = await import('./mobile-composer-matrix.mjs');
    checks.push(await mobileComposerMatrix(page, main, out));
  }
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(150);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      if (width <= 760) {
        const scrollStyle = await main.locator('.timeline').evaluate((node) => ({
          scrollbar: window.getComputedStyle(node).scrollbarWidth,
          overflow: window.getComputedStyle(node).overflowY,
        }));
        assert.equal(scrollStyle.scrollbar, 'none');
        assert(['auto', 'scroll'].includes(scrollStyle.overflow));
        const targets = await main.locator('.composer-toolbar button').evaluateAll((nodes) =>
          nodes
            .filter((node) => node.getClientRects().length && !node.closest('[popover]'))
            .map((node) => {
              const box = node.getBoundingClientRect();
              const points = [
                [box.left + 2, box.top + box.height / 2],
                [box.right - 2, box.top + box.height / 2],
                [box.left + box.width / 2, box.top + 2],
                [box.left + box.width / 2, box.bottom - 2],
              ];
              return {
                label: node.getAttribute('aria-label'),
                width: box.width,
                height: box.height,
                hit: points.every(([x, y]) => node.contains(document.elementFromPoint(x, y))),
              };
            }),
        );
        for (const target of targets) {
          assert(target.width >= 44 && target.height >= 44, JSON.stringify(target));
          assert(target.hit, JSON.stringify(target));
        }
      }
      const toolbar = await main.locator('.composer').boundingBox();
      const send = await main.getByRole('button', { name: '发送', exact: true }).boundingBox();
      assert(send.x + send.width <= toolbar.x + toolbar.width + 1, 'Composer controls must fit');
      await shot(`conversation-${width}-${theme}`);
    }
  }
  checks.push('320/390/768/1440px light/dark: no document overflow, composer actions fit');
  await main.getByRole('textbox', { name: '消息', exact: true }).fill('跨模式保留的草稿');
  await page.setViewportSize({ width: 390, height: 844 });
  await main.getByRole('button', { name: '新建会话', exact: true }).click();
  await main.getByRole('combobox', { name: '切换项目', exact: true }).waitFor();
  await main.getByRole('combobox', { name: '切换项目', exact: true }).click();
  await page.getByRole('option', { name: 'AgentHub', exact: true }).click();
  assert.equal(
    (await main.getByRole('combobox', { name: '切换项目', exact: true }).innerText()).trim(),
    'AgentHub',
  );
  await shot('new-conversation-390-light');
  checks.push('New conversation context project selector changes actual project state');
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await page.setViewportSize({ width: 390, height: 530 });
  await main.getByRole('textbox', { name: '消息', exact: true }).fill('选择模型的 icon 需要添加');
  await main.getByRole('button', { name: '执行权限：工作区权限', exact: true }).tap();
  await page.getByRole('button', { name: /完全访问计算机/ }).tap();
  await sheet.waitFor({ state: 'detached' });
  const toolbar = main.locator('.composer-toolbar');
  const controls = await toolbar.locator('button:visible').evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return {
        label: button.getAttribute('aria-label'),
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      };
    }),
  );
  assert.deepEqual(
    controls.map(({ label }) => label),
    ['添加附件和操作', '执行权限：完整访问', '快速模式', '切换模型', '语音输入', '发送'],
  );
  assert(controls.every(({ y }) => Math.abs(y - controls[0].y) < 1));
  assert(controls.slice(3).every(({ x }, index) => Math.abs(x - controls[index + 2].x - 44) < 1));
  assert.equal(await needle.evaluate((node) => node.style.transform), 'rotate(0deg)');
  await shot('new-conversation-toolbar-390-dark');
  await main.getByRole('button', { name: '执行权限：完整访问', exact: true }).tap();
  await page.getByRole('button', { name: /在已授权项目内工作/ }).tap();
  await sheet.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 390, height: 844 });
  await main.getByRole('textbox', { name: '消息', exact: true }).fill('重连保留的新对话草稿');
  const snapshotReads = await page.evaluate(
    () => window.calls.filter((call) => call.action === 'snapshot.get').length,
  );
  await page.evaluate(() => {
    // Another tab can persist an old session while this tab is composing a new one.
    localStorage.setItem('agentdeck.web.selection.reference-test:browser.reference-host', 'main');
    window.referenceBridge.close();
  });
  await page.waitForFunction(
    (before) => window.calls.filter((call) => call.action === 'snapshot.get').length > before,
    snapshotReads,
  );
  await main.getByRole('textbox', { name: '消息', exact: true }).waitFor();
  assert.equal(
    await main.getByRole('textbox', { name: '消息', exact: true }).inputValue(),
    '重连保留的新对话草稿',
  );
  assert.equal(
    (await main.getByRole('combobox', { name: '切换项目', exact: true }).innerText()).trim(),
    'AgentHub',
  );
  checks.push(
    'Reconnect preserves the new conversation, project and unsent text despite another tab selecting an old session',
  );
  await page.setViewportSize({ width: 390, height: 480 });
  await main.getByRole('textbox', { name: '消息', exact: true }).focus();
  const keyboardComposer = await main.locator('.composer').boundingBox();
  assert(keyboardComposer.y + keyboardComposer.height <= 480);
  await shot('keyboard-layout-390');
  await page.setViewportSize({ width: 390, height: 844 });
  await main.getByRole('button', { name: '打开会话列表', exact: true }).click();
  await app.locator('.sidebar-mobile-settings').click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.waitFor();
  await settings.getByRole('combobox', { name: '外观', exact: true }).click();
  await page.getByRole('option', { name: '浅色', exact: true }).click();
  await settings.getByRole('combobox', { name: '外观', exact: true }).click();
  await page.getByRole('option', { name: '深色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await shot('settings-390-dark');
  await settings
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '对话', exact: true })
    .click();
  await page.setViewportSize({ width: 320, height: 700 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await shot('settings-320-dark');
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'hidden' });
  checks.push(
    'Short viewport keeps composer visible; settings theme and mobile categories remain operable',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await app.locator('.sidebar').getByRole('button', { name: '切换工作模式', exact: true }).click();
  await page.getByRole('button', { name: 'AgentChat', exact: true }).click();
  const api = app.locator('.api-chat');
  await api.locator('.sidebar-quick-compose').waitFor();
  await shot('agentchat-list-390-dark');
  await api.locator('.sidebar-quick-compose').click();
  await api.getByRole('textbox', { name: '消息', exact: true }).waitFor();
  await api.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await shot('agentchat-settings-390-dark');
  await page.keyboard.press('Escape');
  checks.push(
    'Work mode switches to actual AgentChat; mobile new-chat and API settings remain reachable',
  );
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await api.getByRole('button', { name: '打开会话列表', exact: true }).click();
  await api.locator('.sidebar').getByRole('button', { name: '切换工作模式', exact: true }).click();
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  await app.locator('.host-chip').filter({ hasText: 'Laptop' }).click();
  await app
    .locator('.sidebar-project-sessions .session')
    .filter({ hasText: '重构设计参考' })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('#reference-app .conversation textarea')?.value === '跨模式保留的草稿',
  );
  checks.push('Switching Codex → AgentChat → Codex preserves scoped unsent drafts without sending');
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { usePageDrafts } = await import('/src/features/page-drafts.ts');
    const target = document.createElement('div');
    target.hidden = true;
    document.body.append(target);
    function CacheHarness() {
      const [scope, setScope] = React.useState('draft-test-a:browser');
      const [drafts, setDrafts] = usePageDrafts(scope);
      window.cacheHarness = { scope, drafts, setScope, setDrafts };
      return null;
    }
    (dom.default || dom).createRoot(target).render(React.createElement(CacheHarness));
  });
  await page.waitForFunction(() => !!window.cacheHarness);
  await page.evaluate(() => {
    window.savedDraftSetter = window.cacheHarness.setDrafts;
    window.savedDraftSetter({
      same: {
        text: 'ACCOUNT-A',
        attachments: [],
        skills: [],
        mode: 'default',
        model: '',
        effort: '',
      },
    });
  });
  await page.waitForFunction(() => window.cacheHarness.drafts.same?.text === 'ACCOUNT-A');
  await page.evaluate(() => window.cacheHarness.setScope('draft-test-b:browser'));
  await page.waitForFunction(() => window.cacheHarness.scope === 'draft-test-b:browser');
  assert.equal(await page.evaluate(() => window.cacheHarness.drafts.same), undefined);
  await page.evaluate(() =>
    window.savedDraftSetter({
      same: {
        text: 'ACCOUNT-B',
        attachments: [],
        skills: [],
        mode: 'default',
        model: '',
        effort: '',
      },
    }),
  );
  await page.waitForFunction(() => window.cacheHarness.drafts.same?.text === 'ACCOUNT-B');
  await page.evaluate(() => window.cacheHarness.setScope('draft-test-a:browser'));
  await page.waitForFunction(() => window.cacheHarness.drafts.same?.text === 'ACCOUNT-A');
  checks.push(
    'Identical draft keys stay isolated by account/device; stable callbacks follow the current identity',
  );
  const login = await browser.newPage({ locale: 'zh-CN', viewport: { width: 390, height: 844 } });
  login.on('pageerror', (error) => errors.push(error.message));
  await login.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, (route) => route.abort());
  await login.route('**/api/**', (route) => route.fulfill({ status: 401, json: {} }));
  await login.goto(origin);
  await login.getByRole('button', { name: '登录', exact: true }).waitFor();
  assert.equal(await login.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await login.screenshot({ path: fileURLToPath(new URL('login-390-dark.png', out)) });
  checks.push('Fresh browser visits default to the reference dark palette; login remains operable');
  await login.close();
  assert.deepEqual(errors, []);
  await writeFile(new URL('checks.json', out), JSON.stringify({ checks, errors }, null, 2));
  console.log(checks.join('\n'));
} catch (error) {
  console.log(
    await activePage?.evaluate(() => ({ text: document.body.innerText, calls: window.calls })),
  );
  console.log(errors);
  await activePage?.screenshot({ path: fileURLToPath(new URL('failure.png', out)) });
  throw error;
} finally {
  await browser.close();
}

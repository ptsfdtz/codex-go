/* global document, window, CustomEvent */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startConversationServer } from './conversation-server.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const directory = '.tmp/web-workspace';
mkdirSync(directory, { recursive: true });
const { vite, state, origin } = await startConversationServer({
  cacheDir: join(process.cwd(), directory, 'cache'),
  allowMutations: true,
});
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === 'win32' ? 'msedge' : undefined,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const last = (action) => state.rpc.filter((r) => r.action === action).at(-1)?.payload;
  const menu = async (name) => {
    await page.getByRole('button', { name: '更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  };
  const close = () =>
    page.getByRole('dialog').last().getByRole('button', { name: '关闭', exact: true }).click();
  await page.goto(origin);
  await page.locator('.rich-content h1').waitFor();
  assert.equal(await page.getByLabel('公网配对信息', { exact: true }).count(), 0);
  assert.equal(
    await page.locator('.sidebar').evaluate((node) => window.getComputedStyle(node).width),
    '280px',
  );
  assert.equal(await page.locator('.role').count(), 0);
  assert.equal(
    await page.locator('.tool-record > summary').innerText(),
    'Ran command\nlocal acceptance command',
  );
  await menu('设置');
  await page.getByLabel('外观', { exact: true }).selectOption('dark');
  await close();
  await page.screenshot({ path: join(directory, 'desktop-dark.png') });
  assert.equal(await page.locator('.sidebar input').count(), 0, 'no persistent search field');
  await page.getByRole('button', { name: '搜索会话', exact: true }).click();
  const sessionSearch = page.getByRole('textbox', { name: '搜索会话', exact: true });
  await sessionSearch.fill('no-matching-session-abcxyz');
  await page.getByText('没有匹配的会话', { exact: true }).waitFor();
  await sessionSearch.fill('');
  assert.ok(await page.locator('dialog .search-result').count(), 'search lists real sessions');
  await close();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.keyboard.press('Control+k');
  await sessionSearch.waitFor();
  assert.equal(await sessionSearch.evaluate((node) => node === document.activeElement), true);
  await close();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await menu('浏览项目文件');
  await page.getByRole('button', { name: 'README.md 14 B' }).click();
  await page.getByText('Authorized current file preview', { exact: true }).waitFor();
  await page.getByRole('button', { name: '引用到消息' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.ok((await page.getByLabel('消息', { exact: true }).inputValue()).includes('[README.md]'));
  await page.getByRole('button', { name: '添加附件和操作' }).click();
  await page.getByRole('menuitem', { name: '技能', exact: true }).click();
  await page.getByRole('button', { name: '引用技能 review-code' }).click();
  await close();
  await page
    .locator('.composer input[type=file]')
    .setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.getByRole('button', { name: '移除附件 note.txt' }).waitFor();
  await page.getByRole('button', { name: '添加附件和操作' }).click();
  await page.getByRole('menuitem', { name: 'Plan', exact: true }).click();
  await page.getByRole('button', { name: '切换模型', exact: true }).click();
  await page.getByRole('button', { name: 'Test model', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: '切换模型', exact: true }).innerText(),
    'Test model',
  );
  await page.getByRole('slider', { name: '推理强度', exact: true }).fill('1');
  await page.getByRole('button', { name: '重置思维强度', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: '重置思维强度', exact: true }).isEnabled(),
    false,
  );
  await page.getByRole('slider', { name: '推理强度', exact: true }).fill('1');
  assert.equal(
    await page.getByRole('slider', { name: '推理强度' }).getAttribute('aria-valuetext'),
    'High',
  );
  await page.getByRole('slider', { name: '推理强度' }).press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '模型与思维强度', exact: true }).click();
  const pickerBox = await page.locator('.model-picker-popup').boundingBox();
  assert.ok(pickerBox.x >= 0 && pickerBox.x + pickerBox.width <= 390);
  assert.equal(
    await page
      .locator('.model-picker-popup')
      .evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth),
    true,
    'effort panel has no overflowing content',
  );
  mkdirSync('artifacts/web-model-picker', { recursive: true });
  await page.screenshot({ path: 'artifacts/web-model-picker/effort.png' });
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.screenshot({ path: 'artifacts/web-model-picker/models.png' });
  await page.getByRole('button', { name: 'Test model', exact: true }).click();
  await page.getByRole('slider', { name: '推理强度' }).fill('1');
  await page.getByRole('slider', { name: '推理强度' }).press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel('消息', { exact: true }).fill('Review this change');
  state.failTurn = true;
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText('Error: OUTCOME_UNKNOWN: controlled disconnect', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), 'Review this change');
  assert.equal(await page.getByRole('button', { name: '移除附件 note.txt' }).count(), 1);
  const sent = last('turn.start');
  assert.equal(sent.mode, 'plan');
  assert.equal(sent.model, 'test-model');
  assert.equal(sent.effort, 'high');
  assert.equal(sent.permissionMode, 'workspace');
  assert.deepEqual(sent.attachments, [{ name: 'note.txt', data: 'aGVsbG8=' }]);
  assert.deepEqual(sent.skills, ['b'.repeat(64)]);
  const unknownSendCount = state.rpc.filter((r) => r.action === 'turn.start').length;
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '核对操作结果', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  assert.equal(state.rpc.filter((r) => r.action === 'turn.start').length, unknownSendCount);
  state.receiptStatus = 'done';
  await page.getByRole('button', { name: '核对操作结果', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="发送"]').disabled);
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isEnabled(), true);
  // Adapter accepts writes only in this controlled test; it never reaches a model.
  state.failTurn = false;
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.composer textarea').value === '');
  await page.getByLabel('消息', { exact: true }).fill('draft in first session');
  await page.getByRole('button', { name: '另一会话', exact: true }).click();
  await page.getByText('另一会话的正文', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: '渲染验收', exact: true }).click();
  await page.locator('.rich-content h1').waitFor();
  assert.equal(
    await page.getByLabel('消息', { exact: true }).inputValue(),
    'draft in first session',
  );
  await menu('会话目标');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('textbox', { name: '目标', exact: true }).fill('Updated objective');
  await page.getByRole('spinbutton', { name: 'Token 预算' }).fill('2000');
  await page.getByRole('button', { name: '保存目标' }).click();
  await page.getByText('Updated objective', { exact: true }).waitFor();
  assert.deepEqual(last('sessions.goal.edit'), {
    sessionId: 's1',
    objective: 'Updated objective',
    expectedGoalRevision: 'a'.repeat(64),
    tokenBudget: 2000,
  });
  await close();
  await menu('审查工作区改动');
  await page.getByRole('button', { name: 'src/app.ts M' }).click();
  await page.locator('.diff-add').getByText('+after', { exact: false }).waitFor();
  assert.deepEqual(last('git.diff'), { projectId: 'p1', fileId: 'f1' });
  await close();
  await menu('管理当前会话');
  const nameInput = page.getByRole('textbox', { name: '对话名称', exact: true });
  assert.equal(await page.getByRole('button', { name: '保存名称' }).isEnabled(), false);
  const originalName = await nameInput.inputValue();
  await nameInput.fill('临时名称');
  await nameInput.press('Escape');
  assert.equal(await nameInput.inputValue(), originalName);
  await nameInput.fill('Renamed conversation');
  await nameInput.press('Enter');
  await page.waitForFunction(() => document.querySelector('.session-name button')?.disabled);
  await page.getByRole('button', { name: '置顶', exact: true }).click();
  await page.getByRole('button', { name: '取消置顶', exact: true }).waitFor();
  assert.deepEqual(last('sessions.pin'), { sessionId: 's1', pinned: true });
  await page.getByRole('button', { name: '整理上下文', exact: true }).click();
  await page
    .locator('.confirmation')
    .getByRole('button', { name: '整理上下文', exact: true })
    .click();
  await page.waitForFunction(() => !document.querySelector('.confirmation'));
  assert.deepEqual(last('sessions.compact'), {
    sessionId: 's1',
    expectedLastTurnId: 'native-turn',
  });
  await close();
  await page.getByRole('button', { name: '编辑并重新发送', exact: true }).click();
  await page.getByLabel('修改消息', { exact: true }).fill('Revised native message');
  await page.getByRole('button', { name: '确认并发送', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(last('sessions.revise'), {
    sessionId: 's1',
    beforeTurnId: 'native-turn',
    expectedLastTurnId: 'native-turn',
    itemId: 'question',
    text: 'Revised native message',
    permissionMode: 'workspace',
    mode: 'plan',
    model: 'test-model',
    effort: 'high',
  });
  await page.locator('.rich-content h1').waitFor();
  await page.getByRole('button', { name: '从此处分叉', exact: true }).first().click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(last('sessions.fork'), { sessionId: 's1', lastTurnId: 'native-turn' });
  await page.getByRole('button', { name: 'Renamed conversation', exact: true }).click();
  await page.locator('.rich-content h1').waitFor();
  const startsBeforeReconnect = state.rpc.filter((r) => r.action === 'turn.start').length;
  const snapshotsBeforeReconnect = state.rpc.filter((r) => r.action === 'snapshot.get').length;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('test-packet', {
        detail: { type: 'closed', message: 'Controlled network interruption' },
      }),
    ),
  );
  await page.waitForFunction(() => !document.querySelector('.composer textarea').disabled);
  assert.ok(state.rpc.filter((r) => r.action === 'snapshot.get').length > snapshotsBeforeReconnect);
  assert.equal(state.rpc.filter((r) => r.action === 'turn.start').length, startsBeforeReconnect);
  await page.getByRole('button', { name: '另一会话', exact: true }).click();
  await page.getByText('另一会话的正文', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('另一会话的正文', { exact: true }).waitFor();
  assert.equal(state.rpc.filter((r) => r.action === 'turn.start').length, startsBeforeReconnect);
  await page.getByRole('button', { name: 'Renamed conversation', exact: true }).click();
  await page.locator('.rich-content h1').waitFor();
  // Drafts intentionally stay in memory; restore this test draft after reload.
  await page.getByLabel('消息', { exact: true }).fill('draft in first session');
  // Native async questions reply in place and leave the main draft intact.
  state.extra.push({
    turnId: 'question-turn',
    item: {
      id: 'async-q',
      type: 'agentMessage',
      text: 'Please choose',
      questions: [{ title: 'Choose a season', options: ['Spring', 'Autumn'] }],
    },
  });
  await page.evaluate(
    (entry) =>
      window.dispatchEvent(
        new CustomEvent('test-packet', {
          detail: {
            type: 'event',
            sessionId: 's1',
            action: 'turn.progress',
            payload: { method: 'item/completed', turnId: entry.turnId, item: entry.item },
          },
        }),
      ),
    state.extra.at(-1),
  );
  await page
    .locator('.async-questions')
    .getByRole('button', { name: '○ Autumn', exact: true })
    .click();
  await page
    .locator('.async-questions')
    .getByRole('button', { name: '提交回答', exact: true })
    .click();
  await page.getByText('已回答 Codex 的问题', { exact: true }).waitFor();
  assert.ok(
    last('turn.start').text.includes(
      JSON.stringify(['request_user_input_async', 'async-q', 0]).replaceAll('"', '\\"'),
    ),
  );
  assert.equal(
    await page.getByLabel('消息', { exact: true }).inputValue(),
    'draft in first session',
  );
  state.approvals = [
    {
      approvalId: 'approval-question',
      sessionId: 's1',
      turnId: 'local-turn',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      allowedDecisions: ['approve', 'cancel'],
      context: {
        questions: [
          {
            id: 'q1',
            question: 'Native question',
            options: [{ label: 'Yes', description: 'Choose yes' }, { label: 'No' }],
          },
        ],
      },
    },
  ];
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('test-packet', {
        detail: { type: 'event', sessionId: 's1', action: 'approval.created' },
      }),
    ),
  );
  await page
    .locator('.approval')
    .getByRole('button', { name: '○ Yes Choose yes', exact: true })
    .click();
  await page.locator('.approval').getByRole('button', { name: '提交回答', exact: true }).click();
  await page.locator('.approval').waitFor({ state: 'hidden' });
  assert.deepEqual(last('approvals.decide'), {
    sessionId: 's1',
    turnId: 'local-turn',
    approvalId: 'approval-question',
    decision: 'approve',
    answers: { q1: { answers: ['Yes'] } },
  });
  state.running = true;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('test-packet', {
        detail: { type: 'event', sessionId: 's1', action: 'turn.started' },
      }),
    ),
  );
  await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  await page.getByLabel('消息', { exact: true }).fill('Steer this task');
  await page.getByRole('button', { name: '立即补充到当前任务' }).click();
  await page.waitForFunction(() => document.querySelector('.composer textarea').value === '');
  assert.deepEqual(last('turn.steer'), {
    sessionId: 's1',
    expectedTurnId: 'native-turn',
    text: 'Steer this task',
  });
  await page.getByLabel('消息', { exact: true }).fill('Queued first');
  await page.getByRole('button', { name: '加入待发送队列' }).click();
  await page.waitForFunction(() => document.querySelector('.composer textarea').value === '');
  await page.getByLabel('消息', { exact: true }).fill('Queued second');
  await page.getByRole('button', { name: '加入待发送队列' }).click();
  await page.waitForFunction(() => document.querySelector('.composer textarea').value === '');
  await menu('待发送消息');
  await page.getByText('Queued first', { exact: true }).waitFor();
  await page.getByRole('button', { name: '下移消息', exact: true }).first().click();
  await page.getByText('已完成', { exact: true }).waitFor();
  assert.deepEqual(last('queue.reorder'), { sessionId: 's1', submissionIds: ['q2', 'q1'] });
  await page.getByRole('button', { name: '编辑', exact: true }).first().click();
  await page.getByRole('textbox', { name: '编辑待发送消息' }).fill('Updated queued text');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('Updated queued text', { exact: true }).waitFor();
  assert.equal(last('queue.update').expectedInputRevision, 'd'.repeat(64));
  await close();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByRole('button', { name: '发送', exact: true }).waitFor();
  assert.deepEqual(last('turn.interruptActive'), {
    sessionId: 's1',
    expectedTurnId: 'native-turn',
  });
  await menu('设置');
  await page.getByRole('button', { name: '模型与输出', exact: true }).click();
  await page.getByLabel('默认模型', { exact: true }).selectOption('test-model');
  await page.getByRole('button', { name: '保存模型默认值' }).click();
  await page.getByText('已完成', { exact: true }).waitFor();
  assert.deepEqual(last('settings.modelDefaults'), {
    model: 'test-model',
    expectedUserRevision: 'c'.repeat(64),
  });
  await close();
  await menu('设置');
  await page.getByRole('button', { name: '常规', exact: true }).click();
  await page.getByLabel('外观', { exact: true }).selectOption('light');
  await close();
  await page.screenshot({ path: join(directory, 'desktop-light.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开会话列表', exact: true }).click();
  await page.getByRole('button', { name: '关闭侧栏', exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: join(directory, 'mobile-light.png') });
  assert.deepEqual(errors, []);
  console.log(
    'Workspace UI acceptance passed: themes, attachments/skills/Plan/model payload, failed-send draft retention, per-session drafts, goal revision, authorized files, Git, rename/pin, steer/queue/interrupt, model settings and mobile layout. Controlled host only; no live model or public pairing claim.',
  );
} catch (error) {
  await browser
    ?.contexts()[0]
    ?.pages()[0]
    ?.screenshot({ path: join(directory, 'failure.png') });
  throw error;
} finally {
  await browser?.close();
  await vite.close();
}

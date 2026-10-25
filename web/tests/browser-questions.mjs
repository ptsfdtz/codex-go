/* global window, CustomEvent */
// Controlled questions exercise the real UI; no production answer or model call.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startConversationServer } from './conversation-server.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const directory = resolve('artifacts/web-questions');
mkdirSync(directory, { recursive: true });
const { vite, state, origin } = await startConversationServer({
  cacheDir: resolve('.tmp/web-questions'),
  allowMutations: true,
});
state.extra = Array.from({ length: 3 }, (_, round) => ({
  turnId: `questions-${round}`,
  item: {
    id: `questions-${round}`,
    type: 'agentMessage',
    text: `第 ${round + 1} 轮问题`,
    questions: [
      { title: '最近在忙什么？' },
      { title: '你最喜欢哪本书？', options: ['百年孤独', '三体'] },
      { title: '如果今天可以去任何地方旅行，你会选哪里？' },
    ],
  },
}));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  await page.locator('.async-questions').first().waitFor();
  await page.getByLabel('消息', { exact: true }).fill('保留主输入框草稿');
  const count = () => state.rpc.filter((r) => r.action === 'turn.start').length;
  for (let round = 0; round < 3; round++) {
    if (round === 1) await page.setViewportSize({ width: 390, height: 844 });
    const card = page.locator('.async-questions').nth(round);
    const answer = card.getByLabel('你的回答', { exact: true });
    const starts = count();
    assert.equal(await card.getByRole('button', { name: '提交回答', exact: true }).count(), 0);
    await answer.fill('在学习和工作');
    await answer.press('Enter');
    await card.getByText('你最喜欢哪本书？', { exact: true }).waitFor();
    await card.getByRole('button', { name: '○ 三体', exact: true }).click();
    await card.getByText('如果今天可以去任何地方旅行，你会选哪里？', { exact: true }).waitFor();
    assert.equal(count(), starts, 'advancing never sends an answer');
    const submit = card.getByRole('button', { name: '提交回答', exact: true });
    assert.equal(await submit.isEnabled(), false);
    await answer.fill('京都');
    await answer.press('Enter');
    assert.equal(count(), starts, 'Enter on the last question never submits');
    await card.getByRole('button', { name: '上一个', exact: true }).click();
    assert.equal(await card.getByLabel('其他回答', { exact: true }).inputValue(), '三体');
    await card.getByRole('button', { name: '下一个', exact: true }).click();
    assert.equal(await answer.inputValue(), '京都', 'back navigation retains answers');
    const buttons = await card.locator('.question-actions').boundingBox();
    const submitBox = await submit.boundingBox();
    assert.ok(
      Math.abs(buttons.x + buttons.width - submitBox.x - submitBox.width) < 2,
      'submit sits on the right',
    );
    await card.screenshot({ path: resolve(directory, `round-${round + 1}.png`) });
    await submit.click();
    await card.getByText('已回答 Codex 的问题', { exact: true }).waitFor();
    assert.equal(count(), starts + 1, 'one explicit submission per round');
    const text = state.rpc.filter((r) => r.action === 'turn.start').at(-1).payload.text;
    for (const index of [0, 1, 2])
      assert.ok(
        text.includes(
          JSON.stringify(['request_user_input_async', `questions-${round}`, index]).replaceAll(
            '"',
            '\\"',
          ),
        ),
      );
  }
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), '保留主输入框草稿');
  state.approvals = [
    {
      approvalId: 'native-questions',
      sessionId: 's1',
      turnId: 'local-turn',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      allowedDecisions: ['approve', 'cancel'],
      context: {
        questions: [
          { id: 'one', question: '选择一个', options: [{ label: '选项 A' }] },
          { id: 'two', question: '最后的补充', options: [] },
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
  const approval = page.locator('.approval');
  await approval.getByRole('button', { name: '○ 选项 A', exact: true }).click();
  await approval.getByLabel('你的回答', { exact: true }).fill('补充内容');
  await approval.getByLabel('你的回答', { exact: true }).press('Enter');
  assert.equal(state.rpc.filter((r) => r.action === 'approvals.decide').length, 0);
  await approval.getByRole('button', { name: '提交回答', exact: true }).click();
  await approval.waitFor({ state: 'hidden' });
  assert.deepEqual(
    state.rpc.filter((r) => r.action === 'approvals.decide').at(-1).payload.answers,
    { one: { answers: ['选项 A'] }, two: { answers: ['补充内容'] } },
  );
  console.log(
    'Questions passed: three rounds, text/option advancement, retained back navigation, explicit final submission, native approvals, preserved composer draft and mobile footer.',
  );
} finally {
  await browser?.close();
  await vite.close();
}

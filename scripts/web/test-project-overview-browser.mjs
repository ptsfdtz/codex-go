/* global window, document, crypto, atob, TextEncoder */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/project-overview/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [],
  checks = [];
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1100, height: 800 } });
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => route.abort());
  await page.goto(process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1495');
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { ProjectOverview } = await import('/src/features/project-overview/ProjectOverview.tsx');
    const { overviewData } = await import('/src/features/project-overview/overview-data.ts');
    const { emptyDraft } = await import('/src/workspace.ts');
    document.getElementById('root').style.display = 'none';
    const root = document.createElement('header');
    root.className = 'topbar';
    root.style.justifyContent = 'flex-end';
    document.body.append(root);
    const image =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
    const bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0));
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
    const project = { projectId: 'one', name: 'AgentHub', canonicalPath: 'C:/Projects/AgentHub' };
    const reference = (path, name) => ({
      type: 'text',
      text: path,
      text_elements: [
        {
          byteRange: { start: 0, end: new TextEncoder().encode(path).length },
          placeholder: '@' + name,
        },
      ],
    });
    const entries = [
      {
        turnId: 'turn-one',
        item: {
          id: 'running-one',
          type: 'commandExecution',
          status: 'inProgress',
          command: 'pnpm --filter @agentdeck/web exec vite --host 127.0.0.1',
        },
      },
      {
        turnId: 'turn-one',
        item: {
          id: 'running-two',
          type: 'commandExecution',
          status: 'inProgress',
          command: 'pnpm --filter @agentdeck/web exec tsc --watch',
        },
      },
      {
        turnId: 'turn-one',
        item: {
          id: 'done',
          type: 'commandExecution',
          status: 'completed',
          command: 'DO-NOT-LIST-COMPLETED',
        },
      },
      {
        turnId: 'turn-one',
        item: {
          id: 'user-one',
          type: 'userMessage',
          content: [
            { type: 'localImage', path: 'C:/Private/Uploads/design-reference.png' },
            reference('C:/Projects/AgentHub/README.md', 'README.md'),
            reference('C:/Private/secret.txt', 'DO-NOT-LIST-OUTSIDE'),
            { type: 'image', url: 'https://example.invalid/DO-NOT-FETCH.png' },
          ],
        },
      },
    ];
    const draft = {
      ...emptyDraft(),
      references: [
        { projectId: 'one', name: 'App.tsx', path: 'web/src/App.tsx' },
        { projectId: 'other', name: 'DO-NOT-LIST-OTHER-PROJECT', path: 'other.txt' },
      ],
      attachments: [
        { name: 'layout-reference.png', mime: 'image/png', bytes: bytes.length, data: image },
      ],
    };
    const data = overviewData(entries, draft, project);
    if (data.processes.length !== 2 || data.sources.length !== 4)
      throw new Error('Scope/deduplication failure');
    window.overviewCalls = [];
    window.overviewFail = false;
    window.overviewBadImage = false;
    const request = async (action, payload) => {
      window.overviewCalls.push({ action, payload });
      if (action === 'git.status') {
        if (window.overviewFail) throw new Error('GIT-RETRY-TEST');
        return {
          available: true,
          files: [{ fileId: 'changed', path: 'web/src/App.tsx', worktree: 'M' }],
        };
      }
      if (action === 'sessions.image')
        return {
          ...payload,
          sha256: window.overviewBadImage ? '0'.repeat(64) : sha256,
          totalBytes: bytes.length,
          mime: 'image/png',
          data: image,
          nextOffset: null,
        };
      throw new Error(action);
    };
    function Test() {
      const [history, setHistory] = React.useState(entries);
      const [currentDraft, setDraft] = React.useState(draft);
      const [sessionId, setSession] = React.useState('session-one');
      window.overviewEmpty = () => {
        setHistory([]);
        setDraft(emptyDraft());
      };
      window.overviewComplete = () =>
        setHistory(
          entries.map((entry) =>
            entry.item.type === 'commandExecution'
              ? { ...entry, item: { ...entry.item, status: 'completed' } }
              : entry,
          ),
        );
      window.overviewSession = setSession;
      return React.createElement(ProjectOverview, {
        request,
        project,
        history,
        draft: currentDraft,
        connection: { request },
        sessionId,
        gitRead: true,
        fileBrowser: true,
        filesOpen: false,
        onOpen: () => {},
        onFiles: () => window.overviewCalls.push({ action: 'open-files' }),
        onChanges: () => window.overviewCalls.push({ action: 'open-changes' }),
        onFile: (path) => window.overviewCalls.push({ action: 'open-file', path }),
        onEntry: (entry) => window.overviewCalls.push({ action: 'open-entry', id: entry.item.id }),
        onAddSources: () => window.overviewCalls.push({ action: 'add-source' }),
      });
    }
    (dom.default || dom).createRoot(root).render(React.createElement(Test));
  });
  const trigger = page.getByRole('button', { name: '项目概览', exact: true });
  const card = page.getByRole('region', { name: '项目概览', exact: true });
  await trigger.click();
  await card.getByRole('button', { name: /改动/ }).waitFor();
  assert.equal(await card.getByRole('region', { name: '后台进程' }).getByRole('button').count(), 2);
  assert.equal(await card.getByText('DO-NOT-LIST-COMPLETED').count(), 0);
  await card.getByRole('button', { name: /查看全部来源/ }).click();
  assert.equal(await card.getByText('DO-NOT-LIST-OUTSIDE').count(), 0);
  assert.equal(await card.getByText('DO-NOT-LIST-OTHER-PROJECT').count(), 0);
  await card.getByRole('button', { name: /README.md/ }).click();
  assert.equal(await page.evaluate(() => window.overviewCalls.at(-1).path), 'README.md');
  await trigger.click();
  await card.getByRole('button', { name: '添加图片', exact: true }).click();
  assert.equal(await page.evaluate(() => window.overviewCalls.at(-1).action), 'add-source');
  await card.getByRole('button', { name: 'layout-reference.png', exact: true }).click();
  await page.getByRole('dialog', { name: 'layout-reference.png', exact: true }).waitFor();
  await page.locator('.project-overview-preview').evaluate((image) => image.decode());
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert(await card.isVisible());
  await card.getByRole('button', { name: /查看全部来源/ }).click();
  await page.evaluate(() => (window.overviewBadImage = true));
  await card.getByRole('button', { name: 'design-reference.png', exact: true }).click();
  await page.getByRole('alert').waitFor();
  const imageCall = await page.evaluate(() =>
    window.overviewCalls.find((call) => call.action === 'sessions.image'),
  );
  assert.deepEqual(imageCall.payload, {
    sessionId: 'session-one',
    turnId: 'turn-one',
    itemId: 'user-one',
    contentIndex: 0,
    offset: 0,
  });
  await page.evaluate(() => (window.overviewBadImage = false));
  await page.getByRole('button', { name: '重试读取图片', exact: true }).click();
  await page.locator('.project-overview-preview').evaluate((image) => image.decode());
  await page.evaluate(() => window.overviewSession('session-two'));
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  checks.push(
    'sources scoped to current project/chat; draft preview; historical image identity/hash verification and retry; switching chats closes preview',
  );
  for (const width of [1100, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(50);
    // Changing breakpoints closes the card, as in the production component.
    if (!(await card.isVisible())) await trigger.click();
    for (const theme of ['dark', 'light']) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      await page.waitForTimeout(200);
      const box = await card.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 800);
      await card.screenshot({
        path: fileURLToPath(new URL(`overview-${theme}-${width}.png`, out)),
      });
    }
  }
  await card
    .getByRole('region', { name: '后台进程', exact: true })
    .getByRole('button')
    .first()
    .click();
  assert.deepEqual(await page.evaluate(() => window.overviewCalls.at(-1)), {
    action: 'open-entry',
    id: 'running-one',
  });
  await trigger.click();
  await page.evaluate(() => window.overviewComplete());
  await card.getByText('当前会话暂无运行中的命令', { exact: true }).waitFor();
  await page.evaluate(() => window.overviewEmpty());
  await card.getByText('当前会话暂无附件或文件引用', { exact: true }).waitFor();
  await page.evaluate(() => (window.overviewFail = true));
  await card.getByRole('button', { name: '刷新项目概览' }).click();
  await card.getByText('GIT-RETRY-TEST').waitFor();
  await page.evaluate(() => (window.overviewFail = false));
  await card.getByRole('button', { name: '重试读取' }).click();
  await card.getByRole('button', { name: /改动/ }).click();
  assert.equal(await page.evaluate(() => window.overviewCalls.at(-1).action), 'open-changes');
  checks.push(
    'running/completed updates; empty sources; Git error/retry and changes navigation; light/dark 320/390/1100px bounds',
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

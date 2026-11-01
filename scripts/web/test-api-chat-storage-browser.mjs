/* global window */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ locale: 'zh-CN' });
  await context.route('**/api/**', (route) => route.fulfill({ status: 401, body: '{}' }));
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  for (const page of pages) {
    await page.goto(process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1430');
    await page.evaluate(async () => {
      const { LocalStore } = await import('/src/features/api-chat/local.ts');
      window.store = new LocalStore('storage-race-test');
      window.chat = (id, status, content) => ({
        id,
        title: 'isolated',
        providerId: 'fake',
        model: 'fake',
        updatedAt: '2026-11-01',
        messages: [{ id: 'reply', role: 'assistant', status, content }],
      });
    });
  }
  const [writer, reader] = pages;
  await writer.evaluate(() => window.store.saveChat(window.chat('recovery', 'running', 'partial')));
  await reader.evaluate(async () => {
    window.stale = await window.store.read('chat', 'recovery');
  });
  await writer.evaluate(() => window.store.saveChat(window.chat('recovery', 'complete', 'FINAL')));
  const recovered = await reader.evaluate(() => window.store.recoverChat('recovery'));
  assert.equal(recovered.messages[0].content, 'FINAL');
  assert.equal(recovered.messages[0].status, 'complete');
  assert.equal(recovered.uncertain, undefined);
  await writer.evaluate(() => window.store.saveChat(window.chat('orphan', 'running', 'partial')));
  const orphan = await reader.evaluate(() => window.store.recoverChat('orphan'));
  assert.equal(orphan.messages[0].content, 'partial');
  assert.equal(orphan.messages[0].status, 'interrupted');
  assert.equal(orphan.uncertain, true);
  // No broadcast is sent: the persistent transaction guard alone must win.
  await writer.evaluate(() => window.store.deleteChat('recovery'));
  assert.equal(await reader.evaluate(() => window.store.saveChat(window.stale)), undefined);
  // The stale snapshot uses the same id; a late final flush cannot resurrect it either.
  assert.equal(
    await reader.evaluate(() => window.store.saveChat(window.chat('recovery', 'complete', 'late'))),
    undefined,
  );
  for (let i = 0; i < 10; i++) {
    await Promise.all([
      writer.evaluate(
        (id) => window.store.saveChat(window.chat(id, 'complete', 'flush')),
        `race-${i}`,
      ),
      reader.evaluate((id) => window.store.deleteChat(id), `race-${i}`),
    ]);
    assert.equal(
      await writer.evaluate((id) => window.store.read('chat', id), `race-${i}`),
      undefined,
    );
    assert.equal(
      await writer.evaluate((id) => window.store.read('summary', id), `race-${i}`),
      undefined,
    );
  }
  await reader.reload();
  const deleted = await reader.evaluate(async () => {
    const { LocalStore } = await import('/src/features/api-chat/local.ts');
    const store = new LocalStore('storage-race-test');
    return {
      recovered: await store.recoverChat('recovery'),
      chat: await store.read('chat', 'recovery'),
      summary: await store.read('summary', 'recovery'),
    };
  });
  assert.deepEqual(deleted, { recovered: undefined, chat: undefined, summary: undefined });
  const otherScope = await writer.evaluate(async () => {
    const { LocalStore } = await import('/src/features/api-chat/local.ts');
    return new LocalStore('other-account').saveChat(
      window.chat('recovery', 'complete', 'separate'),
    );
  });
  assert.equal(otherScope.messages[0].content, 'separate');
  console.log(
    'PASS: real two-tab IndexedDB recovery preserves final replies; orphan recovery retains partial text; delete wins against stale and concurrent saves without broadcast, survives reload and preserves account isolation.',
  );
} finally {
  await browser.close();
}

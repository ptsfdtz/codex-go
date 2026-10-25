/* global document, localStorage */
// Explicit real acceptance only. Requires the ignored Linux live_browser_fixture
// and SSH loopback forwarding. Does not intercept or fake any API/RPC response.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
const fixturePath = process.argv[2];
assert.ok(fixturePath, 'Supply the private browser-fixture.json path');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
assert.equal(fixture.origin, 'https://127.0.0.1:18444');
const pairOnly = process.argv.includes('--account-only') || process.argv.includes('--pair-only');
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const control = (action, code) =>
  execFileSync(
    'ssh',
    [
      process.env.AGENTDECK_ACCEPTANCE_SSH || 'marsIntranet',
      'runuser -u agentdeck-acceptance -- /opt/agentdeck-acceptance/codex/bin/node /opt/agentdeck-acceptance/harness/browser-control.mjs /var/lib/agentdeck-acceptance/browser-state ' +
        action +
        (code ? ' ' + code : ''),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
process.env.VITE_CLOUD_ORIGIN = fixture.origin;
const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  server: { host: '127.0.0.1', port: 5174, strictPort: true, open: false },
});
await vite.listen();
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    args: ['--ignore-certificate-errors'],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5174');
  await page.getByLabel('用户名', { exact: true }).fill(fixture.username);
  await page.getByLabel('密码', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.connection.online-text').waitFor({ timeout: 30000 });
  assert.equal(await page.getByLabel('公网配对信息', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '请求配对', exact: true }).count(), 0);
  const cloudDeviceId = await page.evaluate(async () => {
    const { api } = await import('/src/cloud.ts');
    return (await api('/api/v1/web/session')).cloudDeviceId;
  });
  await page.waitForFunction(() => document.querySelectorAll('aside select option').length > 1);
  const report = {
    at: new Date().toISOString(),
    realCloud: true,
    realPostgres: true,
    realNativeTls: true,
    accountAuthorized: true,
    noPairing: true,
    grantRestored: false,
    realModel: false,
  };
  if (!pairOnly) {
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext('2d');
      context.fillStyle = 'red';
      context.fillRect(0, 0, 32, 32);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('.attachment-picker input').setInputFiles({
      name: 'red.png',
      mimeType: 'image/png',
      buffer: Buffer.from(image, 'base64'),
    });
    await page
      .locator('.composer textarea')
      .fill(
        'Look at the attached image. Reply exactly AGENTDECK_BROWSER_IMAGE_OK. Do not run tools or modify files.',
      );
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.turn')].some(
          (item) =>
            item.querySelector('.role')?.textContent === 'Codex' &&
            item.textContent.includes('AGENTDECK_BROWSER_IMAGE_OK'),
        ),
      null,
      { timeout: 180000 },
    );
    await page.getByRole('button', { name: '读取历史图片', exact: true }).first().click();
    await page.locator('.saved-image img').first().waitFor({ timeout: 30000 });
    report.realModel = true;
    report.imageHistory = true;
    await page.getByRole('button', { name: '发送', exact: true }).waitFor();
    await page
      .locator('.composer textarea')
      .fill(
        'Request approval before running: cat /var/lib/agentdeck-acceptance/approval-marker.txt outside the authorized workspace. If rejected, stop immediately and do not retry.',
      );
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.locator('.approval').waitFor({ timeout: 60000 });
    await page.locator('.approval').getByRole('button', { name: '拒绝', exact: true }).click();
    await page.locator('.approval').waitFor({ state: 'detached', timeout: 30000 });
    await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 30000 });
    report.approvalRejected = true;
    await page
      .locator('.composer textarea')
      .fill(
        'Write a numbered list of 2000 distinct short English sentences. Do not use tools or modify files.',
      );
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('button', { name: '停止', exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 30000 });
    report.turnInterrupted = true;
  }
  // A fresh document obtains a fresh account grant and restores selection.
  await page.reload();
  await page.locator('.connection.online-text').waitFor({ timeout: 30000 });
  report.grantRestored = true;
  if (!pairOnly) await page.getByText('AGENTDECK_BROWSER_IMAGE_OK', { exact: true }).waitFor();
  if (!pairOnly) {
    const count = await page.evaluate(async () => {
      const { api } = await import('/src/cloud.ts');
      const { Bridge } = await import('/src/transport/bridge.ts');
      const { mergeHistory, historyKey } = await import('/src/history.ts');
      const account = await api('/api/v1/web/session'),
        scope = account.accountId + ':' + account.cloudDeviceId;
      const selected = JSON.parse(localStorage.getItem('agentdeck.web.selection.' + scope));
      const connection = new Bridge(scope);
      await connection.connect(
        await api('/api/v1/hosts/' + encodeURIComponent(selected.hostId) + '/access', {
          method: 'POST',
        }),
      );
      try {
        let cursor,
          entries = [],
          pages = 0;
        do {
          const page = await connection.request('sessions.history', {
            sessionId: selected.sessionId,
            limit: 2,
            sortDirection: 'desc',
            ...(cursor ? { cursor } : {}),
          });
          if (page.resource)
            throw new Error(
              'Small live acceptance history unexpectedly requires resource recovery',
            );
          entries = mergeHistory(entries, [...page.data].reverse(), 'older');
          cursor = page.nextCursor;
          if (++pages > 100) throw new Error('History cursor did not terminate');
        } while (cursor);
        if (pages < 2 || entries.length !== new Set(entries.map(historyKey)).size)
          throw new Error('Native pagination failed');
        return pages;
      } finally {
        connection.close();
      }
    });
    report.nativeHistoryPages = count;
  }
  await context.setOffline(true);
  await page.waitForFunction(() => !document.querySelector('.connection.online-text'), null, {
    timeout: 45000,
  });
  await context.setOffline(false);
  await page.locator('.connection.online-text').waitFor({ timeout: 45000 });
  report.networkRecovered = true;
  const second = await context.newPage();
  await second.goto('http://127.0.0.1:5174');
  await second.locator('.connection.online-text').waitFor({ timeout: 30000 });
  control('revoke', cloudDeviceId);
  await page.waitForFunction(() => !document.querySelector('.connection.online-text'), null, {
    timeout: 30000,
  });
  await second.waitForFunction(() => !document.querySelector('.connection.online-text'), null, {
    timeout: 30000,
  });
  report.nativeRevocation = true;
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await second.getByRole('button', { name: '登录', exact: true }).waitFor({ timeout: 15000 });
  report.crossTabLogout = true;
  await writeFile(
    new URL('../../.tmp/linux-acceptance/browser-result.json', import.meta.url),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await vite.close();
}

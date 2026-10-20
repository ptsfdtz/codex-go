import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const QRCode = require('qrcode') as {
  toDataURL: (text: string) => Promise<string>;
};
const fixture = {
  revision: 2,
  running: true,
  error: null,
  pairing: null,
  qr: null as null | Record<string, string>,
  state: {
    codexReady: true,
    sandboxVerified: true,
    projects: [
      { projectId: 'one', name: 'AgentDeck', canonicalPath: 'C:\\Projects\\AgentDeck' },
      { projectId: 'two', name: 'Design System', canonicalPath: 'C:\\Projects\\Design System' },
      { projectId: 'three', name: '我的工作区', canonicalPath: 'C:\\Projects\\我的工作区' },
      { projectId: 'four', name: 'research', canonicalPath: 'C:\\Projects\\research' },
    ],
    devices: [] as Record<string, unknown>[],
    approvals: [] as Record<string, unknown>[],
    addresses: ['127.0.0.1', '192.168.1.9'],
    listenAddress: '192.168.1.9',
    endpoint: 'https://192.168.1.9:49321',
    lastWorkspaceSync: new Date().toISOString(),
  },
};
async function setup(page: Page, value = fixture) {
  await page.route('**/src/host.ts', async (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
    export const emptyView=${JSON.stringify({ ...value, revision: -1 })};
    let state=${JSON.stringify(value)},listener;
    window.__fixtureActions=[];
    window.__fixtureEmit=(next)=>{state=next;listener?.(next);};
    export const host={snapshot:async()=>state,subscribe:async(fn)=>{listener=fn;return()=>{};},localRequests:async()=>()=>{},action:async(action)=>{window.__fixtureActions.push(action);},pickProject:async()=>null,quit:async()=>{}};
  `,
    }),
  );
  await page.goto('/');
  await expect(page.getByText('Codex 已就绪')).toBeVisible();
  await page.evaluate(() => {
    const badge = document.createElement('div');
    badge.textContent = 'UI FIXTURE · NOT LIVE';
    badge.style.cssText =
      'position:fixed;bottom:3px;left:50%;transform:translateX(-50%);font:9px monospace;color:#8d967c;z-index:99';
    document.body.append(badge);
  });
}
test('home renders at three window sizes, without overflow', async ({ page }) => {
  const v = structuredClone(fixture);
  v.qr = {
    image: (await QRCode.toDataURL('AGENTDECK_UI_FIXTURE_ONLY')).split(',')[1]!,
    endpoint: 'https://192.168.1.9:49321',
    fingerprint: '0'.repeat(64),
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  };
  await setup(page, v);
  for (const [width, height] of [
    [1000, 700],
    [780, 600],
    [1200, 800],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByRole('button', { name: '同步工作区' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
      true,
    );
    await expect(page.getByAltText('使用 AgentDeck 平板端扫描此配对码')).toBeVisible();
    await page.screenshot({ path: `../artifacts/tauri-ui-fixture-${width}x${height}.png` });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(240, 240, 240)');
  await page.screenshot({ path: '../artifacts/tauri-pair-dark-fixture.png' });
});
test('workspace management is optional, searchable, and keyboard dismissible', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '工作区 4' }).click();
  await page.getByRole('textbox', { name: '搜索工作区' }).fill('我的工作区');
  await expect(page.getByText('C:\\Projects\\我的工作区', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Design System', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('expired QR is removed, never left scannable', async ({ page }) => {
  const v = structuredClone(fixture);
  v.qr = {
    image: (await QRCode.toDataURL('EXPIRED_FIXTURE_ONLY')).split(',')[1]!,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    endpoint: 'https://192.168.1.9:49321',
    fingerprint: '0'.repeat(64),
  };
  await setup(page, v);
  await expect(page.getByText('配对码已过期')).toBeVisible();
  await expect(page.getByAltText('使用 AgentDeck 平板端扫描此配对码')).toHaveCount(0);
});
test('connected tablet replaces pairing and service loss removes live status', async ({ page }) => {
  const v = structuredClone(fixture);
  v.state.devices = [{ deviceId: 'fixture', displayName: 'Xiaomi Pad 7', connected: true }];
  await setup(page, v);
  await expect(page.getByText('Xiaomi Pad 7')).toBeVisible();
  await expect(page.getByText('已连接', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '连接平板' })).toBeVisible();
  await expect(page.getByRole('button', { name: '显示配对码' })).toHaveCount(0);
  await page.screenshot({ path: '../artifacts/tauri-connected-fixture.png' });
  await page.evaluate(
    (next) => (window as unknown as { __fixtureEmit: (v: unknown) => void }).__fixtureEmit(next),
    {
      ...v,
      revision: 3,
      running: false,
      state: {
        ...v.state,
        codexReady: false,
        devices: [{ ...v.state.devices[0], connected: false }],
      },
      error: '连接中断 · 测试替身',
    },
  );
  await expect(page.getByRole('banner').getByText('服务未连接', { exact: true })).toBeVisible();
  await expect(page.getByText('已连接', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('连接中断');
});

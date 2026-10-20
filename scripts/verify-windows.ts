import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { Dpapi, certificate, restrictDirectory } from '../bridge/src/security.js';
import { nativeHelper } from '../bridge/src/native.js';

const root = await mkdtemp(join(tmpdir(), 'agentdeck-native-'));
await restrictDirectory(root);
const protector = new Dpapi();
const input = Buffer.from('AgentDeck DPAPI verification (not a credential)');
const encrypted = await protector.protect(input);
if (encrypted.equals(input) || !(await protector.unprotect(encrypted)).equals(input))
  throw new Error('DPAPI roundtrip failed');
const first = await certificate(root, protector),
  second = await certificate(root, protector);
if (first.fingerprint !== second.fingerprint || first.key !== second.key)
  throw new Error('Certificate persistence failed');
const ui = spawn(nativeHelper('HostUi'), ['--verify-state'], {
  shell: false,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let diagnostics = '';
ui.stderr.on('data', (b: Buffer) => {
  diagnostics += b.toString();
});
const reports: Record<string, unknown>[] = [];
const waiters: ((value: Record<string, unknown>) => void)[] = [];
const reader = createInterface({ input: ui.stdout });
reader.on('line', (line) => {
  const row = JSON.parse(line) as Record<string, unknown>;
  if ('action' in row) throw new Error('Native render verification must not emit human decisions');
  reports.push(row);
  waiters.shift()?.(row);
});
const exited = once(ui, 'close');
async function inspect(type: string, payload: unknown): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Native UI inspection timed out: ' + diagnostics)),
      10000,
    );
    waiters.push((value) => {
      clearTimeout(timeout);
      resolve(value);
    });
    ui.stdin.write(JSON.stringify({ type, payload }) + '\n');
  });
}
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const fixture = {
  windowTitle: 'AgentDeck · Native verification fixture',
  status: 'Native render test',
  endpoint: 'https://192.168.1.20:49321',
  listenAddress: '192.168.1.20',
  codexReady: true,
  projects: [
    { name: '中文网站项目', projectId: 'p', canonicalPath: 'C:\\Projects\\中文网站' },
    { name: 'Second', projectId: 'second', canonicalPath: 'C:\\Projects\\second' },
  ],
  devices: [],
  addresses: ['127.0.0.1', '192.168.1.20'],
  approvals: [
    {
      method: 'item/commandExecution/requestApproval',
      approvalId: 'a',
      sessionId: 's',
      turnId: 't',
      sessionTitle: '人工审批界面测试',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      allowedDecisions: ['approve', 'reject'],
      context: {
        command: 'Write-Output TEST',
        cwd: 'C:\\Projects\\中文网站',
        longContext: 'review '.repeat(3000),
      },
    },
  ],
};
try {
  const rendered = await inspect('state', fixture);
  assert(
    rendered.borderless && !rendered.sidebarVisible,
    'The simplified window must have no system title bar or sidebar',
  );
  assert(
    rendered.projects === 2 && rendered.approvals === 1 && rendered.approvalTabVisible,
    'Native approval visibility failed',
  );
  assert(rendered.approveEnabled && rendered.rejectEnabled, 'Pending approval buttons missing');
  assert(
    String(rendered.approvalContext).includes('中文网站') &&
      String(rendered.approvalContext).length > 18000,
    'Full Unicode approval context was not retained',
  );
  assert(
    rendered.selectedAddress === '192.168.1.20',
    'LAN address selection must prefer the existing listener',
  );
  for (const [width, height] of [
    [700, 560],
    [780, 620],
    [1120, 740],
  ]) {
    for (const page of ['pair', 'projects', 'approvals', 'devices']) {
      const layout = await inspect('verify.layout', { width, height, page });
      assert(layout.buttonsFit, `Clipped action controls: ${width}x${height} ${page}`);
    }
  }
  await inspect('verify.selectProject', { projectId: 'second' });
  const refreshed = await inspect('state', {
    ...fixture,
    projects: fixture.projects.map((p) => ({ ...p, name: p.name + ' updated' })),
  });
  assert(
    refreshed.selectedProject === 'second' && refreshed.projectPath === 'C:\\Projects\\second',
    'State refresh lost selection or path detail',
  );
  const expired = await inspect('state', {
    ...fixture,
    approvals: fixture.approvals.map((a) => ({ ...a, expiresAt: '2020-01-01T00:00:00Z' })),
  });
  assert(
    !expired.approveEnabled && !expired.rejectEnabled,
    'Expired approval must disable both decisions',
  );
  const denyOnly = await inspect('state', {
    ...fixture,
    approvals: fixture.approvals.map((a) => ({ ...a, allowedDecisions: ['reject'] })),
  });
  assert(
    !denyOnly.approveEnabled && denyOnly.rejectEnabled,
    'Unsupported allow must remain disabled',
  );
  const cleared = await inspect('state', { ...fixture, approvals: [] });
  assert(
    cleared.approvals === 0 && !cleared.approveEnabled && !cleared.rejectEnabled,
    'Resolved request retained active actions',
  );
  const image =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
  ui.stdin.write(
    JSON.stringify({
      type: 'pair.qr',
      payload: {
        image,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        endpoint: fixture.endpoint,
        fingerprint: 'a'.repeat(64),
      },
    }) + '\n',
  );
  const qr = await inspect('verify.inspect', {});
  assert(qr.qrVisible && qr.copyPairingEnabled, 'Unexpired QR must be readable');
  ui.stdin.write(
    JSON.stringify({
      type: 'pair.qr',
      payload: {
        image,
        expiresAt: '2020-01-01T00:00:00Z',
        endpoint: fixture.endpoint,
        fingerprint: 'a'.repeat(64),
      },
    }) + '\n',
  );
  const expiredQr = await inspect('verify.inspect', {});
  assert(!expiredQr.qrVisible && !expiredQr.copyPairingEnabled, 'Expired QR remains usable');
  ui.stdin.end(JSON.stringify({ type: 'exit', payload: {} }) + '\n');
  const [code] = await exited;
  assert(code === 0, 'Native management window failed: ' + diagnostics);
  const report = {
    at: new Date().toISOString(),
    result: 'PASS',
    dpapiRoundtrip: true,
    persistedCertificate: true,
    nativeUiStartupExit: true,
    approvalTabVisible: true,
    layoutChecks: 12,
    unicodeAndLongContext: true,
    refreshPreservesSelection: true,
    expiredAndUnsupportedDecisionsDisabled: true,
    qrExpiry: true,
    borderless: true,
    noSidebar: true,
    scope:
      'Isolated native render/state/layout verification; no real human approval or pairing submitted',
  };
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/windows-native.json'), JSON.stringify(report, null, 2));
  console.log(report);
} finally {
  if (ui.exitCode === null) ui.kill();
  reader.close();
}

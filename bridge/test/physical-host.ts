import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import QRCode from 'qrcode';
import { Store } from '../src/store.js';
import { ProjectRegistry } from '../src/projects.js';
import { Supervisor, findCodex } from '../src/codex.js';
import { Tasks } from '../src/tasks.js';
import { Approvals } from '../src/approvals.js';
import { Desktop } from '../src/desktop.js';
import { Pairing } from '../src/pairing.js';
import { certificate, Dpapi, localAddresses, restrictDirectory } from '../src/security.js';
import { BridgeServer } from '../src/server.js';
import { GitService, gitCommand } from '../src/git.js';
import { verifySandbox } from '../../scripts/verify-sandbox.js';
import { safeError } from '../src/errors.js';
import readline from 'node:readline';

// Explicit test harness: temporary project grants, real TLS, no automatic device/command approvals.
const address = process.env.AGENTDECK_TEST_ADDRESS;
if (!address || !localAddresses().includes(address))
  throw new Error('Set AGENTDECK_TEST_ADDRESS to an assigned private LAN IPv4');
const resuming = process.env.AGENTDECK_PHYSICAL_RESUME_ROOT;
const root = resuming ? resolve(resuming) : await mkdtemp(join(tmpdir(), 'agentdeck-physical-'));
await restrictDirectory(root);
const store = new Store(join(root, 'state.db')),
  registry = new ProjectRegistry(store),
  upstream = new Supervisor(findCodex()),
  tasks = new Tasks(store, registry, upstream),
  approvals = new Approvals(store, tasks),
  desktop = new Desktop(),
  protector = new Dpapi(),
  pairing = new Pairing(store, protector);
if (resuming && store.meta('physicalTestHarness') !== '1')
  throw new Error('Resume is restricted to a previously marked physical test harness');
store.setMeta('physicalTestHarness', '1');
store.recover();
const tls = await certificate(root, protector),
  server = new BridgeServer(store, tasks, approvals, pairing, new GitService(registry), tls, {
    requestProjectAdd: () => {},
    requestProjectRemove: () => {},
  });
const state = () =>
  desktop.send('state', {
    windowTitle: 'AgentDeck - Pad Wi-Fi Test',
    status: `PHYSICAL PAD TEST | https://${address}:49323 | ${upstream.ready ? 'Codex ready' : 'starting'}`,
    projects: store.projects(),
    devices: store.db.prepare('SELECT * FROM devices WHERE revokedAt IS NULL').all(),
    approvals: store.approvals(),
    addresses: [address],
  });
let stopping = false;
const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  if (line === 'invite') void invitation();
  if (line === 'stop') void close();
  if (line === 'approval') void humanApproval().catch((e) => console.error(safeError(e)));
  // Explicit opt-in test control, local stdin only; deliberately skips graceful cleanup.
  if (line === 'crash') process.exit(86);
});
let approvalTestRunning = false;
async function humanApproval() {
  if (approvalTestRunning) throw new Error('A human approval test is already running');
  approvalTestRunning = true;
  try {
    const session = await tasks.create(store.projects()[0]!.projectId, 'Pad human approval test');
    const turn = await tasks.start(
      session.sessionId,
      'Controlled human approval transport test. Use your shell tool to run exactly Write-Output AGENTDECK_APPROVAL_OK in PowerShell in the current workspace. Request sandbox_permissions=require_escalated and justification="AgentDeck human approval transport verification". Do not read or modify files, use the network, or execute any other command. If rejected, stop and report rejection.',
    );
    console.log(
      'PAD_HUMAN_APPROVAL: Open the tablet home, then View approval. Only a human may decide.',
    );
    const deadline = Date.now() + 7 * 60000;
    while (Date.now() < deadline) {
      if (stopping) return;
      const current = store.turn(turn.turnId);
      if (['completed', 'failed', 'interrupted'].includes(current.status)) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    const rows = store.db
      .prepare('SELECT approvalId,method,status FROM approvals WHERE turnId=?')
      .all(turn.turnId) as { approvalId: string; method: string; status: string }[];
    const human = rows.find((r) => ['approved', 'rejected'].includes(r.status));
    const authenticatedDecisions = store.db
      .prepare("SELECT responseJson FROM requests WHERE status='done' AND createdAt>=?")
      .all(turn.startedAt)
      .map(
        (row) =>
          JSON.parse((row as { responseJson: string }).responseJson) as {
            action: string;
            payload: { status?: string };
          },
      )
      .filter(
        (response) =>
          response.action === 'approvals.decide' && response.payload.status === human?.status,
      );
    const commands = store
      .history(session.sessionId, undefined, 500)
      .filter((e) => e.action === 'turn.progress')
      .map(
        (e) =>
          e.payload as {
            method?: string;
            item?: { type?: string; exitCode?: number; aggregatedOutput?: string };
          },
      )
      .filter((e) => e.method === 'item/completed' && e.item?.type === 'commandExecution')
      .map((e) => ({
        exitCode: e.item!.exitCode,
        markerObserved: e.item!.aggregatedOutput?.trim() === 'AGENTDECK_APPROVAL_OK',
      }));
    let duplicateRejected = false;
    if (human) {
      try {
        await approvals.decide(
          session.sessionId,
          turn.turnId,
          human.approvalId,
          human.status === 'approved' ? 'approve' : 'reject',
        );
      } catch {
        duplicateRejected = true;
      }
    }
    const report = {
      at: new Date().toISOString(),
      source:
        'Real LAN host; normal tablet UI; authenticated WSS decision audit; no automatic decisions',
      result:
        human &&
        authenticatedDecisions.length === 1 &&
        (human.status === 'rejected' ||
          commands.some((c) => c.exitCode === 0 && c.markerObserved)) &&
        duplicateRejected &&
        ['completed', 'failed', 'interrupted'].includes(store.turn(turn.turnId).status)
          ? 'PASS'
          : 'SKIPPED',
      sessionId: session.sessionId,
      turnId: turn.turnId,
      humanDecision: human?.status,
      duplicateRejected,
      terminal: store.turn(turn.turnId).status,
      requests: rows,
      authenticatedTabletDecisions: authenticatedDecisions.length,
      commands,
    };
    const filename = `artifacts/physical-human-approval-${human?.status ?? 'unconfirmed'}.json`;
    await writeFile(resolve(filename), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    approvalTestRunning = false;
  }
}
async function close() {
  if (stopping) return;
  stopping = true;
  input.close();
  approvals.invalidate();
  approvals.close();
  pairing.close();
  await server.close();
  const exited = upstream.rpc.alive ? once(upstream.rpc, 'exit') : null;
  upstream.stop();
  if (exited) await exited;
  desktop.close();
  store.close();
}
async function invitation() {
  const qr = pairing.createLocal(`https://${address}:49323`, tls.fingerprint);
  const image = await QRCode.toBuffer(JSON.stringify(qr), { width: 512, margin: 2 });
  desktop.send('pair.qr', { ...qr, image: image.toString('base64') });
  await writeFile(join(root, 'physical-qr.json'), JSON.stringify(qr));
  const adb = join(process.env.LOCALAPPDATA!, 'Android/Sdk/platform-tools/adb.exe');
  execFileSync(
    adb,
    [
      '-s',
      'd1420d4',
      'push',
      join(root, 'physical-qr.json'),
      '/sdcard/Download/agentdeck-test-qr.json',
    ],
    { shell: false, windowsHide: true, stdio: 'ignore' },
  );
  console.log('Fresh QR delivered to test device. Human Windows confirmation is still required.');
}
desktop.on('action', (a: Record<string, unknown>) => {
  void (async () => {
    switch (a.action) {
      case 'pair.confirm':
        await pairing.confirmLocal(String(a.requestId), a.approve === true);
        break;
      case 'pair.create':
        await invitation();
        break;
      case 'approval.decide':
        await approvals.decide(
          String(a.sessionId),
          String(a.turnId),
          String(a.approvalId),
          a.decision as 'approve' | 'reject' | 'cancel',
        );
        break;
      case 'stop':
        await close();
        break;
    }
    if (!stopping) state();
  })().catch((e) => desktop.send('error', { message: safeError(e) }));
});
pairing.on('confirmation', (p) => desktop.send('pair.confirm', p));
pairing.on('devicesChanged', state);
store.on('event', (e) => {
  if (['approval.requested', 'approval.resolved'].includes(e.action)) state();
});
desktop.on('closed', () => void close());
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
try {
  state();
  const boundary = await verifySandbox();
  if (!boundary.passed) throw new Error('Sandbox boundary failed');
  store.setMeta('sandboxVerifiedVersion', '0.159.2');
  await upstream.start();
  for (const name of resuming ? [] : ['pad-one', 'pad-two']) {
    const path = join(root, name);
    await mkdir(path);
    await gitCommand(path, ['init']);
    await writeFile(
      join(path, 'external-change.txt'),
      'This real working-tree change predates the Codex task.\n',
    );
    await registry.addLocal(path);
  }
  await server.listen(address, 49323);
  state();
  if (!resuming) await invitation();
  console.log(`Physical test data: ${root}`);
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    resolve('artifacts/physical-host.json'),
    JSON.stringify({
      at: new Date().toISOString(),
      endpoint: `https://${address}:49323`,
      result: 'READY_FOR_HUMAN_PAIRING',
      temporaryProjects: true,
    }),
  );
} catch (e) {
  console.error(safeError(e));
  await close();
  process.exitCode = 1;
}

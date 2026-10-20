import { join, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import QRCode from 'qrcode';
import { Store } from './store.js';
import { ProjectRegistry } from './projects.js';
import { findCodex, verifyCodex, Supervisor, CODEX_VERSION } from './codex.js';
import { Tasks } from './tasks.js';
import { Approvals } from './approvals.js';
import { Pairing } from './pairing.js';
import {
  certificate,
  Dpapi,
  localAddresses,
  restrictDirectory,
  restoreListenAddress,
} from './security.js';
import { GitService } from './git.js';
import { BridgeServer } from './server.js';
import { Desktop } from './desktop.js';
import { verifySandbox } from '../../scripts/verify-sandbox.js';
import { invariant, safeError } from './errors.js';
import { log, redact } from './log.js';

invariant(
  process.platform === 'win32',
  'UNSUPPORTED_PLATFORM',
  'AgentDeck Bridge v1 runs on Windows',
);
const directory = process.env.AGENTDECK_DATA_DIR
  ? resolve(process.env.AGENTDECK_DATA_DIR)
  : join(process.env.LOCALAPPDATA!, 'AgentDeck');
await restrictDirectory(directory);
const store = new Store(join(directory, 'agentdeck.db'));
store.recover();
store.retain();
const exe = findCodex();
verifyCodex(exe);
const desktop = new Desktop();
const projects = new ProjectRegistry(store);
const protector = new Dpapi();
const tls = await certificate(directory, protector);
const pairing = new Pairing(store, protector);
const supervisor = new Supervisor(exe);
const tasks = new Tasks(store, projects, supervisor);
const approvals = new Approvals(store, tasks);
const git = new GitService(projects);
let server: BridgeServer;
const port = Number(process.env.AGENTDECK_PORT ?? 49321);
invariant(Number.isInteger(port) && port > 1024 && port <= 65535, 'CONFIG_ERROR', 'Invalid port');
const makeServer = () =>
  new BridgeServer(store, tasks, approvals, pairing, git, tls, {
    requestProjectAdd: () => desktop.send('project.addRequest', {}),
    requestProjectRemove: (projectId) => desktop.send('project.removeRequest', { projectId }),
  });
server = makeServer();
let address = restoreListenAddress(store.meta('listenAddress'), tls.cert);
await server.listen(address, port);
let stopping = false;
let localBusy = false;
const retention = setInterval(() => store.retain(), 10 * 60 * 1000);
retention.unref();
const state = () =>
  desktop.send('state', {
    status: `Bridge ${supervisor.ready ? 'connected to Codex' : 'starting / disconnected'} | https://${address}:${port} | ${store.meta('sandboxVerifiedVersion') === CODEX_VERSION ? 'Sandbox verified' : 'Verifying sandbox...'}`,
    endpoint: `https://${address}:${port}`,
    listenAddress: address,
    codexReady: supervisor.ready,
    sandboxVerified: store.meta('sandboxVerifiedVersion') === CODEX_VERSION,
    projects: store.projects(),
    devices: store.db
      .prepare('SELECT deviceId,displayName,createdAt FROM devices WHERE revokedAt IS NULL')
      .all()
      .map((device) => ({
        ...(device as Record<string, unknown>),
        connected: server.connectedDeviceIds().includes((device as { deviceId: string }).deviceId),
      })),
    approvals: store.approvals().map((approval) => ({
      ...approval,
      sessionTitle: store.sessions().find((session) => session.sessionId === approval.sessionId)
        ?.title,
    })),
    addresses: ['127.0.0.1', ...localAddresses()],
  });
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(retention);
  clearInterval(desktopRefresh);
  pairing.close();
  approvals.invalidate();
  approvals.close();
  const exited = supervisor.rpc.alive ? once(supervisor.rpc, 'exit') : null;
  supervisor.stop();
  await server.close();
  if (exited) await exited;
  desktop.close();
  store.close();
  process.exitCode = 0;
}
pairing.on('confirmation', (p) => desktop.send('pair.confirm', p));
pairing.on('devicesChanged', state);
desktop.on('action', (action: Record<string, unknown>) => {
  void (async () => {
    if (localBusy) {
      desktop.send('error', { message: '另一个本机操作正在处理中，请稍后重试。' });
      return;
    }
    localBusy = true;
    try {
      switch (action.action) {
        case 'project.add':
          await projects.addLocal(String(action.path));
          break;
        case 'project.remove':
          projects.removeLocal(String(action.projectId));
          break;
        case 'pair.create': {
          const selected = String(action.address);
          invariant(
            selected === '127.0.0.1' || localAddresses().includes(selected),
            'CONFIG_ERROR',
            'Choose an address assigned to this PC',
          );
          invariant(
            new X509Certificate(tls.cert).checkIP(selected),
            'CERTIFICATE_ADDRESS_MISMATCH',
            'Network address changed; regenerate certificate locally and pair again',
          );
          if (selected !== address) {
            await server.close();
            server = makeServer();
            await server.listen(selected, port);
            address = selected;
          }
          // Only this Windows-local action grants future LAN rebinding. Never accept it over WSS.
          store.setMeta('listenAddress', selected);
          const qr = pairing.createLocal(`https://${address}:${port}`, tls.fingerprint);
          desktop.send('pair.qr', {
            ...qr,
            image: (
              await QRCode.toBuffer(JSON.stringify(qr), {
                width: 512,
                margin: 2,
                errorCorrectionLevel: 'M',
              })
            ).toString('base64'),
          });
          break;
        }
        case 'pair.confirm':
          await pairing.confirmLocal(String(action.requestId), action.approve === true);
          break;
        case 'device.revoke':
          pairing.revokeLocal(String(action.deviceId));
          break;
        case 'approval.decide':
          await approvals.decide(
            String(action.sessionId),
            String(action.turnId),
            String(action.approvalId),
            action.decision as 'approve' | 'reject' | 'cancel',
          );
          break;
        case 'stop':
          await shutdown();
          return;
      }
      state();
      desktop.send('action.result', { action: action.action, success: true });
    } catch (error) {
      desktop.send('error', { message: redact(safeError(error)) });
      log('local.actionFailed', { message: safeError(error) });
    } finally {
      localBusy = false;
    }
  })().catch((error) => log('local.failed', { message: safeError(error) }));
});
desktop.on('closed', () => void shutdown());
const desktopRefresh = setInterval(state, 2000);
desktopRefresh.unref();
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
store.on('event', (event) => {
  if (
    [
      'host.status',
      'projects.updated',
      'session.updated',
      'approval.requested',
      'approval.resolved',
    ].includes(event.action)
  )
    state();
});
state();
store.setMeta('sandboxVerifiedVersion', '');
try {
  const boundary = await verifySandbox();
  await writeFile(join(directory, 'sandbox-verification.json'), JSON.stringify(boundary, null, 2));
  invariant(
    boundary.passed,
    'SANDBOX_UNVERIFIED',
    'Windows sandbox boundary verification failed; see sandbox-verification.json',
  );
  store.setMeta('sandboxVerifiedVersion', CODEX_VERSION);
  await supervisor.start();
  state();
  if (process.env.AGENTDECK_STARTUP_CHECK === '1') {
    await writeFile(
      join(directory, 'startup-check.json'),
      JSON.stringify({
        at: new Date().toISOString(),
        result: 'PASS',
        address,
        codexReady: supervisor.ready,
        dpapiCertificate: true,
        sandboxVerified: boundary.passed,
      }),
    );
    await shutdown();
  }
} catch (error) {
  if (process.env.AGENTDECK_STARTUP_CHECK === '1') {
    log('startup.failed', { message: safeError(error) });
    await shutdown();
    process.exitCode = 1;
  } else {
    desktop.send('error', { message: redact(safeError(error)) });
    log('startup.failed', { message: safeError(error) });
    state();
  }
}

// Explicit Windows GUI probe. Fresh homes only; never reconfigures the running app.
// Usage: node scripts/check-desktop-gui-runtime.mjs <ChatGPT.exe> <codex.exe> <proxy.exe> <report.json>
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';

const [desktop, native, proxy, destination] = process.argv.slice(2);
if (
  process.platform !== 'win32' ||
  ![desktop, native, proxy, destination].every((p) => p && isAbsolute(p))
)
  throw new Error('Expected Windows and four absolute paths');
// Verify the installed isolation hook before starting any GUI process.
const archive = readFileSync(join(dirname(desktop), 'resources', 'app.asar'));
const tree = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
const entries = tree.files?.['.vite']?.files?.build?.files;
const names = Object.keys(entries ?? {}).filter(
  (n) => n.startsWith('bootstrap-') && n.endsWith('.js'),
);
if (names.length !== 1) throw new Error('Unknown desktop bootstrap');
const entry = entries[names[0]];
if (
  entry.unpacked ||
  !/^\d+$/.test(entry.offset) ||
  !Number.isSafeInteger(entry.size) ||
  entry.size > 32 * 1024 * 1024
)
  throw new Error('Unsupported bootstrap entry');
const offset = 8 + archive.readUInt32LE(4) + Number(entry.offset);
const bytes = archive.subarray(offset, offset + entry.size);
const source = bytes.toString();
if (
  !source.includes(
    'function kD({appDataPath:e,buildFlavor:t,env:n}){let r=n.CODEX_ELECTRON_USER_DATA_PATH?.trim();if(r)return(0,g.resolve)(r);',
  ) ||
  !source.includes(
    'y.app.setPath(`userData`,kD({appDataPath:y.app.getPath(`appData`),buildFlavor:pA,env:process.env}))',
  ) ||
  source.indexOf('y.app.setPath(`userData`,kD(') > source.indexOf('var hA=DD(')
)
  throw new Error('Unverified user-data isolation; GUI not launched');

const root = mkdtempSync(join(tmpdir(), 'agentdeck-gui-runtime-'));
const home = join(root, 'codex-home');
const userData = join(root, 'electron-data');
const profile = join(root, 'profile');
for (const folder of [
  home,
  userData,
  profile,
  join(profile, 'AppData'),
  join(profile, 'AppData', 'Roaming'),
  join(profile, 'AppData', 'Local'),
])
  mkdirSync(folder);
const token = randomBytes(32).toString('base64url');
const tokenFile = join(root, 'capability-token');
const proxyPath = join(root, 'agentdeck-codex-proxy.exe');
const manifest = join(root, 'agentdeck-codex-proxy.json');
writeFileSync(tokenFile, token);
copyFileSync(proxy, proxyPath);
writeFileSync(
  join(home, 'config.toml'),
  '[features]\ncode_mode_host=true\n[analytics]\nenabled=false\n',
);
// No real CODEX/API/proxy credentials or desktop profile variables are inherited.
const env = {};
for (const key of [
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramData',
])
  if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  PATH: join(env.SystemRoot, 'System32'),
  TEMP: root,
  TMP: root,
  USERPROFILE: profile,
  APPDATA: join(profile, 'AppData', 'Roaming'),
  LOCALAPPDATA: join(profile, 'AppData', 'Local'),
  CODEX_HOME: home,
  CODEX_ELECTRON_USER_DATA_PATH: userData,
  NO_PROXY: '127.0.0.1,localhost',
});
const report = {
  evidenceLevel: 'original-packaged-gui-isolated-transport-probe',
  bootstrap: { name: names[0], sha256: createHash('sha256').update(bytes).digest('hex') },
  originalProductionDesktopModified: false,
  accountCredentialsUsed: false,
  modelTurnExecuted: false,
  visualAcceptance: false,
  androidVerified: false,
  checks: {},
  passed: false,
};
const children = [];
const sockets = new Set();
let observer;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
function launch(file, args, environment = env) {
  const child = spawn(file, args, {
    env: environment,
    cwd: root,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.on('error', () => {
    report.checks.processSpawnFailed = true;
  });
  children.push(child);
  return child;
}
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
try {
  const version = execFileSync(native, ['--version'], {
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (version !== 'codex-cli 0.163.0-alpha.10.2') throw new Error('Native version mismatch');
  report.nativeVersion = '0.163.0-alpha.10.2';
  const endpoint = `ws://127.0.0.1:${await freePort()}`;
  const server = launch(native, [
    'app-server',
    '--listen',
    endpoint,
    '--ws-auth',
    'capability-token',
    '--ws-token-file',
    tokenFile,
  ]);
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    if (server.exitCode != null) throw new Error('Native server exited');
    const ws = new WebSocket(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      handshakeTimeout: 500,
    });
    sockets.add(ws);
    ready = await new Promise((resolve) => {
      ws.once('open', () => resolve(true));
      ws.once('error', () => resolve(false));
    });
    ws.terminate();
    if (!ready) await pause(100);
  }
  if (!ready) throw new Error('Native server unavailable');
  report.checks.nativeAuthenticatedListener = true;
  observer = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    maxPayload: 8 * 1024 * 1024,
    verifyClient: (info) =>
      info.req.headers.authorization === `Bearer ${token}` && !info.req.headers.origin,
  });
  await once(observer, 'listening');
  observer.on('connection', (downstream) => {
    report.checks.proxySocketConnected = true;
    sockets.add(downstream);
    const upstream = new WebSocket(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      maxPayload: 8 * 1024 * 1024,
      handshakeTimeout: 5000,
    });
    sockets.add(upstream);
    const pending = new Map();
    const queued = [];
    let queuedBytes = 0;
    downstream.on('message', (data, binary) => {
      if (binary || upstream.bufferedAmount > 8 * 1024 * 1024) {
        downstream.terminate();
        return;
      }
      try {
        const packet = JSON.parse(data.toString());
        if (packet.method === 'initialize') report.checks.desktopInitializeSent = true;
        if (
          packet.id != null &&
          ['initialize', 'config/read'].includes(packet.method) &&
          pending.size < 256
        )
          pending.set(String(packet.id), packet.method);
        if (packet.method === 'initialized') report.checks.desktopInitializedNotification = true;
      } catch {
        downstream.terminate();
        return;
      }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: false });
      else if (
        upstream.readyState === WebSocket.CONNECTING &&
        (queuedBytes += data.length) <= 8 * 1024 * 1024
      )
        queued.push(data);
      else downstream.terminate();
    });
    upstream.once('open', () => {
      for (const data of queued) upstream.send(data, { binary: false });
      queued.length = 0;
    });
    upstream.on('message', (data, binary) => {
      try {
        const packet = JSON.parse(data.toString());
        const method = pending.get(String(packet.id));
        if (method && packet.result != null) {
          if (method === 'initialize') {
            report.checks.desktopInitializeSucceeded = true;
            const userAgent = packet.result.userAgent;
            report.checks.initializeUserAgentVersionMatched =
              typeof userAgent === 'string' && userAgent.includes(`/${report.nativeVersion} (`);
            report.checks.initializeUserAgentLegacyPrefixMatched =
              typeof userAgent === 'string' &&
              userAgent.startsWith(`Codex Desktop/${report.nativeVersion} (`);
          }
          if (method === 'config/read') report.checks.sameSocketConfigurationRead = true;
          pending.delete(String(packet.id));
        }
      } catch {
        downstream.terminate();
        return;
      }
      if (
        !binary &&
        downstream.readyState === WebSocket.OPEN &&
        downstream.bufferedAmount <= 8 * 1024 * 1024
      )
        downstream.send(data, { binary: false });
      else downstream.terminate();
    });
    for (const ws of [downstream, upstream]) {
      ws.on('error', () => {
        downstream.terminate();
        upstream.terminate();
      });
      ws.on('close', () => {
        downstream.terminate();
        upstream.terminate();
      });
    }
  });
  writeFileSync(
    manifest,
    JSON.stringify({
      formatVersion: 1,
      nativeExecutable: native,
      endpoint: `ws://127.0.0.1:${observer.address().port}/`,
      tokenFile,
      protocolVersion: report.nativeVersion,
    }),
  );
  const proxyVersion = execFileSync(proxyPath, ['--version'], {
    env: { ...env, CODEX_CLI_PATH: proxyPath },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (proxyVersion !== version) throw new Error('Proxy environment preflight failed');
  report.checks.proxyVersionWithDesktopOverride = true;
  const gui = launch(desktop, [`--user-data-dir=${userData}`], {
    ...env,
    CODEX_CLI_PATH: proxyPath,
  });
  for (let i = 0; i < 600; i++) {
    if (
      report.checks.desktopInitializedNotification ||
      gui.exitCode != null ||
      report.checks.processSpawnFailed
    )
      break;
    await pause(100);
  }
  report.checks.guiStayedRunning = gui.exitCode == null && !report.checks.processSpawnFailed;
  report.passed = [
    'nativeAuthenticatedListener',
    'desktopInitializeSucceeded',
    'initializeUserAgentVersionMatched',
    'sameSocketConfigurationRead',
    'desktopInitializedNotification',
    'guiStayedRunning',
  ].every((key) => report.checks[key] === true);
} catch {
  report.failure = 'ISOLATED_GUI_PROBE_FAILED';
} finally {
  for (const ws of sockets) ws.terminate();
  if (observer) await new Promise((done) => observer.close(done));
  // Only PID trees created and retained by this probe; never image-name termination.
  for (const child of children.reverse())
    if (child.pid && child.exitCode == null) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
          timeout: 10000,
        });
      } catch {
        child.kill();
      }
    }
  for (
    let attempt = 0;
    attempt < 20 &&
    children.some((child) => child.pid && child.exitCode == null && child.signalCode == null);
    attempt++
  )
    await pause(50);
  report.checks.probeChildrenExited = children.every(
    (child) => !child.pid || child.exitCode != null || child.signalCode != null,
  );
  if (!report.checks.probeChildrenExited) report.passed = false;
  for (const file of [tokenFile, manifest]) {
    try {
      unlinkSync(file);
    } catch {
      /* own fresh files only */
    }
  }
  writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.passed) process.exitCode = 1;
}

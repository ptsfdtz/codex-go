// Explicit Windows GUI probe. Fresh homes only; never reconfigures the running app.
// Usage: node scripts/check-desktop-gui-runtime.mjs <ChatGPT.exe> <codex.exe> <proxy.exe> <report.json>
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import {
  copyFileSync,
  openSync,
  readSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { inspectGuiHistory } from './lib/gui-history.mjs';

const [desktop, native, proxy, destination] = process.argv.slice(2);
const sharedIndex = process.argv.slice(6).includes('--shared-index');
const sharedHistory = process.argv.slice(6).includes('--shared-history');
if (sharedHistory && !sharedIndex) throw new Error('Shared history requires shared-index probe');
const nativeProject = process.argv.slice(6).includes('--with-native-project');
if (nativeProject && !sharedIndex) throw new Error('Native project requires shared-index probe');
const desktopPluginStartup = process.argv.slice(6).includes('--with-desktop-plugin-startup');
const inspectionArgs = process.argv
  .slice(6)
  .filter((arg) => arg.startsWith('--inspection-seconds='));
const inspectionArg = inspectionArgs[0];
const inspectionSeconds = inspectionArg
  ? Number(inspectionArg.slice('--inspection-seconds='.length))
  : 0;
if (
  inspectionArg &&
  (inspectionArgs.length !== 1 ||
    !/^--inspection-seconds=\d+$/.test(inspectionArg) ||
    !Number.isInteger(inspectionSeconds) ||
    inspectionSeconds < 5 ||
    inspectionSeconds > 300)
)
  throw new Error('Inspection duration must be 5..300 seconds');
if (desktopPluginStartup && !sharedIndex)
  throw new Error('Desktop plugin startup requires shared-index probe');
if (
  process.argv
    .slice(6)
    .some(
      (arg) =>
        ![
          '--shared-index',
          '--shared-history',
          '--with-native-project',
          '--with-desktop-plugin-startup',
          inspectionArg,
        ].includes(arg),
    )
)
  throw new Error('Unknown probe option');
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
if (desktopPluginStartup) {
  const mainNames = Object.keys(entries).filter(
    (name) => name.startsWith('main-') && name.endsWith('.js'),
  );
  if (mainNames.length !== 1) throw new Error('Unknown desktop main bundle');
  const mainEntry = entries[mainNames[0]];
  const start = 8 + archive.readUInt32LE(4) + Number(mainEntry.offset);
  const main = archive.subarray(start, start + mainEntry.size).toString();
  if (
    !main.includes('plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=') ||
    !main.includes('plugins.code-review@openai-bundled.mcp_servers.code-review.enabled=')
  )
    throw new Error('Unknown desktop plugin startup configuration');
}
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
  mainAppBootstrapVerified: false,
  desktopPluginStartup: { requested: desktopPluginStartup, hostIntegrationVerified: false },
  historyVerificationRequested: sharedHistory,
  nativeProjectRequested: nativeProject,
  checks: {
    desktopReceivedExactSeedInput: false,
    desktopReceivedExactSeedAnswer: false,
    desktopRequestedSeedReadWithTurns: false,
    desktopRequestedSeedTurns: false,
    desktopRequestedSeedItems: false,
    sourceRetainsExactSeedInput: false,
    sourceRetainsExactSeedAnswer: false,
    sourceListedSeedProject: false,
    desktopRequestedProjects: false,
    desktopListedSeedProject: false,
  },
  passed: false,
};
const children = [];
const sockets = new Set();
let observer;
let model;
let direct;
let seededThread;
let seededProject;
let seededTurn;
let completedSeed = false;
let requestId = 0;
const directPending = new Map();
const renamedTitle = 'AgentDeck isolated GUI cross-client rename';
const seedInput = 'Isolated GUI sharing probe; do not call tools.';
const seedAnswer = 'Isolated GUI shared history fixture.';
async function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = `probe-${++requestId}`;
    const timer = setTimeout(() => {
      directPending.delete(id);
      reject(new Error('Probe RPC timeout'));
    }, 15000);
    directPending.set(id, { resolve, reject, timer });
    direct.send(JSON.stringify({ id, method, params }));
  });
}
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
  if (sharedIndex) {
    model = createHttpServer((req, res) => {
      req.resume();
      if (req.method !== 'POST' || req.url !== '/v1/responses') {
        res.writeHead(404).end();
        return;
      }
      report.modelTurnExecuted = true;
      const item = {
        id: 'isolated-gui-message',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: seedAnswer, annotations: [] }],
      };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const event of [
        {
          type: 'response.created',
          response: { id: 'isolated-gui-response', status: 'in_progress', output: [] },
        },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { ...item, status: 'in_progress', content: [] },
        },
        {
          type: 'response.output_text.delta',
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          delta: item.content[0].text,
        },
        { type: 'response.output_item.done', output_index: 0, item },
        {
          type: 'response.completed',
          response: {
            id: 'isolated-gui-response',
            status: 'completed',
            output: [item],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        },
      ])
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    });
    model.listen(0, '127.0.0.1');
    await once(model, 'listening');
    writeFileSync(
      join(home, 'config.toml'),
      `model="agentdeck-gui-probe"\nmodel_provider="gui_probe"\n[model_providers.gui_probe]\nname="isolated GUI synthetic model"\nbase_url="http://127.0.0.1:${model.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n[features]\ncode_mode_host=true\n[analytics]\nenabled=false\n`,
    );
    report.evidenceLevel = 'original-packaged-gui-shared-index-with-synthetic-model';
  }
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
    ...(desktopPluginStartup
      ? [
          '-c',
          'plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true',
          '-c',
          'plugins.code-review@openai-bundled.mcp_servers.code-review.enabled=true',
        ]
      : []),
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
  if (sharedIndex) {
    direct = new WebSocket(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      handshakeTimeout: 5000,
      maxPayload: 8 * 1024 * 1024,
    });
    sockets.add(direct);
    direct.on('error', () => {});
    await once(direct, 'open');
    direct.on('message', (data) => {
      const packet = JSON.parse(data.toString());
      const waiter = directPending.get(packet.id);
      if (waiter && !packet.method) {
        directPending.delete(packet.id);
        clearTimeout(waiter.timer);
        if (packet.error) waiter.reject(new Error('Probe RPC rejected'));
        else waiter.resolve(packet.result);
      } else if (
        packet.method === 'turn/completed' &&
        packet.params?.threadId === seededThread &&
        packet.params?.turn?.id === seededTurn
      )
        completedSeed = packet.params.turn.status === 'completed';
      else if (packet.id != null && packet.method)
        direct.send(
          JSON.stringify({
            id: packet.id,
            error: { code: -32601, message: 'Probe never approves requests' },
          }),
        );
    });
    await request('initialize', {
      clientInfo: { name: 'agentdeck_gui_seed', version: '0.3.0' },
      capabilities: { experimentalApi: true },
    });
    direct.send(JSON.stringify({ method: 'initialized', params: {} }));
    const project = join(root, 'project');
    mkdirSync(project);
    if (nativeProject) {
      const created = await request('project/create', {
        name: 'AgentDeck isolated native project',
        roots: [{ path: project }],
        metadata: {},
        idempotencyKey: 'agentdeck-isolated-gui-project',
      });
      seededProject = created.project?.id;
      if (typeof seededProject !== 'string' || !seededProject)
        throw new Error('Native project identity missing');
      const listed = await request('project/list', { limit: 100 });
      report.checks.sourceListedSeedProject =
        listed.data?.some((p) => p.id === seededProject) === true;
      if (!report.checks.sourceListedSeedProject) throw new Error('Native project not indexed');
    }
    const started = await request('thread/start', {
      cwd: project,
      ...(nativeProject ? { projectId: seededProject } : {}),
      ephemeral: false,
      sandbox: 'read-only',
      approvalPolicy: 'on-request',
    });
    seededThread = started.thread.id;
    const turn = await request('turn/start', {
      threadId: seededThread,
      input: [{ type: 'text', text: seedInput, text_elements: [] }],
    });
    seededTurn = turn.turn.id;
    for (let i = 0; i < 150 && !completedSeed; i++) await pause(100);
    if (!completedSeed) throw new Error('Synthetic seed turn did not complete');
    const listed = await request('thread/list', { limit: 100 });
    report.checks.seedVisibleToDirectClient =
      listed.data?.some((thread) => thread.id === seededThread) === true;
    if (!report.checks.seedVisibleToDirectClient)
      throw new Error('Seed not persisted in source index');
    const history = await request('thread/items/list', {
      threadId: seededThread,
      limit: 100,
      sortDirection: 'asc',
    });
    const sourceContent = inspectGuiHistory(
      { method: 'thread/items/list', threadId: seededThread },
      history,
      { threadId: seededThread, turnId: seededTurn, input: seedInput, answer: seedAnswer },
    );
    report.checks.sourceRetainsExactSeedInput = sourceContent.user;
    report.checks.sourceRetainsExactSeedAnswer = sourceContent.assistant;
    if (!sourceContent.user || !sourceContent.assistant)
      throw new Error('Seed content not persisted in source history');
  }
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
        if (packet.method === 'project/list') report.checks.desktopRequestedProjects = true;
        if (seededThread && packet.params?.threadId === seededThread) {
          if (packet.method === 'thread/read' && packet.params.includeTurns === true)
            report.checks.desktopRequestedSeedReadWithTurns = true;
          if (packet.method === 'thread/turns/list') report.checks.desktopRequestedSeedTurns = true;
          if (packet.method === 'thread/items/list') report.checks.desktopRequestedSeedItems = true;
        }
        if (
          packet.id != null &&
          [
            'initialize',
            'config/read',
            'thread/list',
            'thread/read',
            'thread/resume',
            'thread/turns/list',
            'thread/items/list',
            'project/list',
          ].includes(packet.method) &&
          pending.size < 256
        )
          pending.set(String(packet.id), {
            method: packet.method,
            threadId: packet.params?.threadId,
          });
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
        const observedRequest = pending.get(String(packet.id));
        const method = observedRequest?.method;
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
          if (
            method === 'project/list' &&
            seededProject &&
            packet.result.data?.some((p) => p.id === seededProject)
          )
            report.checks.desktopListedSeedProject = true;
          if (
            method === 'thread/list' &&
            packet.result.data?.some((thread) => thread.id === seededThread)
          )
            report.checks.desktopListedSeededThread = true;
          if (
            ['thread/read', 'thread/resume'].includes(method) &&
            packet.result.thread?.id === seededThread
          )
            report.checks.desktopOpenedSeededThread = true;
          const history = inspectGuiHistory(observedRequest, packet.result, {
            threadId: seededThread,
            turnId: seededTurn,
            input: seedInput,
            answer: seedAnswer,
          });
          if (history.user) report.checks.desktopReceivedExactSeedInput = true;
          if (history.assistant) report.checks.desktopReceivedExactSeedAnswer = true;
          pending.delete(String(packet.id));
        }
        if (
          sharedIndex &&
          packet.method === 'thread/name/updated' &&
          packet.params?.threadId === seededThread &&
          packet.params?.threadName === renamedTitle
        )
          report.checks.desktopReceivedExternalRename = true;
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
  const gui = launch(
    desktop,
    [`--user-data-dir=${userData}`, ...(sharedIndex ? [`codex://threads/${seededThread}`] : [])],
    {
      ...env,
      CODEX_CLI_PATH: proxyPath,
    },
  );
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
  if (sharedIndex && report.checks.desktopInitializedNotification) {
    for (let i = 0; i < 300 && !report.checks.desktopOpenedSeededThread; i++) await pause(100);
    await request('thread/name/set', { threadId: seededThread, name: renamedTitle });
    for (
      let i = 0;
      i < 200 &&
      !(report.checks.desktopListedSeededThread && report.checks.desktopReceivedExternalRename);
      i++
    )
      await pause(100);
  }
  report.passed = [
    'nativeAuthenticatedListener',
    'desktopInitializeSucceeded',
    'initializeUserAgentVersionMatched',
    'sameSocketConfigurationRead',
    'desktopInitializedNotification',
    'guiStayedRunning',
  ].every((key) => report.checks[key] === true);
  if (sharedIndex)
    report.passed &&=
      report.checks.seedVisibleToDirectClient === true &&
      report.checks.sourceRetainsExactSeedInput === true &&
      report.checks.sourceRetainsExactSeedAnswer === true &&
      report.checks.desktopListedSeededThread === true &&
      report.checks.desktopReceivedExternalRename === true;
  if (inspectionSeconds) {
    process.stdout.write('Isolated GUI inspection hold started.\n');
    await pause(inspectionSeconds * 1000);
  }
  if (sharedHistory) {
    for (
      let i = 0;
      i < 300 &&
      !(
        report.checks.desktopReceivedExactSeedInput && report.checks.desktopReceivedExactSeedAnswer
      );
      i++
    )
      await pause(100);
    report.passed &&=
      report.checks.desktopReceivedExactSeedInput === true &&
      report.checks.desktopReceivedExactSeedAnswer === true;
  }
  if (nativeProject)
    report.passed &&=
      report.checks.sourceListedSeedProject === true &&
      report.checks.desktopListedSeedProject === true;
} catch {
  report.failure = 'ISOLATED_GUI_PROBE_FAILED';
} finally {
  for (const waiter of directPending.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error('Probe closed'));
  }
  directPending.clear();
  for (const ws of sockets) ws.terminate();
  if (observer) await new Promise((done) => observer.close(done));
  if (model) {
    model.closeAllConnections();
    await new Promise((done) => model.close(done));
  }
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
  // Only this fresh GUI's logs. Persist fixed diagnostics, never raw lines/paths.
  const logRoots = [join(profile, 'AppData', 'Local', 'Codex', 'Logs')];
  const knownCodes = [
    'PROXY_ARGUMENT_UNSUPPORTED',
    'PROXY_CONFIG_KEY_UNSUPPORTED',
    'PROXY_CONFIG_MISMATCH',
    'PROXY_VERSION_UNVERIFIED',
    'PROXY_PROTOCOL_ERROR',
    'PROXY_IO_TIMEOUT',
  ];
  const failureCodes = new Set();
  const startupCodes = ['MCP', 'PLUGINS', 'FEATURES', 'OTHER'].flatMap((domain) =>
    ['MISSING', 'TYPE', 'VALUE'].map((kind) => `PROXY_STARTUP_${domain}_${kind}`),
  );
  const startupDiagnostics = new Set();
  let inspectedEntries = 0;
  let inspectedBytes = 0;
  while (logRoots.length && inspectedEntries < 100 && inspectedBytes < 8 * 1024 * 1024) {
    const directory = logRoots.pop();
    let files;
    try {
      files = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (++inspectedEntries > 100) break;
      const path = join(directory, file.name);
      if (file.isDirectory()) logRoots.push(path);
      else if (file.isFile() && file.name.endsWith('.log')) {
        const fd = openSync(path, 'r');
        const raw = Buffer.alloc(
          Math.min(2 * 1024 * 1024 + 1, 8 * 1024 * 1024 - inspectedBytes + 1),
        );
        let count = 0;
        try {
          while (count < raw.length) {
            const bytes = readSync(fd, raw, count, raw.length - count, null);
            if (!bytes) break;
            count += bytes;
          }
        } finally {
          closeSync(fd);
        }
        inspectedBytes += count;
        if (count > 2 * 1024 * 1024 || inspectedBytes > 8 * 1024 * 1024) continue;
        const text = raw.subarray(0, count).toString();
        for (const code of knownCodes) if (text.includes(code)) failureCodes.add(code);
        for (const code of startupCodes) if (text.includes(code)) startupDiagnostics.add(code);
        if (text.includes('Desktop bootstrap failed to start the main app'))
          report.checks.desktopBootstrapFailed = true;
      }
    }
  }
  report.observedProxyFailureCodes = [...failureCodes].sort();
  report.observedProxyStartupDiagnostics = [...startupDiagnostics].sort();
  if (sharedIndex && report.checks.desktopBootstrapFailed) report.passed = false;
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

// Isolated native two-client probe. Never reads user history or account credentials.
// Add --synthetic-turn to test active turns against a loopback synthetic model provider.
// Add --complete-history with --synthetic-turn to verify completed assistant history and pagination.
// Usage: node scripts/check-shared-codex-runtime.mjs <absolute-codex.exe> <report-dir> [--synthetic-turn] [--complete-history]
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';

const [executable, destination] = process.argv.slice(2);
const syntheticTurn = process.argv.includes('--synthetic-turn');
const primeTurn = process.argv.includes('--prime-turn');
const completeHistory = process.argv.includes('--complete-history');
if (primeTurn && !syntheticTurn) throw new Error('--prime-turn requires --synthetic-turn');
if (completeHistory && !syntheticTurn)
  throw new Error('--complete-history requires --synthetic-turn');
if (!executable || !isAbsolute(executable) || !destination) {
  throw new Error('Expected absolute CLI executable and report directory');
}
const cliVersion = execFileSync(executable, ['--version'], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 15000,
}).trim();
const directory = mkdtempSync(join(tmpdir(), 'agentdeck-shared-runtime-'));
const home = join(directory, 'codex-home');
const project = join(directory, 'project');
mkdirSync(home);
mkdirSync(project);
let modelRequests = 0;
let completeNextResponse = false;
const historyAnswer = 'Persisted synthetic answer: 中文 😀\n```text\noriginal content\n```';
const modelRoutes = [];
const model = syntheticTurn
  ? createHttpServer((request, response) => {
      modelRoutes.push({
        method: request.method,
        path: new URL(request.url, 'http://localhost').pathname,
      });
      if (request.method !== 'POST' || request.url !== '/v1/responses') {
        response.writeHead(404).end();
        return;
      }
      request.resume();
      modelRequests++;
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      response.write(
        `event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: 'probe-response', status: 'in_progress', output: [] } })}\n\n`,
      );
      if (completeNextResponse) {
        const item = {
          id: `probe-message-${modelRequests}`,
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: historyAnswer, annotations: [] }],
        };
        for (const event of [
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { ...item, content: [], status: 'in_progress' },
          },
          {
            type: 'response.output_text.delta',
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            delta: historyAnswer,
          },
          { type: 'response.output_item.done', output_index: 0, item },
          {
            type: 'response.completed',
            response: {
              id: 'probe-response',
              status: 'completed',
              output: [item],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          },
        ])
          response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        response.end();
      }
      // Deliberately keep the response open until Codex interrupts the active turn.
    })
  : null;
if (model) {
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  writeFileSync(
    join(home, 'config.toml'),
    [
      'model = "agentdeck-shared-probe"',
      'model_provider = "agentdeck_probe"',
      '[model_providers.agentdeck_probe]',
      'name = "AgentDeck synthetic shared-runtime probe"',
      `base_url = "http://127.0.0.1:${model.address().port}/v1"`,
      'wire_api = "responses"',
      'requires_openai_auth = false',
      'supports_websockets = false',
    ].join('\n'),
  );
}
const token = randomBytes(32).toString('base64url');
const tokenFile = join(directory, 'ws-token');
writeFileSync(tokenFile, token, { mode: 0o600 });
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((done) => reservation.close(done));
const endpoint = `ws://127.0.0.1:${port}`;
const probeEnvironment = {
  ...process.env,
  CODEX_HOME: home,
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
};
// The synthetic provider must stay on loopback and must not inherit account keys.
for (const key of Object.keys(probeEnvironment)) {
  if (/^(?:https?|all)_proxy$/i.test(key) || /^(?:OPENAI|CODEX|ANTHROPIC)_API_KEY$/.test(key))
    delete probeEnvironment[key];
}
const child = spawn(
  executable,
  [
    'app-server',
    '--listen',
    endpoint,
    '--ws-auth',
    'capability-token',
    '--ws-token-file',
    tokenFile,
  ],
  {
    windowsHide: true,
    env: probeEnvironment,
    stdio: ['ignore', 'ignore', 'pipe'],
  },
);
let stderrBytes = 0;
child.stderr.on('data', (bytes) => {
  stderrBytes += bytes.length;
});
let spawnError;
child.on('error', (error) => {
  spawnError = error.code;
});
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const clients = [];
async function connect(authentication = 'valid') {
  const socket = new WebSocket(endpoint, {
    headers:
      authentication === 'missing'
        ? {}
        : { Authorization: `Bearer ${authentication === 'valid' ? token : 'invalid-probe-token'}` },
    handshakeTimeout: 2000,
  });
  await new Promise((done, reject) => {
    socket.once('open', done);
    socket.once('error', reject);
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      socket.terminate();
      reject(Object.assign(new Error('Handshake rejected'), { httpStatus: response.statusCode }));
    });
  });
  const pending = new Map();
  const events = [];
  let next = 0;
  socket.on('message', (bytes) => {
    const value = JSON.parse(bytes.toString());
    if (value.id != null && !value.method) {
      const request = pending.get(String(value.id));
      if (request) {
        pending.delete(String(value.id));
        clearTimeout(request.timeout);
        if (value.error)
          request.reject(
            Object.assign(new Error('RPC failed'), {
              rpcCode: value.error.code,
              rpcMessage: value.error.message,
            }),
          );
        else request.done(value.result);
      }
    } else if (value.method && value.id == null) {
      events.push(value);
      if (events.length > 1000) events.shift();
    } else if (value.id != null) {
      // Never approve operations in a transport probe.
      socket.send(
        JSON.stringify({
          id: value.id,
          error: { code: -32601, message: 'Transport probe does not handle requests' },
        }),
      );
    }
  });
  const client = {
    socket,
    events,
    request(method, params) {
      return new Promise((done, reject) => {
        const id = String(++next);
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }, 15000);
        pending.set(id, { done, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async initialize(name) {
      await this.request('initialize', {
        clientInfo: { name, version: '0.3.0' },
        capabilities: { experimentalApi: true },
      });
      socket.send(JSON.stringify({ method: 'initialized', params: {} }));
    },
    close() {
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error('Probe closed'));
      }
      pending.clear();
      socket.terminate();
    },
  };
  clients.push(client);
  return client;
}
const report = {
  generatedAt: new Date().toISOString(),
  cliVersion,
  evidenceLevel: syntheticTurn
    ? 'real-native-runtime-with-synthetic-model'
    : 'real-isolated-runtime-no-model-turn',
  desktopClientVerified: false,
  checks: {},
};
try {
  let a;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnError || child.exitCode != null) throw new Error('Isolated server failed to start');
    try {
      a = await connect();
      break;
    } catch {
      await pause(250);
    }
  }
  if (!a) throw new Error('Isolated server did not accept authenticated connection');
  for (const authentication of ['missing', 'wrong']) {
    let status;
    try {
      const unauthorized = await connect(authentication);
      unauthorized.close();
    } catch (error) {
      status = error.httpStatus;
    }
    const rejected = status === 401 || status === 403;
    report.checks[`${authentication}CredentialRejected`] = rejected;
    if (!rejected) throw new Error('Expected explicit authentication rejection');
  }
  const b = await connect();
  await a.initialize('agentdeck_parity_a');
  await b.initialize('agentdeck_parity_b');
  const created = await a.request('thread/start', {
    cwd: project,
    ephemeral: false,
    sandbox: 'read-only',
    approvalPolicy: 'on-request',
  });
  const id = created.thread.id;
  report.modelConfiguration = { model: created.model, modelProvider: created.modelProvider };
  const read = await b.request('thread/read', { threadId: id, includeTurns: false });
  report.checks.secondClientReadsSameThread = read.thread.id === id;
  await a.request('thread/name/set', { threadId: id, name: 'AgentDeck isolated shared probe' });
  const renamed = await b.request('thread/read', { threadId: id, includeTurns: false });
  report.checks.renameVisibleToSecondClient =
    renamed.thread.name === 'AgentDeck isolated shared probe';
  let activeProbe;
  const startProbeTurn = async () => {
    const started = await a.request('turn/start', {
      threadId: id,
      input: [
        { type: 'text', text: 'Synthetic transport probe. Do not call tools.', text_elements: [] },
      ],
    });
    for (let attempt = 0; attempt < 100 && modelRequests === 0; attempt++) await pause(100);
    if (!modelRequests) throw new Error('Native turn did not reach synthetic provider');
    return started.turn.id;
  };
  if (primeTurn) activeProbe = await startProbeTurn();
  const resumed = await b.request('thread/resume', { threadId: id, excludeTurns: true });
  report.checks.secondClientResumesSameThread = resumed.thread.id === id;
  await b.request('thread/name/set', { threadId: id, name: 'AgentDeck second client update' });
  const updated = await a.request('thread/read', { threadId: id, includeTurns: false });
  report.checks.secondClientMutationVisibleToFirst =
    updated.thread.id === id && updated.thread.name === 'AgentDeck second client update';
  let persistedEntries;
  if (syntheticTurn) {
    const turnId = activeProbe ?? (await startProbeTurn());
    const active = await b.request('thread/turns/list', {
      threadId: id,
      limit: 1,
      itemsView: 'notLoaded',
      sortDirection: 'desc',
    });
    report.checks.activeTurnDiscoverableWithoutHistory =
      active.data.length === 1 &&
      active.data[0].id === turnId &&
      active.data[0].status === 'inProgress';
    const steered = await b.request('turn/steer', {
      threadId: id,
      expectedTurnId: turnId,
      input: [{ type: 'text', text: 'Keep waiting for interruption.', text_elements: [] }],
    });
    report.checks.secondClientSteersSameActiveTurn = steered.turnId === turnId;
    await b.request('turn/interrupt', { threadId: id, turnId });
    const observed = (client) =>
      client.events.some(
        (event) =>
          event.method === 'turn/completed' &&
          event.params.threadId === id &&
          event.params.turn.id === turnId &&
          event.params.turn.status === 'interrupted',
      );
    for (let attempt = 0; attempt < 100 && !(observed(a) && observed(b)); attempt++)
      await pause(100);
    report.checks.bothObserveAuthoritativeInterruption = observed(a) && observed(b);
    let completedTurnId;
    if (completeHistory) {
      completeNextResponse = true;
      const started = await a.request('turn/start', {
        threadId: id,
        input: [{ type: 'text', text: 'Complete the persisted history probe.', text_elements: [] }],
      });
      completedTurnId = started.turn.id;
      const completed = (client) =>
        client.events.some(
          (event) =>
            event.method === 'turn/completed' &&
            event.params.threadId === id &&
            event.params.turn.id === completedTurnId &&
            event.params.turn.status === 'completed',
        );
      for (let attempt = 0; attempt < 150 && !(completed(a) && completed(b)); attempt++)
        await pause(100);
      report.checks.bothObserveAuthoritativeCompletion = completed(a) && completed(b);
    }
    const saved = [];
    let cursor;
    const cursors = new Set();
    do {
      const page = await b.request('thread/items/list', {
        threadId: id,
        cursor,
        limit: 1,
        sortDirection: 'asc',
      });
      if (!Array.isArray(page.data) || page.data.length > 1)
        throw new Error('Invalid native history page');
      saved.push(...page.data);
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('Repeated native history cursor');
      if (cursor) cursors.add(cursor);
      if (saved.length > 100) throw new Error('Native history probe exceeded page budget');
    } while (cursor);
    report.checks.persistedHistoryRetainsOriginalTurn =
      saved.length > 0 &&
      saved.every((entry) => entry.turnId === turnId || entry.turnId === completedTurnId);
    report.checks.persistedHistoryRetainsOriginalInput = saved.some(
      (entry) =>
        entry.item.type === 'userMessage' &&
        entry.item.content.some(
          (part) => part.type === 'text' && part.text.includes('Synthetic transport probe.'),
        ),
    );
    const reread = await a.request('thread/items/list', {
      threadId: id,
      limit: 100,
      sortDirection: 'asc',
    });
    report.checks.persistedPagesMatchOtherClient =
      JSON.stringify(saved) === JSON.stringify(reread.data) && !reread.nextCursor;
    report.persistedHistory = {
      entries: saved.length,
      pages: cursors.size + 1,
      itemTypes: [...new Set(saved.map((entry) => entry.item.type))].sort(),
    };
    if (completeHistory) {
      report.checks.persistedAssistantContentIsExact = saved.some(
        (entry) =>
          entry.turnId === completedTurnId &&
          entry.item.type === 'agentMessage' &&
          entry.item.text === historyAnswer,
      );
      report.checks.historyTraversesMultiplePages = cursors.size >= 2;
      report.checks.historyItemIdentitiesAreUnique =
        new Set(saved.map((entry) => `${entry.turnId}:${entry.item.id}`)).size === saved.length;
    }
    persistedEntries = saved;
  }
  a.close();
  const c = await connect();
  await c.initialize('agentdeck_parity_reconnect');
  const restored = await c.request('thread/resume', { threadId: id, excludeTurns: true });
  report.checks.reconnectPreservesThreadIdentity = restored.thread.id === id;
  if (persistedEntries) {
    const history = await c.request('thread/items/list', {
      threadId: id,
      limit: 100,
      sortDirection: 'asc',
    });
    report.checks.reconnectPreservesHistory =
      JSON.stringify(persistedEntries) === JSON.stringify(history.data) && !history.nextCursor;
  }
  await pause(250);
  report.checks.bothObserveNameNotifications = [a, b].every((client) =>
    client.events.some(
      (event) => event.method === 'thread/name/updated' && event.params.threadId === id,
    ),
  );
  report.notifications = {
    first: [...new Set(a.events.map((v) => v.method))].sort(),
    second: [...new Set(b.events.map((v) => v.method))].sort(),
  };
  report.passed = Object.values(report.checks).every(Boolean);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.passed = false;
  report.failure = {
    message: error.message,
    rpcCode: error.rpcCode ?? null,
    rpcMessage:
      error.rpcMessage
        ?.replaceAll(directory, '<probe-dir>')
        .replaceAll(token, '<redacted>')
        .slice(0, 1000) ?? null,
  };
  report.nativeErrors = clients.flatMap((client) =>
    client.events
      .filter((event) => event.method === 'error' || event.method === 'turn/completed')
      .map((event) => ({
        method: event.method,
        message:
          event.params?.message ??
          event.params?.error?.message ??
          event.params?.turn?.error?.message ??
          null,
      }))
      .filter((event) => event.message != null)
      .map((event) => ({
        ...event,
        message: String(event.message)
          .replaceAll(directory, '<probe-dir>')
          .replaceAll(token, '<redacted>')
          .slice(0, 1000),
      })),
  );
  process.exitCode = 1;
} finally {
  for (const client of clients) client.close();
  const exit = child.exitCode == null ? once(child, 'exit') : null;
  child.kill();
  if (exit) await Promise.race([exit, pause(5000)]);
  report.serverExitCode = child.exitCode;
  report.serverExitSignal = child.signalCode;
  if (model) {
    model.closeAllConnections();
    await new Promise((done) => model.close(done));
  }
  report.syntheticModelRequests = modelRequests;
  report.primedTurnBeforeResume = primeTurn;
  report.syntheticModelRoutes = modelRoutes;
  if (child.exitCode != null || child.signalCode != null) unlinkSync(tokenFile);
  report.stderrBytes = stderrBytes;
  const output = resolve(destination);
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'shared-runtime-check.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}

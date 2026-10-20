import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';
import { Store } from '../src/store.js';
import { ProjectRegistry } from '../src/projects.js';
import { Supervisor, findCodex } from '../src/codex.js';
import { Tasks } from '../src/tasks.js';
import { Approvals } from '../src/approvals.js';
import { Pairing } from '../src/pairing.js';
import { certificate, Dpapi, token, restrictDirectory } from '../src/security.js';
import { GitService } from '../src/git.js';
import { BridgeServer } from '../src/server.js';
import { verifySandbox } from '../../scripts/verify-sandbox.js';
import type { DeckEvent } from '@agentdeck/protocol';
const root = await mkdtemp(join(tmpdir(), 'agentdeck-wss-real-'));
await restrictDirectory(root);
const store = new Store(join(root, 'state.db')),
  registry = new ProjectRegistry(store),
  upstream = new Supervisor(findCodex()),
  tasks = new Tasks(store, registry, upstream),
  approvals = new Approvals(store, tasks),
  protector = new Dpapi(),
  pairing = new Pairing(store, protector);
const tls = await certificate(root, protector),
  local = { requestProjectAdd: () => {}, requestProjectRemove: () => {} };
let server = new BridgeServer(
    store,
    tasks,
    approvals,
    pairing,
    new GitService(registry),
    tls,
    local,
  ),
  socket: WebSocket | undefined;
const events: DeckEvent[] = [];
const report: Record<string, unknown> = {
  at: new Date().toISOString(),
  source:
    'Real TLS/WSS + DPAPI + SQLite + Codex; loopback Node test driver, NOT physical Android pairing',
  checks: [],
  result: 'RUNNING',
};
const checks = report.checks as unknown[];
async function call(action: string, payload: unknown = {}): Promise<Record<string, unknown>> {
  const id = crypto.randomUUID();
  return new Promise((done, reject) => {
    const timer = setTimeout(() => {
      socket?.off('message', listener);
      reject(new Error(`Timeout: ${action}`));
    }, 45000);
    const listener = (data: WebSocket.RawData) => {
      const packet = JSON.parse(data.toString()) as Record<string, unknown>;
      if (packet.id !== id) return;
      clearTimeout(timer);
      socket?.off('message', listener);
      if (packet.type === 'error') reject(new Error(String(packet.code)));
      else done(packet.payload as Record<string, unknown>);
    };
    socket!.on('message', listener);
    socket!.send(JSON.stringify({ v: 1, type: 'request', id, action, payload }));
  });
}
async function terminal(turnId: string) {
  const until = Date.now() + 120000;
  while (Date.now() < until) {
    const event = events.find(
      (e) =>
        e.turnId === turnId &&
        ['turn.completed', 'turn.interrupted', 'turn.failed'].includes(e.action),
    );
    if (event) return event.action;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('No terminal WSS event');
}
async function connect(port: number, credential: string) {
  socket = new WebSocket(`wss://127.0.0.1:${port}/api/v1/ws`, {
    ca: tls.cert,
    headers: { Authorization: `Bearer ${credential}` },
  });
  socket.on('message', (data) => {
    const packet = JSON.parse(data.toString()) as DeckEvent;
    if (packet.type === 'event') events.push(packet);
  });
  await once(socket, 'open');
  await call('system.hello', { client: 'AgentDeck real loopback smoke', version: 1 });
}
try {
  const boundary = await verifySandbox();
  if (!boundary.passed) throw new Error('Sandbox verification failed');
  store.setMeta('sandboxVerifiedVersion', '0.159.2');
  await upstream.start();
  const port = await server.listen('127.0.0.1', 0);
  // Test-only in-process local provisioning; this does not assert Windows human pairing acceptance.
  const qr = pairing.createLocal(`https://127.0.0.1:${port}`, tls.fingerprint),
    requested = pairing.request({
      token: qr.token,
      displayName: 'Loopback test driver',
      nonce: token(),
    });
  await pairing.confirmLocal(requested.requestId, true);
  const claimed = await pairing.claim(requested.requestId, requested.claimToken);
  const credential = String(claimed.credential);
  for (const name of ['one', 'two']) {
    const path = join(root, name);
    await mkdir(path);
    await registry.addLocal(path);
  }
  await connect(port, credential);
  const projects = (await call('projects.list')).projects as { projectId: string }[];
  const sessionIds: string[] = [];
  for (const p of projects) {
    const created = await call('sessions.create', {
      projectId: p.projectId,
      title: 'Real WSS smoke',
    });
    sessionIds.push((created.session as { sessionId: string }).sessionId);
  }
  const starts = await Promise.all(
    sessionIds.map((id, i) =>
      call('turn.start', {
        sessionId: id,
        text: `Reply exactly AGENTDECK_WSS_${i}_OK. Do not run commands or read files.`,
      }),
    ),
  );
  const statuses = await Promise.all(
    starts.map((r) => terminal((r.turn as { turnId: string }).turnId)),
  );
  if (!statuses.every((s) => s === 'turn.completed'))
    throw new Error('Unexpected completion status');
  checks.push({
    name: 'WSS two real sessions and streaming terminal events',
    result: 'PASS',
    statuses,
  });
  const next = await call('turn.start', {
    sessionId: sessionIds[0],
    text: 'Produce a numbered list of 2000 software test ideas. Do not use tools or read files.',
  });
  const turnId = (next.turn as { turnId: string }).turnId;
  await call('turn.interrupt', { sessionId: sessionIds[0], turnId });
  const status = await terminal(turnId);
  if (status !== 'turn.interrupted') throw new Error('No verified interruption');
  checks.push({ name: 'WSS real interrupt', result: 'PASS' });
  const cursor = events.at(-1)!.eventId;
  socket?.terminate();
  await server.close();
  server = new BridgeServer(store, tasks, approvals, pairing, new GitService(registry), tls, local);
  const nextPort = await server.listen('127.0.0.1', 0);
  await connect(nextPort, credential);
  const snapshot = await call('snapshot.get');
  if ((snapshot.sessions as unknown[]).length !== 2) throw new Error('Snapshot sessions lost');
  await call('events.replay', { cursor, limit: 100 });
  checks.push({ name: 'TLS reconnect, persisted credential and snapshot', result: 'PASS' });
  report.eventCount = events.length;
  report.result = 'PASS';
} catch (e) {
  report.result = 'FAIL';
  report.error = e instanceof Error ? e.message : String(e);
  process.exitCode = 1;
} finally {
  socket?.terminate();
  await server.close();
  approvals.invalidate();
  approvals.close();
  pairing.close();
  upstream.stop();
  if (upstream.rpc.alive) await once(upstream.rpc, 'exit');
  store.close();
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/real-wss-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

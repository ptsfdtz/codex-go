import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { X509Certificate } from 'node:crypto';
import WebSocket from 'ws';
import { Store } from '../src/store.js';
import { ProjectRegistry } from '../src/projects.js';
import { Supervisor } from '../src/codex.js';
import { Tasks } from '../src/tasks.js';
import { Approvals } from '../src/approvals.js';
import { Pairing } from '../src/pairing.js';
import { certificate, token, localAddresses, restoreListenAddress } from '../src/security.js';
import { BridgeServer } from '../src/server.js';
import { GitService, gitCommand } from '../src/git.js';

let store: Store,
  registry: ProjectRegistry,
  upstream: Supervisor,
  tasks: Tasks,
  approvals: Approvals,
  pairing: Pairing,
  server: BridgeServer,
  root: string,
  port: number,
  tls: { cert: string; key: string; fingerprint: string };
const sockets: WebSocket[] = [];
const protector = { protect: async (b: Buffer) => b, unprotect: async (b: Buffer) => b };
async function waitFor<T>(getter: () => T | undefined | false): Promise<T> {
  const until = Date.now() + 7000;
  for (;;) {
    const value = getter();
    if (value) return value;
    if (Date.now() > until) throw new Error('Timed out waiting for fixture state');
    await new Promise((r) => setTimeout(r, 15));
  }
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agentdeck-integration-'));
  store = new Store(join(root, 'state.db'));
  store.setMeta('sandboxVerifiedVersion', '0.159.2');
  registry = new ProjectRegistry(store);
  upstream = new Supervisor(process.execPath, [resolve('bridge/test/appserver-fixture.mjs')]);
  tasks = new Tasks(store, registry, upstream);
  approvals = new Approvals(store, tasks);
  pairing = new Pairing(store, protector);
  tls = await certificate(root, protector);
  server = new BridgeServer(store, tasks, approvals, pairing, new GitService(registry), tls, {
    requestProjectAdd: () => {},
    requestProjectRemove: () => {},
  });
  port = await server.listen('127.0.0.1', 0);
  await upstream.start();
});
afterEach(async () => {
  for (const s of sockets) s.terminate();
  sockets.length = 0;
  await server.close();
  approvals.close();
  upstream.stop();
  await once(upstream.rpc, 'exit');
  store.close();
});
async function project(name = 'project') {
  const path = join(root, name);
  await mkdir(path);
  return registry.addLocal(path);
}
async function credential() {
  const qr = pairing.createLocal(`https://127.0.0.1:${port}`, tls.fingerprint);
  const p = pairing.request({ token: qr.token, displayName: 'Fixture Pad', nonce: token() });
  await pairing.confirmLocal(p.requestId, true);
  return String((await pairing.claim(p.requestId, p.claimToken)).credential);
}
async function connect(cred: string) {
  const ws = new WebSocket(`wss://127.0.0.1:${port}/api/v1/ws`, {
    ca: tls.cert,
    headers: { Authorization: `Bearer ${cred}` },
  });
  sockets.push(ws);
  await once(ws, 'open');
  return ws;
}
function call(
  ws: WebSocket,
  action: string,
  payload: unknown = {},
  id = crypto.randomUUID(),
): Promise<Record<string, unknown>> {
  return new Promise((resolveResult, reject) => {
    const timeout = setTimeout(() => {
      ws.off('message', listener);
      reject(new Error('WS response timeout'));
    }, 5000);
    const listener = (data: WebSocket.RawData) => {
      const p = JSON.parse(data.toString()) as Record<string, unknown>;
      if (p.id === id) {
        clearTimeout(timeout);
        ws.off('message', listener);
        resolveResult(p);
      }
    };
    ws.on('message', listener);
    ws.send(JSON.stringify({ v: 1, type: 'request', id, action, payload }));
  });
}
describe('real TLS + SQLite + JSONL fixture integration', () => {
  it('restores only a previously local-authorized, still assigned and certified listener', () => {
    expect(restoreListenAddress(undefined, tls.cert)).toBe('127.0.0.1');
    expect(restoreListenAddress('0.0.0.0', tls.cert)).toBe('127.0.0.1');
    for (const address of localAddresses()) {
      expect(restoreListenAddress(address, tls.cert)).toBe(address);
      expect(restoreListenAddress(address, tls.cert, [])).toBe('127.0.0.1');
    }
    const other = ['10.254.253.252', '192.168.254.253'].find(
      (ip) => !new X509Certificate(tls.cert).checkIP(ip),
    )!;
    expect(restoreListenAddress(other, tls.cert, [other])).toBe('127.0.0.1');
  });
  it('persists bounded retention settings and exports only structural diagnostics', async () => {
    const ws = await connect(await credential());
    await call(ws, 'system.hello', { client: 'test', version: 1 });
    const p = await project();
    await tasks.create(p.projectId, 'PRIVATE_PROMPT_SENTINEL');
    const updated = await call(ws, 'settings.update', { days: 7, maxMiB: 64 });
    expect(updated).toMatchObject({ payload: { retention: { days: 7, maxMiB: 64 } } });
    expect(store.retention()).toEqual({ days: 7, maxMiB: 64 });
    expect((await call(ws, 'settings.get')).payload).toEqual({
      retention: { days: 7, maxMiB: 64 },
    });
    const diagnostic = await call(ws, 'system.diagnostics');
    const text = JSON.stringify(diagnostic);
    expect(diagnostic).toMatchObject({
      payload: { upstreamReady: true, sandboxVerified: true, counts: { sessions: 1 } },
    });
    for (const secret of [
      'PRIVATE_PROMPT_SENTINEL',
      p.canonicalPath,
      'credential',
      'contextJson',
      'credentialHash',
    ])
      expect(text).not.toContain(secret);
  });
  it('reads a staged real rename and binary diff, and notices edits that keep the same Git status', async () => {
    const p = await project();
    await gitCommand(p.canonicalPath, ['init']);
    await writeFile(join(p.canonicalPath, 'old.txt'), 'original contents\n');
    await writeFile(join(p.canonicalPath, 'binary.bin'), Buffer.from([0, 1, 2]));
    await gitCommand(p.canonicalPath, ['add', '--all']);
    await gitCommand(p.canonicalPath, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'baseline',
    ]);
    await rename(join(p.canonicalPath, 'old.txt'), join(p.canonicalPath, 'new.txt'));
    await gitCommand(p.canonicalPath, ['add', '--all']);
    await writeFile(join(p.canonicalPath, 'binary.bin'), Buffer.from([0, 3, 4]));
    const git = new GitService(registry);
    const status = await git.status(p.projectId);
    const renamed = status.files.find((file) => file.path === 'new.txt')!;
    expect(renamed.oldPath).toBe('old.txt');
    expect((await git.diff(p.projectId, renamed.fileId)).text).toContain('rename from old.txt');
    expect(
      await git.diff(p.projectId, status.files.find((file) => file.path === 'binary.bin')!.fileId),
    ).toMatchObject({ binary: true });
    const before = await git.changeToken(p.projectId, status.files);
    await writeFile(join(p.canonicalPath, 'binary.bin'), Buffer.from([0, 5, 6]));
    expect((await git.status(p.projectId)).files).toEqual(status.files);
    expect(await git.changeToken(p.projectId, status.files)).not.toBe(before);
  });
  it('refuses broadened upstream sandbox and mismatched thread workspace', async () => {
    const p = await project();
    const original = upstream.rpc.request.bind(upstream.rpc);
    for (const mutation of ['network', 'temporary', 'writableRoot', 'threadCwd']) {
      const spy = vi
        .spyOn(upstream.rpc, 'request')
        .mockImplementation(async (method, params, timeout) => {
          const result = await original(method, params, timeout);
          if (method === 'thread/start') {
            const response = result as {
              sandbox: {
                networkAccess: boolean;
                excludeSlashTmp: boolean;
                writableRoots: string[];
              };
              thread: { cwd: string };
            };
            if (mutation === 'network') response.sandbox.networkAccess = true;
            if (mutation === 'temporary') response.sandbox.excludeSlashTmp = false;
            if (mutation === 'writableRoot') response.sandbox.writableRoots = [root];
            if (mutation === 'threadCwd') response.thread.cwd = root;
          }
          return result;
        });
      try {
        await expect(tasks.create(p.projectId, mutation)).rejects.toMatchObject({
          code:
            mutation === 'network' || mutation === 'temporary'
              ? 'UNSAFE_UPSTREAM_CONFIG'
              : 'WORKSPACE_FORBIDDEN',
        });
      } finally {
        spy.mockRestore();
      }
    }
    expect(store.sessions()).toHaveLength(0);
  });
  it('refuses unauthenticated and browser-origin upgrades; uses verifiable certificate pin', async () => {
    expect(tls.fingerprint).toBe(
      new X509Certificate(tls.cert).fingerprint256.replaceAll(':', '').toLowerCase(),
    );
    for (const headers of [
      {},
      { Authorization: `Bearer ${await credential()}`, Origin: 'https://attacker.example' },
    ]) {
      const ws = new WebSocket(`wss://127.0.0.1:${port}/api/v1/ws`, { ca: tls.cert, headers });
      sockets.push(ws);
      const [error] = await once(ws, 'error');
      expect(String(error)).toContain('401');
    }
  });
  it('runs two isolated projects, applies approvals once and rejects cross-session decisions', async () => {
    const p1 = await project('one'),
      p2 = await project('two');
    const s1 = await tasks.create(p1.projectId, 'First'),
      s2 = await tasks.create(p2.projectId, 'Second');
    const t1 = await tasks.start(s1.sessionId, 'APPROVAL'),
      t2 = await tasks.start(s2.sessionId, 'complete');
    await waitFor(() => store.approvals()[0]);
    const a = store.approvals()[0]!;
    await expect(
      approvals.decide(s2.sessionId, t2.turnId, a.approvalId, 'approve'),
    ).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    await approvals.decide(s1.sessionId, t1.turnId, a.approvalId, 'approve');
    await expect(
      approvals.decide(s1.sessionId, t1.turnId, a.approvalId, 'approve'),
    ).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    await waitFor(() => store.turn(t1.turnId).status === 'completed');
    await waitFor(() => store.turn(t2.turnId).status === 'completed');
    expect(store.history(s1.sessionId).every((e) => e.sessionId === s1.sessionId)).toBe(true);
    expect(store.history(s2.sessionId).every((e) => e.sessionId === s2.sessionId)).toBe(true);
  });
  it('deduplicates turn.start over WSS, replays events and verifies terminal interruption', async () => {
    const p = await project();
    const s = await tasks.create(p.projectId, 'Task');
    const ws = await connect(await credential());
    await call(ws, 'system.hello', { client: 'test', version: 1 });
    const id = crypto.randomUUID();
    const first = await call(ws, 'turn.start', { sessionId: s.sessionId, text: 'WAIT' }, id);
    const second = await call(ws, 'turn.start', { sessionId: s.sessionId, text: 'WAIT' }, id);
    expect(second).toEqual(first);
    const turn = (first.payload as { turn: { turnId: string } }).turn;
    expect(store.turns(s.sessionId)).toHaveLength(1);
    const interrupted = await call(ws, 'turn.interrupt', {
      sessionId: s.sessionId,
      turnId: turn.turnId,
    });
    expect(interrupted.type).toBe('response');
    await waitFor(() => store.turn(turn.turnId).status === 'interrupted');
    const replay = await call(ws, 'events.replay', { cursor: '0', limit: 100 });
    expect((replay.payload as { events: unknown[] }).events.length).toBeGreaterThan(2);
  });
  it('expires pending approval on disconnect without approving it', async () => {
    const p = await project();
    const s = await tasks.create(p.projectId, 'Approval');
    const ws = await connect(await credential());
    await call(ws, 'system.hello', { client: 'test', version: 1 });
    const turn = await tasks.start(s.sessionId, 'APPROVAL');
    await waitFor(() => store.approvals()[0]);
    const a = store.approvals()[0]!;
    ws.close();
    await once(ws, 'close');
    await waitFor(() => store.approvals().length === 0);
    await expect(
      approvals.decide(s.sessionId, turn.turnId, a.approvalId, 'approve'),
    ).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    expect(store.turn(turn.turnId).status).not.toBe('completed');
  });
  it('marks a crashed upstream task unknown rather than completed', async () => {
    const p = await project();
    const s = await tasks.create(p.projectId, 'Crash');
    const turn = await tasks.start(s.sessionId, 'WAIT');
    upstream.stop();
    await once(upstream.rpc, 'exit');
    expect(store.turn(turn.turnId).status).toBe('unknown'); // prevent teardown waiting for an already exited process
    upstream.rpc.start();
  });
  it('reviews actual Git changes, external edits and untracked binary metadata', async () => {
    const p = await project();
    await gitCommand(p.canonicalPath, ['init']);
    await gitCommand(p.canonicalPath, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'baseline',
    ]);
    await writeFile(join(p.canonicalPath, 'external.txt'), 'External modification\n');
    await writeFile(join(p.canonicalPath, 'binary.bin'), Buffer.from([1, 0, 2]));
    const git = new GitService(registry);
    const status = await git.status(p.projectId);
    expect(status.available).toBe(true);
    expect(status.attribution).toContain('external');
    const binary = status.files.find((f) => f.path === 'binary.bin')!;
    expect(await git.diff(p.projectId, binary.fileId)).toMatchObject({
      binary: true,
      untracked: true,
    });
    const text = status.files.find((f) => f.path === 'external.txt')!;
    expect(await git.diff(p.projectId, text.fileId)).toMatchObject({
      text: 'External modification\n',
    });
  });
  it('answers stable file and permission approvals using their distinct schemas', async () => {
    const p = await project();
    for (const kind of ['FILE_APPROVAL', 'PERMISSION_APPROVAL']) {
      const s = await tasks.create(p.projectId, kind);
      const turn = await tasks.start(s.sessionId, kind);
      await waitFor(() => store.approvals(s.sessionId)[0]);
      const a = store.approvals(s.sessionId)[0]!;
      const reply = once(upstream.rpc, 'notification').then(() => undefined);
      await approvals.decide(s.sessionId, turn.turnId, a.approvalId, 'reject');
      await reply;
      expect(store.approvals(s.sessionId)).toHaveLength(0);
    }
  });
  it('fails closed on unknown requests and rejects an expired approval', async () => {
    const p = await project();
    const unknown = await tasks.create(p.projectId, 'Unknown');
    const t = await tasks.start(unknown.sessionId, 'UNKNOWN_APPROVAL');
    await waitFor(() => ['interrupted', 'failed'].includes(store.turn(t.turnId).status));
    expect(store.approvals()).toHaveLength(0);
    const s = await tasks.create(p.projectId, 'Expired');
    const turn = await tasks.start(s.sessionId, 'APPROVAL');
    const a = await waitFor(() => store.approvals(s.sessionId)[0]);
    store.db
      .prepare('UPDATE approvals SET expiresAt=? WHERE approvalId=?')
      .run(new Date(Date.now() - 1).toISOString(), a.approvalId);
    await expect(
      approvals.decide(s.sessionId, turn.turnId, a.approvalId, 'approve'),
    ).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    await waitFor(() => store.approvals(s.sessionId).length === 0);
    expect(
      store.db.prepare('SELECT status FROM approvals WHERE approvalId=?').get(a.approvalId),
    ).toMatchObject({ status: 'expired' });
  });
  it('enforces a two-turn concurrency reservation before upstream responses', async () => {
    const p = await project();
    const sessions = [];
    for (let i = 0; i < 3; i++) sessions.push(await tasks.create(p.projectId, 'Concurrent'));
    const result = await Promise.allSettled(sessions.map((s) => tasks.start(s.sessionId, 'WAIT')));
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
  it('bounds huge untracked diffs and refuses Git outside the locally authorized root', async () => {
    const p = await project();
    const git = new GitService(registry);
    expect((await git.status(p.projectId)).available).toBe(false);
    await gitCommand(p.canonicalPath, ['init']);
    await writeFile(join(p.canonicalPath, 'huge.txt'), 'a'.repeat(400000));
    const file = (await git.status(p.projectId)).files[0]!;
    const diff = await git.diff(p.projectId, file.fileId);
    expect(diff.truncated).toBe(true);
    expect(Buffer.byteLength(String(diff.text))).toBe(256 * 1024);
    await expect(git.status('unapproved')).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
  });
  it('rebinds listeners without accumulating subscriptions and revokes live sockets', async () => {
    const before = store.listenerCount('event');
    await server.close();
    expect(store.listenerCount('event')).toBe(before - 1);
    server = new BridgeServer(store, tasks, approvals, pairing, new GitService(registry), tls, {
      requestProjectAdd: () => {},
      requestProjectRemove: () => {},
    });
    expect(store.listenerCount('event')).toBe(before);
    port = await server.listen('127.0.0.1', 0);
    const cred = await credential();
    const ws = await connect(cred);
    const deviceId = pairing.authenticate(cred)!.deviceId;
    expect(server.connectedDeviceIds()).toEqual([]);
    await call(ws, 'system.hello', { client: 'test', version: 1 });
    expect(server.connectedDeviceIds()).toEqual([deviceId]);
    const close = once(ws, 'close');
    pairing.revokeLocal(deviceId);
    await close;
    await waitFor(() => server.connectedDeviceIds().length === 0);
    expect(pairing.authenticate(cred)).toBeNull();
  });
  it('reopens persistent state after restart and reauthenticates without false completion', async () => {
    const p = await project();
    const s = await tasks.create(p.projectId, 'Restart');
    const turn = await tasks.start(s.sessionId, 'WAIT');
    const cred = await credential();
    const cursor = store.cursor();
    await server.close();
    approvals.close();
    upstream.stop();
    await once(upstream.rpc, 'exit');
    store.close();
    store = new Store(join(root, 'state.db'));
    store.recover();
    registry = new ProjectRegistry(store);
    upstream = new Supervisor(process.execPath, [resolve('bridge/test/appserver-fixture.mjs')]);
    tasks = new Tasks(store, registry, upstream);
    approvals = new Approvals(store, tasks);
    pairing = new Pairing(store, protector);
    server = new BridgeServer(store, tasks, approvals, pairing, new GitService(registry), tls, {
      requestProjectAdd: () => {},
      requestProjectRemove: () => {},
    });
    port = await server.listen('127.0.0.1', 0);
    await upstream.start();
    const ws = await connect(cred);
    await call(ws, 'system.hello', { client: 'test', version: 1 });
    expect((await call(ws, 'snapshot.get')).type).toBe('response');
    expect(store.turn(turn.turnId).status).toBe('unknown');
    expect(store.projects()[0]?.projectId).toBe(p.projectId);
    expect(store.replay(cursor).events.length).toBeGreaterThan(0);
  });
});

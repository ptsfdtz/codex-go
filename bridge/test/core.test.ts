import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { ProjectRegistry } from '../src/projects.js';
import { parseRequest } from '@agentdeck/protocol';
import { redact } from '../src/log.js';
import { Pairing } from '../src/pairing.js';
import { token } from '../src/security.js';
import { parseStatus } from '../src/git.js';
import { approvalChoices, commandDecision } from '../src/approval-contract.js';
import { codexEnvironment } from '../src/codex.js';
const stores: Store[] = [];
function store(): Store {
  const s = new Store(':memory:');
  stores.push(s);
  return s;
}
afterEach(() => {
  for (const s of stores) s.close();
  stores.length = 0;
});
describe('protocol and trust boundaries', () => {
  it('avoids the inaccessible Desktop cached PowerShell while preserving installed tools and the parent environment', () => {
    const source = {
      Path: 'C:\\Users\\test\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\powershell;C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6_x64;C:\\Program Files\\PowerShell\\7;C:\\Windows\\System32;C:\\Tools',
      SHELL: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    };
    const result = codexEnvironment(source, 'win32');
    expect(result.Path).toBe('C:\\Program Files\\PowerShell\\7;C:\\Windows\\System32;C:\\Tools');
    expect(result.SHELL).toBe(source.SHELL);
    expect(source.Path).toContain('codex-runtimes');
    expect(codexEnvironment(source, 'linux')).toEqual(source);
  });
  it('advertises only supported one-shot approval choices and fails closed on malformed restrictions', () => {
    const method = 'item/commandExecution/requestApproval';
    expect(approvalChoices(method, { availableDecisions: ['cancel'] })).toEqual([
      'reject',
      'cancel',
    ]);
    expect(commandDecision(method, 'reject', { availableDecisions: ['accept', 'cancel'] })).toEqual(
      { decision: 'cancel' },
    );
    expect(() => commandDecision(method, 'approve', { availableDecisions: ['cancel'] })).toThrow();
    for (const availableDecisions of [[], ['accept'], ['unknown'], 'accept'])
      expect(() => approvalChoices(method, { availableDecisions })).toThrow();
  });
  it('rejects arbitrary paths, raw methods, unsupported versions and excessive prompts', () => {
    expect(() =>
      parseRequest({
        v: 1,
        type: 'request',
        id: 'r',
        action: 'turn.start',
        payload: { sessionId: 's', text: 'hi', cwd: 'C:\\' },
      }),
    ).toThrow();
    expect(() =>
      parseRequest({ v: 1, type: 'request', id: 'r', action: 'command/exec', payload: {} }),
    ).toThrow();
    expect(() =>
      parseRequest({ v: 2, type: 'request', id: 'r', action: 'projects.list', payload: {} }),
    ).toThrow();
    expect(() =>
      parseRequest({
        v: 1,
        type: 'request',
        id: 'r',
        action: 'turn.start',
        payload: { sessionId: 's', text: 'a'.repeat(64001) },
      }),
    ).toThrow();
  });
  it('redacts API keys, authorization and credential assignments', () => {
    expect(
      redact('api_key=sk-abcdefghijk Authorization: Bearer ABCD credential=12345'),
    ).not.toContain('sk-abcdefghijk');
    expect(redact('credential=12345')).not.toContain('12345');
  });
  it('persists replay order, prevents future cursors and reports retention gaps', () => {
    const s = store();
    s.append('a', {});
    s.append('b', {});
    const page = s.replay('0', 1);
    expect(page.more).toBe(true);
    expect(page.events[0]?.seq).toBe(1);
    expect(s.replay(page.cursor, 2).events[0]?.action).toBe('b');
    expect(() => s.replay('100')).toThrow();
    s.setMeta('retentionFloor', '1');
    expect(() => s.replay('0')).toThrow();
  });
  it('keeps JSON valid when redacting escaped credentials and preserves sequence after pruning', () => {
    const s = store();
    const event = s.append('text', { password: 'abc\\"quoted', text: 'api_key=sk-1234567890' });
    expect(event.payload).toEqual({ password: '[REDACTED]', text: 'api_key=[REDACTED]' });
    s.db.prepare('DELETE FROM events').run();
    expect(s.append('next', {}).seq).toBe(2);
  });
  it('bounds large events and paged replay while signalling truncation', () => {
    const s = store();
    s.append('turn.progress', { delta: 'x'.repeat(400000) });
    expect(s.replay().events[0]?.payload).toMatchObject({ truncated: true });
    for (let i = 0; i < 10; i++) s.append('large', { text: 'x'.repeat(200000) });
    const page = s.replay('0', 100);
    expect(page.more).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(600000);
  });
  it('recovers active execution as unknown and invalidates unfinished requests', () => {
    const s = store();
    s.db.prepare("INSERT INTO projects VALUES('p','P','path','identity',1,'now')").run();
    s.db
      .prepare("INSERT INTO sessions VALUES('s','p','thread','title','running','now','now')")
      .run();
    s.db.prepare("INSERT INTO turns VALUES('t','s','upstream','running','now',NULL,NULL)").run();
    s.db.prepare("INSERT INTO requests VALUES('device','r','hash','pending',NULL,'now')").run();
    s.recover();
    expect(s.turn('t').status).toBe('unknown');
    expect(s.session('s').status).toBe('unknown');
    expect((s.db.prepare('SELECT status FROM requests').get() as { status: string }).status).toBe(
      'unknown',
    );
  });
  it('rejects traversal and a junction pointing outside an authorized project', async () => {
    const base = await mkdtemp(join(tmpdir(), 'agentdeck-path-test-'));
    const inside = join(base, 'inside'),
      outside = join(base, 'outside');
    await mkdir(inside);
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(
      outside,
      join(inside, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const registry = new ProjectRegistry(store());
    const project = await registry.addLocal(inside);
    await expect(registry.file(project.projectId, '../outside/secret.txt')).rejects.toMatchObject({
      code: 'WORKSPACE_FORBIDDEN',
    });
    await expect(registry.file(project.projectId, 'escape/secret.txt')).rejects.toMatchObject({
      code: 'WORKSPACE_FORBIDDEN',
    });
    await expect(registry.root('not-authorized')).rejects.toMatchObject({
      code: 'WORKSPACE_FORBIDDEN',
    });
  });
  it('requires local pairing confirmation, one-use tokens and one-use credential claim', async () => {
    const s = store();
    const pairing = new Pairing(s, { protect: async (b) => b, unprotect: async (b) => b });
    const invite = pairing.createLocal('https://localhost:49321', 'a'.repeat(64));
    const request = pairing.request({ token: invite.token, displayName: 'Pad', nonce: token() });
    expect(await pairing.claim(request.requestId, request.claimToken)).toEqual({
      status: 'pending',
    });
    expect(() =>
      pairing.request({ token: invite.token, displayName: 'Attacker', nonce: token() }),
    ).toThrow();
    await pairing.confirmLocal(request.requestId, true);
    const claimed = await pairing.claim(request.requestId, request.claimToken);
    expect(pairing.authenticate(String(claimed.credential))?.displayName).toBe('Pad');
    await expect(pairing.claim(request.requestId, request.claimToken)).rejects.toThrow();
    pairing.revokeLocal(String(claimed.deviceId));
    expect(pairing.authenticate(String(claimed.credential))).toBeNull();
  });
  it('parses NUL filenames and reverse rename fields without splitting spaces', () => {
    const files = parseStatus(Buffer.from('R  new name.txt\0old name.txt\0?? line\nname.txt\0'));
    expect(files[0]).toMatchObject({ path: 'new name.txt', oldPath: 'old name.txt' });
    expect(files[1]?.path).toBe('line\nname.txt');
  });
});

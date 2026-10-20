import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { Store } from '../bridge/src/store.js';
import { ProjectRegistry } from '../bridge/src/projects.js';
import { findCodex, verifyCodex, Supervisor } from '../bridge/src/codex.js';
import { Tasks } from '../bridge/src/tasks.js';
import { Approvals } from '../bridge/src/approvals.js';
import { verifySandbox } from './verify-sandbox.js';
import type { RpcMessage } from '../bridge/src/rpc.js';

const report: { at: string; checks: unknown[]; result: string; error?: string } = {
  at: new Date().toISOString(),
  checks: [],
  result: 'RUNNING',
};
const root = await mkdtemp(join(tmpdir(), 'agentdeck-bridge-real-'));
const store = new Store(join(root, 'state.db'));
const registry = new ProjectRegistry(store);
const exe = findCodex();
verifyCodex(exe);
const supervisor = new Supervisor(exe);
const tasks = new Tasks(store, registry, supervisor);
const approvals = new Approvals(store, tasks);
async function terminal(turnId: string) {
  const until = Date.now() + 120000;
  while (Date.now() < until) {
    const turn = store.turn(turnId);
    if (['completed', 'failed', 'interrupted'].includes(turn.status)) return turn;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('No authoritative terminal state within 120 seconds');
}
try {
  const boundary = await verifySandbox();
  report.checks.push({ check: 'native sandbox boundary', ...boundary });
  if (!boundary.passed) throw new Error('Sandbox verification failed');
  store.setMeta('sandboxVerifiedVersion', '0.159.2');
  await supervisor.start();
  const paths = [join(root, 'one'), join(root, 'two')];
  for (const path of paths) await mkdir(path);
  const projects = await Promise.all(paths.map((p) => registry.addLocal(p)));
  const sessions = [];
  for (const project of projects)
    sessions.push(await tasks.create(project.projectId, `Real smoke ${project.name}`));
  report.checks.push({
    check: 'real Bridge session creation',
    result: 'PASS',
    count: sessions.length,
  });
  const turns = await Promise.all(
    sessions.map((s, i) =>
      tasks.start(
        s.sessionId,
        `Reply exactly AGENTDECK_PROJECT_${i}_OK. Do not run commands or read files.`,
      ),
    ),
  );
  const ended = await Promise.all(turns.map((t) => terminal(t.turnId)));
  report.checks.push({
    check: 'two concurrent real threads',
    result: ended.every((t) => t.status === 'completed') ? 'PASS' : 'FAIL',
    statuses: ended.map((t) => t.status),
  });
  const interrupted = await tasks.start(
    sessions[0]!.sessionId,
    'Write a numbered list of 2000 short software testing ideas in this reply. Do not run commands or read files.',
  );
  await tasks.interrupt(sessions[0]!.sessionId, interrupted.turnId);
  const end = await terminal(interrupted.turnId);
  report.checks.push({
    check: 'real upstream interruption',
    result: end.status === 'interrupted' ? 'PASS' : 'FAIL',
    status: end.status,
  });
  const events = store.replay('0', 500).events;
  report.checks.push({
    check: 'persistent structured events',
    result: events.some((e) => e.action === 'turn.progress') ? 'PASS' : 'FAIL',
    count: events.length,
  });
  const requests: RpcMessage[] = [];
  supervisor.rpc.on('request', (m: RpcMessage) => requests.push(m));
  report.result = report.checks.some((c) => (c as { result?: string }).result === 'FAIL')
    ? 'FAIL'
    : 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  approvals.close();
  supervisor.stop();
  if (supervisor.rpc.alive) await once(supervisor.rpc, 'exit');
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/real-bridge-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  store.close();
}

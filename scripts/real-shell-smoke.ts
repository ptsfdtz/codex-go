import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { Store } from '../bridge/src/store.js';
import { ProjectRegistry } from '../bridge/src/projects.js';
import { Supervisor, findCodex } from '../bridge/src/codex.js';
import { Tasks } from '../bridge/src/tasks.js';
import { Approvals } from '../bridge/src/approvals.js';
import { verifySandbox } from './verify-sandbox.js';
import { safeError } from '../bridge/src/errors.js';

const root = await mkdtemp(join(tmpdir(), 'agentdeck-shell-smoke-'));
const store = new Store(join(root, 'state.db'));
const registry = new ProjectRegistry(store);
const upstream = new Supervisor(findCodex());
const tasks = new Tasks(store, registry, upstream);
const approvals = new Approvals(store, tasks);
const report: Record<string, unknown> = {
  at: new Date().toISOString(),
  result: 'RUNNING',
  source: 'Real Codex command execution in isolated temporary workspace; no automatic approvals',
};
try {
  if (!(await verifySandbox()).passed) throw new Error('Sandbox boundary failed');
  store.setMeta('sandboxVerifiedVersion', '0.159.2');
  await upstream.start();
  const project = await registry.addLocal(root);
  const session = await tasks.create(project.projectId, 'Actual shell execution verification');
  const turn = await tasks.start(
    session.sessionId,
    'Use the shell tool to run exactly Write-Output AGENTDECK_SHELL_OK in PowerShell, with login=false. Do not read or modify files, use network, run other commands, or request extra permissions. Report the actual tool output.',
  );
  const deadline = Date.now() + 120000;
  while (
    Date.now() < deadline &&
    !['completed', 'failed', 'interrupted'].includes(store.turn(turn.turnId).status)
  ) {
    if (store.approvals().length)
      throw new Error('Unexpected approval request; not automatically accepted');
    await new Promise((r) => setTimeout(r, 100));
  }
  const items = store
    .history(session.sessionId, undefined, 500)
    .filter((e) => e.action === 'turn.progress')
    .map(
      (e) =>
        e.payload as {
          method?: string;
          item?: { type?: string; exitCode?: number; aggregatedOutput?: string };
        },
    )
    .filter((p) => p.method === 'item/completed' && p.item?.type === 'commandExecution')
    .map((p) => p.item!);
  report.commands = items.map((item) => ({
    exitCode: item.exitCode,
    markerObserved: item.aggregatedOutput?.trim() === 'AGENTDECK_SHELL_OK',
  }));
  report.terminal = store.turn(turn.turnId).status;
  if (
    report.terminal !== 'completed' ||
    !items.some(
      (item) => item.exitCode === 0 && item.aggregatedOutput?.trim() === 'AGENTDECK_SHELL_OK',
    )
  )
    throw new Error('No successful command output marker');
  report.result = 'PASS';
} catch (e) {
  report.result = 'FAIL';
  report.error = safeError(e);
  process.exitCode = 1;
} finally {
  approvals.invalidate();
  approvals.close();
  const exited = upstream.rpc.alive ? once(upstream.rpc, 'exit') : null;
  upstream.stop();
  if (exited) await exited;
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/real-shell-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  store.close();
}

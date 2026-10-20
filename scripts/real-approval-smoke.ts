import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { Store } from '../bridge/src/store.js';
import { ProjectRegistry } from '../bridge/src/projects.js';
import { Supervisor, findCodex } from '../bridge/src/codex.js';
import { Tasks } from '../bridge/src/tasks.js';
import { Approvals } from '../bridge/src/approvals.js';
import { Desktop } from '../bridge/src/desktop.js';
import { verifySandbox } from './verify-sandbox.js';
import { safeError } from '../bridge/src/errors.js';

const root = await mkdtemp(join(tmpdir(), 'agentdeck-human-approval-'));
const store = new Store(join(root, 'state.db')),
  registry = new ProjectRegistry(store),
  upstream = new Supervisor(findCodex());
const tasks = new Tasks(store, registry, upstream),
  approvals = new Approvals(store, tasks),
  desktop = new Desktop();
const report: Record<string, unknown> = {
  at: new Date().toISOString(),
  source: 'real Codex; Windows human review (not Android acceptance)',
  result: 'RUNNING',
};
let decisionDone = false;
const state = () =>
  desktop.send('state', {
    windowTitle: 'AgentDeck - Real Approval Test',
    status: '真实审批测试：进入审批中心，核对完整操作，再亲自选择拒绝此请求或允许一次…。',
    projects: store.projects(),
    devices: [],
    approvals: store.approvals(),
    addresses: [],
  });
store.on('event', (e) => {
  if (e.action.startsWith('approval.')) state();
  if (e.action === 'approval.requested')
    console.log(
      'REAL_APPROVAL_PENDING: Windows window "AgentDeck - Real Approval Test", Approvals tab. Human decision required; expires in 5 minutes.',
    );
});
desktop.on('action', (action: Record<string, unknown>) => {
  if (action.action !== 'approval.decide' || decisionDone) return;
  decisionDone = true;
  void (async () => {
    const result = await approvals.decide(
      String(action.sessionId),
      String(action.turnId),
      String(action.approvalId),
      action.decision as 'approve' | 'reject' | 'cancel',
    );
    report.humanDecision = action.decision;
    report.delivery = result;
    try {
      await approvals.decide(
        String(action.sessionId),
        String(action.turnId),
        String(action.approvalId),
        'approve',
      );
      report.duplicateRejected = false;
    } catch {
      report.duplicateRejected = true;
    }
    state();
  })().catch((e) => {
    report.error = safeError(e);
  });
});
try {
  state();
  const boundary = await verifySandbox();
  if (!boundary.passed) throw new Error('Sandbox boundary failed');
  store.setMeta('sandboxVerifiedVersion', '0.159.2');
  await upstream.start();
  const project = await registry.addLocal(root);
  const session = await tasks.create(project.projectId, 'Human approval smoke');
  state();
  const turn = await tasks.start(
    session.sessionId,
    'This is a controlled approval transport test. Use your shell tool to run exactly Write-Output AGENTDECK_APPROVAL_OK in PowerShell in the current workspace. Request sandbox_permissions=require_escalated and justification="AgentDeck human approval transport verification" so the human can review the request. Do not read files, use network, modify files, or execute any other command. If rejected, stop and report rejection.',
  );
  const deadline = Date.now() + 15 * 60000;
  while (Date.now() < deadline) {
    const current = store.turn(turn.turnId);
    if (['completed', 'failed', 'interrupted'].includes(current.status)) {
      report.terminal = current.status;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const rows = store.db.prepare('SELECT method,status FROM approvals').all();
  report.requests = rows;
  const commands = store.db
    .prepare("SELECT payloadJson FROM events WHERE action='turn.progress'")
    .all()
    .map(
      (row) =>
        JSON.parse((row as { payloadJson: string }).payloadJson) as {
          method?: string;
          item?: { type?: string; exitCode?: number; aggregatedOutput?: string };
        },
    )
    .filter((e) => e.method === 'item/completed' && e.item?.type === 'commandExecution')
    .map((e) => ({
      exitCode: e.item!.exitCode,
      markerObserved: e.item!.aggregatedOutput?.trim() === 'AGENTDECK_APPROVAL_OK',
    }));
  report.commands = commands;
  report.result =
    rows.length &&
    decisionDone &&
    report.delivery &&
    report.duplicateRejected === true &&
    report.terminal &&
    (report.humanDecision !== 'approve' ||
      commands.some((c) => c.exitCode === 0 && c.markerObserved)) &&
    !report.error
      ? 'PASS'
      : 'SKIPPED';
  if (report.result === 'SKIPPED')
    report.reason = 'No human-confirmed real request completed within the test window';
} catch (e) {
  report.result = 'FAIL';
  report.error = safeError(e);
  process.exitCode = 1;
} finally {
  approvals.invalidate();
  approvals.close();
  upstream.stop();
  if (upstream.rpc.alive) await once(upstream.rpc, 'exit');
  desktop.close();
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/real-approval-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  store.close();
}

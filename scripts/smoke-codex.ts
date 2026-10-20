import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { findCodex, verifyCodex, serverArgs } from '../bridge/src/codex.js';
import { RpcClient, initializeRpc, type RpcMessage } from '../bridge/src/rpc.js';
import { validateContract } from '../bridge/src/contracts.js';
import type { ThreadStartResponse } from '../bridge/generated/codex/v2/ThreadStartResponse.js';
import type { TurnStartResponse } from '../bridge/generated/codex/v2/TurnStartResponse.js';

const report: Record<string, unknown> = {
  date: new Date().toISOString(),
  codexVersion: '0.159.2',
  checks: [],
};
const checks = report.checks as unknown[];
const samples: Record<string, unknown> = {};
const exe = findCodex();
verifyCodex(exe);
const rpc = new RpcClient(exe, serverArgs(), 60000);
const root = await mkdtemp(join(tmpdir(), 'agentdeck-real-smoke-'));
const notifications: RpcMessage[] = [];
rpc.on('notification', (message: RpcMessage) => notifications.push(message));
rpc.on('request', (message: RpcMessage) => {
  if (message.id !== undefined) rpc.reject(message.id);
});
rpc.start();
try {
  await initializeRpc(rpc);
  checks.push({ check: 'initialize/initialized', result: 'PASS' });
  const account = (await rpc.request('account/read', { refreshToken: false })) as {
    account: unknown;
    requiresOpenaiAuth: boolean;
  };
  checks.push({ check: 'local auth', result: account.account ? 'PASS' : 'SKIPPED' });
  const config = (await rpc.request('config/read', { includeLayers: false })) as {
    config: Record<string, unknown>;
  };
  checks.push({
    check: 'config safety',
    legacySandbox: config.config.sandbox_mode ?? null,
    defaultPermissions: config.config.default_permissions ?? null,
  });
  if (!account.account && account.requiresOpenaiAuth) {
    report.result = 'SKIPPED';
    report.reason = 'Local Codex login unavailable';
  } else {
    const result = await rpc.request('thread/start', {
      cwd: root,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      config: { default_permissions: 'agentdeck' },
    });
    validateContract('v2/ThreadStartResponse', result);
    const thread = (result as ThreadStartResponse).thread;
    samples.threadStart = result;
    checks.push({
      check: 'thread/start',
      result: 'PASS',
      sandbox: (result as ThreadStartResponse).sandbox,
    });
    for (const [index, text] of [
      'Reply with exactly AGENTDECK_SMOKE_OK. Do not read files or run commands.',
      'Reply with exactly AGENTDECK_CONTINUE_OK. Do not read files or run commands.',
    ].entries()) {
      const started = await rpc.request('turn/start', {
        threadId: thread.id,
        input: [{ type: 'text', text, text_elements: [] }],
      });
      validateContract('v2/TurnStartResponse', started);
      const turn = (started as TurnStartResponse).turn;
      samples.turnStart = started;
      const terminal = await new Promise<RpcMessage>((res, rej) => {
        const match = () =>
          notifications.find(
            (m) =>
              m.method === 'turn/completed' &&
              (m.params as { turn: { id: string } }).turn.id === turn.id,
          );
        const existing = match();
        if (existing) {
          res(existing);
          return;
        }
        const timer = setTimeout(() => {
          rpc.off('notification', listener);
          rej(new Error('No authoritative turn/completed within 90 seconds'));
        }, 90000);
        const listener = () => {
          const found = match();
          if (found) {
            clearTimeout(timer);
            rpc.off('notification', listener);
            res(found);
          }
        };
        rpc.on('notification', listener);
      });
      validateContract('v2/TurnCompletedNotification', terminal.params);
      const params = terminal.params as { turn: { status: string; error: unknown } };
      samples.terminal = terminal.params;
      checks.push({
        check: index ? 'continue' : 'real turn/completed',
        result: params.turn.status === 'completed' ? 'PASS' : 'FAIL',
        status: params.turn.status,
        error: params.turn.error,
      });
      if (index === 0) {
        const resume = await rpc.request('thread/resume', {
          threadId: thread.id,
          excludeTurns: true,
          cwd: root,
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        });
        validateContract('v2/ThreadResumeResponse', resume);
        samples.resume = resume;
        checks.push({ check: 'thread/resume', result: 'PASS' });
      }
    }
    report.result = checks.some((c) => (c as { result?: string }).result === 'FAIL')
      ? 'FAIL'
      : 'PASS';
  }
} catch (error) {
  report.result = 'FAIL';
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  rpc.stop();
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/codex-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(
    resolve('artifacts/real-protocol-samples.json'),
    JSON.stringify(samples, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
}

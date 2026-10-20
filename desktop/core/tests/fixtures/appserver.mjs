import readline from 'node:readline';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const samples = JSON.parse(
  readFileSync(new URL('./protocol-samples.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''),
);
const threads = new Map();
let nextRequest = 50;
const pending = new Map();
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const clone = (v) => structuredClone(v);
const terminal = (threadId, turnId, status) => {
  const params = clone(samples.terminal);
  params.threadId = threadId;
  params.turn.id = turnId;
  params.turn.status = status;
  params.turn.error =
    status === 'failed'
      ? { message: 'Fixture execution failure', codexErrorInfo: null, additionalDetails: null }
      : null;
  threads.get(threadId).turns.set(turnId, params.turn);
  send({ method: 'turn/completed', params });
};
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  const p = m.params;
  if (!m.method) {
    const waiting = pending.get(m.id);
    if (waiting) {
      pending.delete(m.id);
      send({
        method: 'serverRequest/resolved',
        params: { threadId: waiting.threadId, requestId: m.id },
      });
      send({ method: 'fixture/approvalReply', params: { id: m.id, result: m.result } });
      terminal(
        waiting.threadId,
        waiting.turnId,
        m.result?.decision === 'accept' ? 'completed' : 'interrupted',
      );
    }
    return;
  }
  const respond = (result) => send({ id: m.id, result });
  switch (m.method) {
    case 'initialize':
      respond({
        userAgent: 'AgentDeck fixture',
        codexHome: process.cwd(),
        platformFamily: 'windows',
        platformOs: 'windows',
      });
      return;
    case 'initialized':
      return;
    case 'windowsSandbox/readiness':
      respond({ status: 'ready' });
      return;
    case 'config/read':
      respond({
        config: {
          default_permissions: 'agentdeck',
          sandbox_mode: null,
          permissions: {
            agentdeck: {
              extends: ':workspace',
              filesystem: {
                ':root': 'deny',
                ':minimal': 'read',
                ':tmpdir': 'deny',
                ':slash_tmp': 'deny',
              },
              network: { enabled: false },
            },
          },
        },
        origins: {},
        layers: null,
      });
      return;
    case 'thread/start': {
      const result = clone(samples.threadStart);
      const id = 'fixture_' + randomUUID();
      result.thread.id = id;
      result.thread.cwd = p.cwd;
      result.cwd = p.cwd;
      threads.set(id, { root: p.cwd, turns: new Map() });
      respond(result);
      return;
    }
    case 'thread/resume': {
      const thread = threads.get(p.threadId);
      if (!thread) {
        send({ id: m.id, error: { code: -1, message: 'Not found' } });
        return;
      }
      const result = clone(samples.resume);
      result.thread.id = p.threadId;
      result.thread.cwd = thread.root;
      result.cwd = thread.root;
      respond(result);
      return;
    }
    case 'thread/read': {
      const result = clone(samples.threadStart);
      result.thread.id = p.threadId;
      result.thread.turns = [];
      respond({ thread: result.thread });
      return;
    }
    case 'thread/turns/list':
      respond({
        data: [...(threads.get(p.threadId)?.turns.values() ?? [])],
        nextCursor: null,
        backwardsCursor: null,
      });
      return;
    case 'turn/start': {
      const result = clone(samples.turnStart);
      const turnId = 'fixture_' + randomUUID();
      result.turn.id = turnId;
      result.turn.status = 'inProgress';
      result.turn.completedAt = null;
      result.turn.items = [];
      const text = p.input[0].text;
      send({ method: 'turn/started', params: { threadId: p.threadId, turn: result.turn } });
      send({
        method: 'item/agentMessage/delta',
        params: {
          threadId: p.threadId,
          turnId,
          itemId: 'message',
          delta: 'Fixture streaming text',
        },
      });
      respond(result);
      if (text.includes('APPROVAL')) {
        const requestId = ++nextRequest;
        pending.set(requestId, { threadId: p.threadId, turnId });
        const root = threads.get(p.threadId).root;
        const common = { threadId: p.threadId, turnId, itemId: 'cmd', startedAtMs: Date.now() };
        const method = text.includes('FILE_')
          ? 'item/fileChange/requestApproval'
          : text.includes('PERMISSION_')
            ? 'item/permissions/requestApproval'
            : text.includes('UNKNOWN_')
              ? 'unknown/requestApproval'
              : 'item/commandExecution/requestApproval';
        const extra = text.includes('FILE_')
          ? { grantRoot: root }
          : text.includes('PERMISSION_')
            ? {
                cwd: root,
                environmentId: null,
                reason: null,
                permissions: { network: null, fileSystem: { read: [root], write: null } },
              }
            : {
                kind: 'command',
                environmentId: null,
                command: 'echo fixture',
                cwd: root,
                availableDecisions: ['accept', 'cancel'],
              };
        send({ id: requestId, method, params: { ...common, ...extra } });
      } else if (!text.includes('WAIT'))
        setTimeout(
          () => terminal(p.threadId, turnId, text.includes('FAIL') ? 'failed' : 'completed'),
          20,
        );
      return;
    }
    case 'turn/interrupt':
      respond({});
      setTimeout(() => terminal(p.threadId, p.turnId, 'interrupted'), 10);
      return;
    default:
      send({ id: m.id, error: { code: -32601, message: 'Unknown fixture method' } });
  }
});

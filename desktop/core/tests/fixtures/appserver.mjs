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
        m.result?.decision === 'accept' || m.result?.answers?.approach?.answers?.[0] === 'A' ? 'completed' : 'interrupted',
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
    case 'model/list':
      respond({
        data: [
          {
            id: 'fixture-model',
            model: 'fixture-model',
            displayName: 'Fixture Model',
            hidden: false,
            isDefault: true,
            description: 'Isolated test model',
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [
              { reasoningEffort: 'low', description: 'Low' },
              { reasoningEffort: 'medium', description: 'Medium' },
              { reasoningEffort: 'high', description: 'High' },
            ],
          },
        ],
        nextCursor: null,
      });
      return;
    case 'thread/name/set':
      threads.get(p.threadId).name = p.name;
      respond({});
      return;
    case 'thread/archive':
      threads.get(p.threadId).archived = true;
      respond({});
      return;
    case 'thread/unarchive': {
      const result = clone(samples.threadStart);
      result.thread.id = p.threadId;
      result.thread.cwd = threads.get(p.threadId).root;
      respond({ thread: result.thread });
      return;
    }
    case 'thread/delete':
      if (threads.get(p.threadId)?.name === 'REFUSE_DELETE') {
        send({ id: m.id, error: { code: -1, message: 'Fixture refusal' } });
        return;
      }
      threads.delete(p.threadId);
      respond({});
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
      if (thread?.name === 'WRITER_CONFLICT') {
        send({id:m.id,error:{code:-32600,message:`thread ${p.threadId} already has an active writer`}});
        return;
      }
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
    case 'thread/fork': {
      const source = threads.get(p.threadId);
      const result = clone(samples.threadStart);
      result.thread.id = 'fixture_' + randomUUID();
      result.thread.cwd = source.root;
      result.cwd = source.root;
      threads.set(result.thread.id, {root:source.root, turns:new Map(source.turns)});
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
        data: [...(threads.get(p.threadId)?.turns.values() ?? [])].reverse().slice(0,p.limit ?? 100),
        nextCursor: null,
        backwardsCursor: null,
      });
      return;
    case 'thread/goal/set': {
      const current = threads.get(p.threadId);
      const now = Date.now();
      current.goal = {...(current.goal ?? {createdAt:now,objective:'',tokensUsed:0,timeUsedSeconds:0}),...p,updatedAt:now};
      respond({goal:current.goal});
      return;
    }
    case 'turn/start': {
      const result = clone(samples.turnStart);
      const turnId = 'fixture_' + randomUUID();
      result.turn.id = turnId;
      result.turn.status = 'inProgress';
      result.turn.completedAt = null;
      result.turn.items = [];
      const text = p.input[0].text;
      const expectedMode = text === 'CHECK_PLAN' ? 'plan' : 'default';
      if(text.startsWith('CHECK_COMPOSER') || text === 'CHECK_PLAN') {
        const valid = p.collaborationMode?.mode === expectedMode && p.collaborationMode?.settings.model === 'fixture-model' &&
          (text !== 'CHECK_COMPOSER_FILES' || (p.input[1]?.type === 'text' && p.input[1].text.includes('notes.txt') && p.input[2]?.type === 'localImage')) &&
          (text !== 'CHECK_COMPOSER_GOAL' || threads.get(p.threadId).goal?.status === 'active') &&
          (text !== 'CHECK_COMPOSER_PAUSE' || threads.get(p.threadId).goal?.status === 'paused');
        if(!valid){send({id:m.id,error:{code:-1,message:'Composer options not forwarded'}});return;}
      }
      if (text.startsWith('CHECK_PERMISSION_')) {
        const full = text === 'CHECK_PERMISSION_FULL';
        if (p.approvalPolicy !== (full ? 'never' : 'on-request') ||
            p.sandboxPolicy?.type !== (full ? 'dangerFullAccess' : 'workspaceWrite') ||
            (!full && (p.sandboxPolicy.networkAccess !== false || !p.sandboxPolicy.excludeTmpdirEnvVar || !p.sandboxPolicy.excludeSlashTmp))) {
          send({ id: m.id, error: { code: -1, message: 'Permission policy not forwarded/reset' } });
          return;
        }
      }
      if (text === 'CHECK_MODEL' && (p.model !== 'fixture-model' || p.effort !== 'high')) {
        send({ id: m.id, error: { code: -1, message: 'Model/effort not forwarded' } });
        return;
      }
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
      if (text === 'QUESTION') {
        const requestId = ++nextRequest;
        pending.set(requestId, {threadId:p.threadId,turnId});
        send({id:requestId,method:'item/tool/requestUserInput',params:{threadId:p.threadId,turnId,itemId:'question',isBlocking:true,questions:[{id:'approach',header:'Approach',question:'Which approach?',options:[{label:'A',description:'First approach'},{label:'B',description:'Second approach'}]}]}});
      } else if (text.includes('APPROVAL')) {
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

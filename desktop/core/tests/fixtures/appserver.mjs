import readline from 'node:readline';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const samples = JSON.parse(
  readFileSync(new URL('./protocol-samples.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''),
);
const threads = new Map();
const skillStates = new Map();
let skillWrites = 0;
let configVersion = 0;
let defaultModel = 'fixture-model';
let defaultEffort = 'medium';
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
        m.result?.decision === 'accept' ||
          m.result?.answers?.approach?.answers?.[0] === 'A' ||
          (m.result?.scope === 'turn' &&
            m.result?.permissions?.fileSystem &&
            Object.values(m.result.permissions.fileSystem).some(
              (value) => Array.isArray(value) && value.length > 0,
            ))
          ? 'completed'
          : 'interrupted',
      );
    }
    return;
  }
  const respond = (result) => send({ id: m.id, result });
  switch (m.method) {
    case 'initialize':
      respond({
        userAgent: 'agentdeck/0.159.2 (test fixture)',
        codexHome: process.cwd(),
        platformFamily: 'windows',
        platformOs: 'windows',
      });
      return;
    case 'initialized':
      return;
    case 'skills/list': {
      const data = (p.cwds ?? []).map((cwd) => {
        const path = join(cwd, '.fixture-skills', 'SKILL.md');
        if (!skillStates.has(path)) skillStates.set(path, true);
        return {
          cwd,
          errors: [],
          skills: [
            {
              name: 'fixture-skill',
              path,
              scope: 'repo',
              enabled: skillStates.get(path),
              description: `fixture skill; writes ${skillWrites}`,
            },
          ],
        };
      });
      respond({ data });
      return;
    }
    case 'skills/config/write':
      skillWrites++;
      skillStates.set(p.path, p.enabled);
      respond({ effectiveEnabled: p.enabled });
      return;
    case 'windowsSandbox/readiness':
      respond({ status: 'ready' });
      return;
    case 'config/read':
      respond({
        config: {
          model: defaultModel,
          model_reasoning_effort: defaultEffort,
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
        layers: [
          {
            name: { type: 'user', file: join(process.cwd(), 'fixture-user.toml') },
            version: String(configVersion),
            config: { model: defaultModel, model_reasoning_effort: defaultEffort },
          },
        ],
      });
      return;
    case 'config/batchWrite':
      if (
        p.filePath !== join(process.cwd(), 'fixture-user.toml') ||
        p.expectedVersion !== String(configVersion) ||
        p.edits.length !== 2 ||
        p.edits[0].keyPath !== 'model' ||
        p.edits[1].keyPath !== 'model_reasoning_effort' ||
        p.edits.some((e) => e.mergeStrategy !== 'replace')
      ) {
        send({ id: m.id, error: { code: -32602, message: 'Invalid fixture config write' } });
        return;
      }
      defaultModel = p.edits[0].value;
      defaultEffort = p.edits[1].value;
      configVersion++;
      respond({ filePath: p.filePath, status: 'ok', version: String(configVersion) });
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
    case 'thread/list': {
      const repeated = [...threads.values()].some((t) => t.name === 'INDEX_REPEAT_CURSOR');
      let data = [...threads.entries()]
        .filter(([, t]) => Boolean(t.archived) === Boolean(p.archived))
        .filter(
          ([, t]) =>
            t.name === 'INDEX_OUTSIDE' ||
            !p.cwd ||
            (Array.isArray(p.cwd) ? p.cwd : [p.cwd]).includes(t.root),
        )
        .map(([id, t]) => {
          const thread = clone(samples.threadStart.thread);
          Object.assign(thread, { id, cwd: t.root, name: t.name ?? null, source: 'appServer' });
          if (t.name === 'INDEX_ACTIVE') thread.status = { type: 'active', activeFlags: [] };
          if (t.name === 'INDEX_CHILD') {
            thread.parentThreadId = [...threads.keys()].find((key) => key !== id) ?? null;
            thread.forkedFromId = thread.parentThreadId;
          }
          return thread;
        });
      if (repeated) {
        respond({ data: p.cursor ? [] : data, nextCursor: 'repeat' });
        return;
      }
      const offset = p.cursor ? Number(p.cursor) : 0;
      const next = offset + 1;
      data = data.slice(offset, next);
      if (data[0]?.name === 'INDEX_DUPLICATE') {
        data.push({ ...data[0], preview: 'stale listing', name: 'stale listing' });
      }
      const total = [...threads.values()]
        .filter((t) => Boolean(t.archived) === Boolean(p.archived))
        .filter(
          (t) =>
            t.name === 'INDEX_OUTSIDE' ||
            !p.cwd ||
            (Array.isArray(p.cwd) ? p.cwd : [p.cwd]).includes(t.root),
        ).length;
      respond({ data, nextCursor: next < total ? String(next) : null });
      return;
    }
    case 'thread/loaded/list':
      respond({
        data: [...threads.entries()]
          .filter(([, t]) => ['OBSERVE_EXACT_ONLY', 'OBSERVE_WRONG_ID'].includes(t.name))
          .map(([id]) => id),
        nextCursor: null,
      });
      return;
    case 'thread/resume': {
      const thread = threads.get(p.threadId);
      if (
        thread?.name === 'OBSERVE_EXACT_ONLY' &&
        Object.keys(p).some((key) => !['threadId', 'cwd', 'excludeTurns'].includes(key))
      ) {
        send({
          id: m.id,
          error: { code: -32600, message: 'Observation must not override execution settings' },
        });
        return;
      }
      if (thread?.name === 'MISSING_ROLLOUT') {
        send({
          id: m.id,
          error: { code: -32600, message: `no rollout found for thread id ${p.threadId}` },
        });
        return;
      }
      if (thread?.name === 'MISSING_LINEAGE') {
        send({
          id: m.id,
          error: {
            code: -32600,
            message: `invalid paginated history lineage for ${p.threadId}: missing source rollout`,
          },
        });
        return;
      }
      if (thread?.name === 'WRITER_CONFLICT') {
        send({
          id: m.id,
          error: { code: -32600, message: `thread ${p.threadId} already has an active writer` },
        });
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
      if (thread.name === 'OBSERVE_WRONG_ID') result.thread.id = 'different-thread';
      respond(result);
      return;
    }
    case 'account/read':
      respond({
        account: { type: 'apiKey', apiKey: 'fixture-secret-account-key' },
        requiresOpenaiAuth: true,
        refreshToken: 'fixture-secret-refresh',
      });
      return;
    case 'account/rateLimits/read':
      respond({
        rateLimits: {
          limitId: 'codex',
          primary: {
            usedPercent: 37,
            windowDurationMins: 300,
            resetsAt: 2000000000,
            accessToken: 'fixture-secret-window',
          },
          credits: { hasCredits: true, unlimited: false, balance: '12' },
        },
        ordinaryUsageAllowed: false,
        rateLimitsByLimitId: null,
        accountId: 'fixture-secret-account-id',
        rateLimitUpsell: { url: 'fixture-secret-url' },
      });
      return;
    case 'thread/revert': {
      const source = threads.get(p.threadId);
      const turns = [...source.turns.entries()];
      const boundary = turns.findIndex(([id]) => id === p.beforeTurnId);
      if (boundary < 0) {
        send({ id: m.id, error: { code: -1, message: 'Unknown revert boundary' } });
        return;
      }
      source.turns = new Map(turns.slice(0, boundary));
      const result = clone(samples.threadStart);
      result.thread.id = p.threadId;
      result.thread.cwd = source.root;
      result.thread.turns = [];
      respond({ thread: result.thread, itemsBackwardsCursor: null, turnsBackwardsCursor: null });
      send({ method: 'thread/reverted', params: { threadId: p.threadId } });
      return;
    }
    case 'thread/fork': {
      const source = threads.get(p.threadId);
      const result = clone(samples.threadStart);
      result.thread.id = 'fixture_' + randomUUID();
      result.thread.cwd = source.root;
      result.cwd = source.root;
      const turns = [...source.turns.entries()];
      const boundary = p.lastTurnId
        ? turns.findIndex(([id]) => id === p.lastTurnId)
        : turns.length - 1;
      if (p.lastTurnId && boundary < 0) {
        send({ id: m.id, error: { code: -1, message: 'Unknown fork boundary' } });
        return;
      }
      result.thread.forkedFromId = p.threadId;
      threads.set(result.thread.id, {
        root: source.root,
        turns: new Map(turns.slice(0, boundary + 1)),
      });
      respond(result);
      return;
    }
    case 'thread/read': {
      const result = clone(samples.threadStart);
      result.thread.id = p.threadId;
      result.thread.cwd = threads.get(p.threadId)?.root ?? result.thread.cwd;
      const goalState = threads.get(p.threadId)?.name;
      if (goalState?.startsWith('GOAL_UNLOADED')) result.thread.status = { type: 'notLoaded' };
      if (goalState === 'GOAL_ACTIVE') result.thread.status = { type: 'active', activeFlags: [] };
      if (goalState === 'GOAL_SYSTEM_ERROR') result.thread.status = { type: 'systemError' };
      if (goalState === 'GOAL_ACTIVITY_RACE') {
        const current = threads.get(p.threadId);
        current.reads = (current.reads ?? 0) + 1;
        if (current.reads >= 4) result.thread.status = { type: 'active', activeFlags: [] };
      }
      if (threads.get(p.threadId)?.name === 'INDEX_DUPLICATE')
        result.thread.name = 'authoritative title';
      result.thread.turns = [];
      if (p.includeTurns && threads.get(p.threadId)?.name === 'FRESH_FALSE_EMPTY')
        result.thread.turns = [clone(samples.turnStart.turn)];
      if (p.includeTurns && threads.get(p.threadId)?.name === 'FRESH_WRONG_WORKSPACE')
        result.thread.cwd = join(result.thread.cwd, '..');
      respond({ thread: result.thread });
      return;
    }
    case 'thread/items/list': {
      const thread = threads.get(p.threadId);
      if (thread?.name?.startsWith('FRESH_') && !thread.turns.size) {
        send({
          id: m.id,
          error: {
            code: -1,
            message: `invalid paginated history lineage for ${p.threadId}: missing source rollout`,
          },
        });
        return;
      }
      if (thread?.name?.startsWith('HISTORY_IMAGE')) {
        const path = join(
          thread.root,
          thread.name === 'HISTORY_IMAGE_OUTSIDE' ? '../outside.png' : 'image.png',
        );
        respond({
          data: [{ turnId: 'image-turn', item: { type: 'imageView', id: 'image-item', path } }],
          nextCursor: null,
        });
        return;
      }
      if (thread?.name?.startsWith('REVISION_')) {
        const entries = [...thread.turns.keys()].map((id) => ({
          turnId: id,
          item: { type: 'userMessage', id: 'user-' + id, content: thread.inputs?.get(id) ?? [] },
        }));
        if (p.sortDirection === 'desc') entries.reverse();
        respond({ data: entries, nextCursor: null });
        return;
      }
      const large = thread?.name === 'HISTORY_LARGE';
      const text = large ? '完整历史😀'.repeat(90000) : '完整历史消息';
      const entries = [
        {
          turnId: 'persisted-turn',
          item: {
            type: 'userMessage',
            id: 'user-history',
            content: [{ type: 'text', text: '原始问题', text_elements: [] }],
          },
        },
        { turnId: 'persisted-turn', item: { type: 'agentMessage', id: 'answer-history', text } },
      ];
      if (p.sortDirection === 'desc') entries.reverse();
      const offset = p.cursor ? Number(p.cursor) : 0;
      const data = entries.slice(offset, offset + (p.limit ?? 20));
      const next = offset + data.length;
      respond({ data, nextCursor: next < entries.length ? String(next) : null });
      return;
    }
    case 'thread/turns/list':
      if (
        threads.get(p.threadId)?.name?.startsWith('FRESH_') &&
        !threads.get(p.threadId).turns.size
      ) {
        send({
          id: m.id,
          error: {
            code: -1,
            message: `invalid paginated history lineage for ${p.threadId}: missing source rollout`,
          },
        });
        return;
      }
      respond({
        data: [...(threads.get(p.threadId)?.turns.values() ?? [])]
          .reverse()
          .slice(0, p.limit ?? 100),
        nextCursor: null,
        backwardsCursor: null,
      });
      return;
    case 'thread/compact/start': {
      const thread = threads.get(p.threadId);
      thread.compactions = (thread.compactions ?? 0) + 1;
      respond({});
      return;
    }
    case 'thread/goal/get':
      respond({ goal: threads.get(p.threadId)?.goal ?? null });
      return;
    case 'thread/goal/clear': {
      const current = threads.get(p.threadId);
      const cleared = !!current?.goal;
      if (current) delete current.goal;
      respond({ cleared });
      return;
    }
    case 'thread/goal/set': {
      const current = threads.get(p.threadId);
      const now = Date.now();
      current.goal = {
        ...(current.goal ?? { createdAt: now, objective: '', tokensUsed: 0, timeUsedSeconds: 0 }),
        ...p,
        updatedAt: now,
      };
      respond({ goal: current.goal });
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
      const source = threads.get(p.threadId);
      if (source.name?.startsWith('REVISION_')) {
        if (
          text === 'CHECK_REVISION_RESOURCES' &&
          (p.input.length !== 2 ||
            p.input[1].type !== 'localImage' ||
            p.input[1].path !== source.revisionImage)
        ) {
          send({ id: m.id, error: { code: -1, message: 'Original resource was not preserved' } });
          return;
        }
        source.inputs ??= new Map();
        source.inputs.set(turnId, clone(p.input));
        if (text !== 'CHECK_REVISION_RESOURCES')
          source.revisionImage = p.input.find((part) => part.type === 'localImage')?.path;
      }

      const expectedMode = text === 'CHECK_PLAN' ? 'plan' : 'default';
      if (text.startsWith('CHECK_COMPOSER') || text === 'CHECK_PLAN') {
        const valid =
          p.collaborationMode?.mode === expectedMode &&
          p.collaborationMode?.settings.model === 'fixture-model' &&
          (text !== 'CHECK_COMPOSER_FILES' ||
            (p.input[1]?.type === 'text' &&
              p.input[1].text.includes('notes.txt') &&
              p.input[2]?.type === 'localImage')) &&
          (text !== 'CHECK_COMPOSER_GOAL' || threads.get(p.threadId).goal?.status === 'active') &&
          (text !== 'CHECK_COMPOSER_PAUSE' || threads.get(p.threadId).goal?.status === 'paused');
        if (!valid) {
          send({ id: m.id, error: { code: -1, message: 'Composer options not forwarded' } });
          return;
        }
      }
      if (text.startsWith('CHECK_PERMISSION_')) {
        const full = text === 'CHECK_PERMISSION_FULL';
        if (
          p.approvalPolicy !== (full ? 'never' : 'on-request') ||
          p.sandboxPolicy?.type !== (full ? 'dangerFullAccess' : 'workspaceWrite') ||
          (!full &&
            (p.sandboxPolicy.networkAccess !== false ||
              !p.sandboxPolicy.excludeTmpdirEnvVar ||
              !p.sandboxPolicy.excludeSlashTmp))
        ) {
          send({ id: m.id, error: { code: -1, message: 'Permission policy not forwarded/reset' } });
          return;
        }
      }
      if (text === 'CHECK_MODEL' && (p.model !== 'fixture-model' || p.effort !== 'high')) {
        send({ id: m.id, error: { code: -1, message: 'Model/effort not forwarded' } });
        return;
      }
      threads.get(p.threadId).turns.set(turnId, clone(result.turn));
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
        pending.set(requestId, { threadId: p.threadId, turnId });
        send({
          id: requestId,
          method: 'item/tool/requestUserInput',
          params: {
            threadId: p.threadId,
            turnId,
            itemId: 'question',
            isBlocking: true,
            questions: [
              {
                id: 'approach',
                header: 'Approach',
                question: 'Which approach?',
                options: [
                  { label: 'A', description: 'First approach' },
                  { label: 'B', description: 'Second approach' },
                ],
              },
            ],
          },
        });
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
    case 'turn/steer': {
      const turn = threads.get(p.threadId)?.turns.get(p.expectedTurnId);
      if (
        !turn ||
        turn.status !== 'inProgress' ||
        !p.clientUserMessageId ||
        p.input?.[0]?.type !== 'text'
      ) {
        send({ id: m.id, error: { code: -32600, message: 'Active turn changed' } });
        return;
      }
      respond({
        turnId: p.input[0].text === 'STEER_BAD_ACK' ? 'mismatched-ack' : p.expectedTurnId,
      });
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

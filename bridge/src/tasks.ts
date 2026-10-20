import { realpath } from 'node:fs/promises';
import type { Session, Turn, Status } from '@agentdeck/protocol';
import type { ThreadStartResponse } from '../generated/codex/v2/ThreadStartResponse.js';
import type { ThreadResumeResponse } from '../generated/codex/v2/ThreadResumeResponse.js';
import type { TurnStartResponse } from '../generated/codex/v2/TurnStartResponse.js';
import type { TurnCompletedNotification } from '../generated/codex/v2/TurnCompletedNotification.js';
import type { ThreadTurnsListResponse } from '../generated/codex/v2/ThreadTurnsListResponse.js';
import { Store, uid, now } from './store.js';
import { ProjectRegistry, within } from './projects.js';
import { Supervisor } from './codex.js';
import { DeckError, invariant, safeError } from './errors.js';
import { validateContract } from './contracts.js';
import type { RpcMessage } from './rpc.js';

export class Tasks {
  private busy = new Set<string>();
  private early: RpcMessage[] = [];
  private loaded = new Set<string>();
  onTerminal: (sessionId: string, turnId: string) => void = () => {};
  constructor(
    readonly store: Store,
    readonly projects: ProjectRegistry,
    readonly upstream: Supervisor,
  ) {
    upstream.rpc.on('notification', (message: RpcMessage) => {
      try {
        this.notification(message);
      } catch (error) {
        this.store.append('bridge.error', {
          code: 'UPSTREAM_PROTOCOL_ERROR',
          message: safeError(error),
        });
        this.upstream.rpc.stop();
      }
    });
    upstream.onLost = () => this.lost();
    upstream.onReady = async () => {
      await this.reconcile();
      this.store.append('host.status', { status: 'connected' });
    };
  }
  private async workspacePolicy(root: string): Promise<void> {
    const result = (await this.upstream.rpc.request('config/read', {
      includeLayers: false,
      cwd: root,
    })) as { config: Record<string, unknown> };
    const config = result.config;
    invariant(
      config.default_permissions === 'agentdeck' && !config.sandbox_mode,
      'UNSAFE_UPSTREAM_CONFIG',
      'Legacy sandbox configuration would override workspace read isolation',
    );
    const profiles = config.permissions as Record<string, Record<string, unknown>> | undefined;
    const profile = profiles?.agentdeck;
    invariant(
      profile && profile.extends === ':workspace',
      'UNSAFE_UPSTREAM_CONFIG',
      'Required workspace permissions profile missing',
    );
    const filesystem = profile.filesystem as Record<string, unknown> | undefined;
    invariant(
      filesystem &&
        filesystem[':root'] === 'deny' &&
        filesystem[':minimal'] === 'read' &&
        filesystem[':tmpdir'] === 'deny' &&
        filesystem[':slash_tmp'] === 'deny' &&
        Object.keys(filesystem).every(
          (k) =>
            [':root', ':minimal', ':tmpdir', ':slash_tmp'].includes(k) ||
            (k === 'glob_scan_max_depth' && filesystem[k] === null),
        ),
      'UNSAFE_UPSTREAM_CONFIG',
      'Workspace permissions were broadened by configuration',
    );
    invariant(
      !profile.workspace_roots || Object.keys(profile.workspace_roots as object).length === 0,
      'UNSAFE_UPSTREAM_CONFIG',
      'Additional workspace roots are forbidden',
    );
    invariant(
      (profile.network as { enabled?: boolean } | undefined)?.enabled === false,
      'UNSAFE_UPSTREAM_CONFIG',
      'Command networking must start disabled',
    );
    const mcp = config.mcp_servers as Record<string, { enabled?: boolean }> | undefined;
    invariant(
      !mcp || Object.values(mcp).every((v) => v.enabled === false),
      'UNSAFE_UPSTREAM_CONFIG',
      'External MCP execution is outside AgentDeck v1',
    );
    const hooks = config.hooks as Record<string, unknown> | undefined;
    invariant(
      !hooks ||
        Object.values(hooks).every((v) => v === null || (Array.isArray(v) && v.length === 0)),
      'UNSAFE_UPSTREAM_CONFIG',
      'Configured hooks are outside AgentDeck v1',
    );
  }
  private async checkedSettings(
    result: ThreadStartResponse | ThreadResumeResponse,
    root: string,
  ): Promise<void> {
    invariant(
      (await realpath(result.cwd)).toLowerCase() === root.toLowerCase(),
      'WORKSPACE_FORBIDDEN',
      'Upstream selected an unexpected workspace',
    );
    invariant(
      (await realpath(result.thread.cwd)).toLowerCase() === root.toLowerCase(),
      'WORKSPACE_FORBIDDEN',
      'Thread workspace differs from authorized project',
    );
    invariant(
      result.approvalPolicy === 'on-request' &&
        result.approvalsReviewer === 'user' &&
        result.sandbox.type !== 'dangerFullAccess' &&
        result.sandbox.type !== 'externalSandbox',
      'UNSAFE_UPSTREAM_CONFIG',
      'Upstream did not apply required safety policy',
    );
    const sandbox = result.sandbox;
    if (sandbox.type === 'readOnly' || sandbox.type === 'workspaceWrite')
      invariant(
        !sandbox.networkAccess,
        'UNSAFE_UPSTREAM_CONFIG',
        'Upstream enabled network access without approval',
      );
    if (sandbox.type === 'workspaceWrite') {
      invariant(
        sandbox.excludeTmpdirEnvVar && sandbox.excludeSlashTmp,
        'UNSAFE_UPSTREAM_CONFIG',
        'Upstream broadened temporary directory access',
      );
      for (const path of sandbox.writableRoots)
        invariant(
          within(root, await realpath(path)),
          'WORKSPACE_FORBIDDEN',
          'Upstream writable root leaves authorized project',
        );
    }
    // A workspace-write response alone cannot establish read isolation. The dedicated startup probe is mandatory.
    invariant(
      this.store.meta('sandboxVerifiedVersion') === '0.159.2',
      'SANDBOX_UNVERIFIED',
      'Run the local sandbox boundary verification before starting tasks',
    );
  }
  async create(projectId: string, title: string): Promise<Session> {
    this.upstream.requireReady();
    const root = await this.projects.root(projectId);
    await this.workspacePolicy(root);
    const result = await this.upstream.rpc.request('thread/start', {
      cwd: root,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      config: { default_permissions: 'agentdeck' },
    });
    validateContract('v2/ThreadStartResponse', result);
    const response = result as ThreadStartResponse;
    await this.checkedSettings(response, root);
    const sessionId = uid('session');
    const ts = now();
    this.store.db
      .prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)')
      .run(sessionId, projectId, response.thread.id, title, 'idle', ts, ts);
    this.loaded.add(response.thread.id);
    const session = this.store.session(sessionId);
    this.store.append('session.updated', session, sessionId);
    return session;
  }
  async start(sessionId: string, text: string): Promise<Turn> {
    this.upstream.requireReady();
    const session = this.store.session(sessionId);
    invariant(
      !this.busy.has(sessionId) &&
        !this.store
          .turns(sessionId)
          .some((t) => ['queued', 'running', 'waitingApproval', 'unknown'].includes(t.status)),
      'CONFLICT',
      'Session has an active or unreconciled turn',
    );
    const activeSessions = new Set(
      this.store
        .turns()
        .filter((t) => ['queued', 'running', 'waitingApproval'].includes(t.status))
        .map((t) => t.sessionId),
    );
    for (const id of this.busy) activeSessions.add(id);
    invariant(activeSessions.size < 2, 'RATE_LIMITED', 'Two tasks are already active');
    this.busy.add(sessionId);
    let turnId: string | null = null;
    try {
      const root = await this.projects.root(session.projectId);
      await this.workspacePolicy(root);
      if (!this.loaded.has(session.upstreamThreadId)) {
        try {
          const resumed = await this.upstream.rpc.request('thread/resume', {
            threadId: session.upstreamThreadId,
            cwd: root,
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
            config: { default_permissions: 'agentdeck' },
            excludeTurns: true,
          });
          validateContract('v2/ThreadResumeResponse', resumed);
          await this.checkedSettings(resumed as ThreadResumeResponse, root);
        } catch (error) {
          // 0.159.2 does not persist a rollout until the first turn. Only an empty, never-run local session may be recreated.
          if (
            error instanceof DeckError &&
            error.code === 'UPSTREAM_ERROR' &&
            error.message.startsWith('no rollout found for thread id ') &&
            this.store.turns(sessionId).length === 0
          ) {
            const created = await this.upstream.rpc.request('thread/start', {
              cwd: root,
              approvalPolicy: 'on-request',
              approvalsReviewer: 'user',
              config: { default_permissions: 'agentdeck' },
            });
            validateContract('v2/ThreadStartResponse', created);
            const result = created as ThreadStartResponse;
            await this.checkedSettings(result, root);
            this.store.db
              .prepare('UPDATE sessions SET upstreamThreadId=? WHERE sessionId=?')
              .run(result.thread.id, sessionId);
            session.upstreamThreadId = result.thread.id;
          } else throw error;
        }
        this.loaded.add(session.upstreamThreadId);
      }
      turnId = uid('turn');
      this.store.db
        .prepare('INSERT INTO turns VALUES(?,?,NULL,?,?,NULL,NULL)')
        .run(turnId, sessionId, 'queued', now());
      this.store.setStatus(sessionId, turnId, 'queued');
      this.store.append('turn.queued', { turn: this.store.turn(turnId), text }, sessionId, turnId);
      const result = await this.upstream.rpc.request('turn/start', {
        threadId: session.upstreamThreadId,
        input: [{ type: 'text', text, text_elements: [] }],
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      });
      validateContract('v2/TurnStartResponse', result);
      const response = result as TurnStartResponse;
      this.store.db
        .prepare('UPDATE turns SET upstreamTurnId=? WHERE turnId=? AND upstreamTurnId IS NULL')
        .run(response.turn.id, turnId);
      const current = this.store.turn(turnId);
      if (current.status === 'queued') {
        this.store.setStatus(sessionId, turnId, 'running');
        this.store.append('turn.started', { turn: this.store.turn(turnId) }, sessionId, turnId);
      }
      this.drainEarly();
      return this.store.turn(turnId);
    } catch (error) {
      if (turnId) {
        this.store.setStatus(sessionId, turnId, 'unknown', safeError(error));
        this.store.append(
          'session.updated',
          { status: 'unknown', error: safeError(error) },
          sessionId,
          turnId,
        );
      }
      throw error;
    } finally {
      this.busy.delete(sessionId);
    }
  }
  async interrupt(
    sessionId: string,
    turnId: string,
  ): Promise<{ requested: boolean; status: string }> {
    this.upstream.requireReady();
    const session = this.store.session(sessionId);
    const turn = this.store.turn(turnId);
    invariant(
      turn.sessionId === sessionId &&
        turn.upstreamTurnId &&
        ['running', 'waitingApproval', 'unknown'].includes(turn.status),
      'CONFLICT',
      'Turn is not active in this session',
    );
    this.store.append('turn.interruptRequested', {}, sessionId, turnId);
    for (let attempt = 0; attempt < 30; attempt++) {
      const current = this.store.turn(turnId);
      if (['completed', 'failed', 'interrupted'].includes(current.status))
        return { requested: false, status: current.status };
      try {
        await this.upstream.rpc.request('turn/interrupt', {
          threadId: session.upstreamThreadId,
          turnId: turn.upstreamTurnId,
        });
        return { requested: true, status: this.store.turn(turnId).status };
      } catch (error) {
        if (
          !(error instanceof DeckError) ||
          error.code !== 'UPSTREAM_ERROR' ||
          error.message !== 'no active turn to interrupt'
        )
          throw error;
        if (attempt === 29)
          throw new DeckError(
            'UPSTREAM_TIMEOUT',
            'Turn has not become interruptible; execution state remains unconfirmed',
            true,
          );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new DeckError('UPSTREAM_TIMEOUT', 'Interruption was not confirmed');
  }
  route(threadId: string, upstreamTurnId?: string): { session: Session; turn: Turn | null } | null {
    const session = this.store.db
      .prepare('SELECT * FROM sessions WHERE upstreamThreadId=?')
      .get(threadId) as Session | undefined;
    if (!session) return null;
    const turn = upstreamTurnId
      ? (this.store.db
          .prepare('SELECT * FROM turns WHERE sessionId=? AND upstreamTurnId=?')
          .get(session.sessionId, upstreamTurnId) as Turn | undefined)
      : undefined;
    return { session, turn: turn ?? null };
  }
  private notification(message: RpcMessage, buffered = false): void {
    if (!message.params || typeof message.params !== 'object') return;
    const params = message.params as Record<string, unknown>;
    const contracts: Record<string, string> = {
      'turn/started': 'TurnStarted',
      'turn/completed': 'TurnCompleted',
      'turn/plan/updated': 'TurnPlanUpdated',
      'turn/diff/updated': 'TurnDiffUpdated',
      'item/started': 'ItemStarted',
      'item/completed': 'ItemCompleted',
      'item/agentMessage/delta': 'AgentMessageDelta',
      'item/plan/delta': 'PlanDelta',
      'item/commandExecution/outputDelta': 'CommandExecutionOutputDelta',
      'item/fileChange/outputDelta': 'FileChangeOutputDelta',
      'item/fileChange/patchUpdated': 'FileChangePatchUpdated',
      'item/mcpToolCall/progress': 'McpToolCallProgress',
      error: 'Error',
    };
    const contract = contracts[message.method ?? ''];
    if (contract) validateContract(`v2/${contract}Notification`, params);
    if (typeof params.threadId !== 'string') return;
    const route = this.route(
      params.threadId,
      typeof params.turnId === 'string'
        ? params.turnId
        : typeof (params.turn as { id?: unknown } | undefined)?.id === 'string'
          ? (params.turn as { id: string }).id
          : undefined,
    );
    if (!route) {
      if (!buffered && this.early.length < 128) this.early.push(message);
      return;
    }
    let turn = route.turn;
    if (
      !turn &&
      params.turn &&
      typeof params.turn === 'object' &&
      typeof (params.turn as { id?: unknown }).id === 'string'
    ) {
      const queued = this.store
        .turns(route.session.sessionId)
        .find((t) => t.status === 'queued' && !t.upstreamTurnId);
      if (queued) {
        this.store.db
          .prepare('UPDATE turns SET upstreamTurnId=? WHERE turnId=?')
          .run((params.turn as { id: string }).id, queued.turnId);
        turn = this.store.turn(queued.turnId);
      }
    }
    if (message.method === 'turn/completed') {
      validateContract('v2/TurnCompletedNotification', params);
      const completed = params as unknown as TurnCompletedNotification;
      if (!turn) {
        if (!buffered && this.early.length < 128) this.early.push(message);
        return;
      }
      invariant(
        ['completed', 'failed', 'interrupted'].includes(completed.turn.status),
        'UPSTREAM_PROTOCOL_ERROR',
        'Invalid terminal status',
      );
      if (['completed', 'failed', 'interrupted'].includes(turn.status)) return;
      const status = completed.turn.status as Status;
      this.store.setStatus(
        route.session.sessionId,
        turn.turnId,
        status,
        completed.turn.error?.message ?? null,
      );
      this.onTerminal(route.session.sessionId, turn.turnId);
      this.store.append(
        `turn.${status}`,
        { turn: this.store.turn(turn.turnId), upstream: completed.turn },
        route.session.sessionId,
        turn.turnId,
      );
      return;
    }
    if (message.method === 'turn/started' && turn?.status === 'queued')
      this.store.setStatus(route.session.sessionId, turn.turnId, 'running');
    const known = new Set([
      'turn/started',
      'turn/plan/updated',
      'turn/diff/updated',
      'item/started',
      'item/completed',
      'item/agentMessage/delta',
      'item/plan/delta',
      'item/commandExecution/outputDelta',
      'item/fileChange/outputDelta',
      'item/fileChange/patchUpdated',
      'item/mcpToolCall/progress',
      'error',
    ]);
    if (known.has(message.method ?? ''))
      this.store.append(
        'turn.progress',
        { method: message.method, ...params },
        route.session.sessionId,
        turn?.turnId ?? null,
      );
  }
  private drainEarly(): void {
    const early = this.early;
    this.early = [];
    for (const message of early) this.notification(message, true);
  }
  lost(): void {
    this.loaded.clear();
    for (const turn of this.store
      .turns()
      .filter((t) => ['running', 'queued', 'waitingApproval'].includes(t.status))) {
      this.store.setStatus(turn.sessionId, turn.turnId, 'unknown');
      this.store.append('session.updated', { status: 'unknown' }, turn.sessionId, turn.turnId);
    }
    this.store.append('host.status', { status: 'disconnected' });
  }
  async reconcile(): Promise<void> {
    for (const turn of this.store
      .turns()
      .filter((t) => t.status === 'unknown' && t.upstreamTurnId)) {
      try {
        const session = this.store.session(turn.sessionId);
        const root = await this.projects.root(session.projectId);
        const read = await this.upstream.rpc.request('thread/read', {
          threadId: session.upstreamThreadId,
          includeTurns: false,
        });
        validateContract('v2/ThreadReadResponse', read);
        let cursor: string | undefined;
        for (let page = 0; page < 100; page++) {
          const result = await this.upstream.rpc.request('thread/turns/list', {
            threadId: session.upstreamThreadId,
            cursor,
            limit: 100,
            itemsView: 'summary',
          });
          validateContract('v2/ThreadTurnsListResponse', result);
          const response = result as ThreadTurnsListResponse;
          const found = response.data.find((t) => t.id === turn.upstreamTurnId);
          if (found) {
            if (['completed', 'failed', 'interrupted'].includes(found.status))
              this.notification({
                method: 'turn/completed',
                params: { threadId: session.upstreamThreadId, turn: found },
              });
            break;
          }
          if (!response.nextCursor) break;
          cursor = response.nextCursor;
        }
        void root;
      } catch (error) {
        if (!(error instanceof DeckError)) throw error;
      }
    }
  }
}

import type { RequestId } from '../generated/codex/RequestId.js';
import type { PermissionsRequestApprovalParams } from '../generated/codex/v2/PermissionsRequestApprovalParams.js';
import { realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import { within } from './projects.js';
import { Store, uid, now } from './store.js';
import { Tasks } from './tasks.js';
import { validateContract } from './contracts.js';
import { invariant, safeError } from './errors.js';
import type { RpcMessage } from './rpc.js';
import {
  APPROVAL_METHODS as METHODS,
  approvalChoices,
  commandDecision,
} from './approval-contract.js';

export class Approvals {
  private timer: NodeJS.Timeout;
  constructor(
    private readonly store: Store,
    private readonly tasks: Tasks,
  ) {
    tasks.upstream.rpc.on('request', (message: RpcMessage) => void this.receive(message));
    tasks.upstream.rpc.on('notification', (message: RpcMessage) => {
      if (
        message.method === 'serverRequest/resolved' &&
        message.params &&
        typeof message.params === 'object'
      ) {
        const p = message.params as { threadId: string; requestId: RequestId };
        const route = tasks.route(p.threadId);
        if (!route) return;
        const row = store.db
          .prepare(
            "SELECT * FROM approvals WHERE generation=? AND upstreamRequestJson=? AND sessionId=? AND status IN ('pending','sending')",
          )
          .get(tasks.upstream.generation, JSON.stringify(p.requestId), route.session.sessionId) as
          | Record<string, unknown>
          | undefined;
        if (row) this.finish(row, 'resolved');
      }
    });
    tasks.upstream.rpc.on('exit', () => this.invalidate('expired', false));
    tasks.onTerminal = (sessionId, turnId) => {
      for (const row of store.approvalRows(sessionId).filter((r) => r.turnId === turnId))
        this.finish(row, 'expired');
    };
    this.timer = setInterval(() => {
      for (const row of store
        .approvalRows()
        .filter((r) => Date.parse(String(r.expiresAt)) <= Date.now()))
        this.deny(row, 'expired');
    }, 1000);
    this.timer.unref();
  }
  private async receive(message: RpcMessage): Promise<void> {
    if (message.id === undefined) return;
    try {
      const base = METHODS[message.method ?? ''];
      invariant(base, 'UPSTREAM_UNSUPPORTED_REQUEST', 'Unsupported upstream request');
      invariant(
        Buffer.byteLength(JSON.stringify(message.params)) <= 128 * 1024,
        'UPSTREAM_PROTOCOL_ERROR',
        'Approval context exceeds review limit',
      );
      validateContract(`${base}Params`, message.params);
      approvalChoices(message.method!, message.params);
      const params = message.params as {
        threadId: string;
        turnId: string;
        cwd?: string;
        grantRoot?: string;
      };
      let route = this.tasks.route(params.threadId, params.turnId);
      // A request can arrive before turn/start's response; bind only the one pending local turn.
      if (route && !route.turn) {
        const queued = this.store
          .turns(route.session.sessionId)
          .find((t) => t.status === 'queued' && !t.upstreamTurnId);
        if (queued) {
          this.store.db
            .prepare('UPDATE turns SET upstreamTurnId=? WHERE turnId=?')
            .run(params.turnId, queued.turnId);
          route = this.tasks.route(params.threadId, params.turnId);
        }
      }
      invariant(
        route?.turn && ['queued', 'running', 'waitingApproval'].includes(route.turn.status),
        'APPROVAL_STALE',
        'Approval has no active local turn',
      );
      await this.tasks.projects.root(route.session.projectId);
      const approvalId = uid('approval');
      const expiresAt = new Date(Date.now() + 300000).toISOString();
      this.store.db
        .prepare('INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?,?,NULL)')
        .run(
          approvalId,
          route.session.sessionId,
          route.turn.turnId,
          message.method,
          'pending',
          JSON.stringify(message.params),
          JSON.stringify(message.id),
          this.tasks.upstream.generation,
          now(),
          expiresAt,
        );
      this.store.setStatus(route.session.sessionId, route.turn.turnId, 'waitingApproval');
      const row = this.store.db
        .prepare('SELECT * FROM approvals WHERE approvalId=?')
        .get(approvalId) as Record<string, unknown>;
      this.store.append(
        'approval.requested',
        this.store.publicApproval(row),
        route.session.sessionId,
        route.turn.turnId,
      );
    } catch (error) {
      try {
        this.tasks.upstream.rpc.reject(message.id);
      } catch {
        /* transport closed; no approval sent */
      }
      this.store.append('bridge.error', {
        code: 'UPSTREAM_UNSUPPORTED_REQUEST',
        message: safeError(error),
      });
      const params = message.params as { threadId?: string; turnId?: string } | undefined;
      const route = params?.threadId ? this.tasks.route(params.threadId, params.turnId) : null;
      if (route?.turn)
        void this.tasks.interrupt(route.session.sessionId, route.turn.turnId).catch(() => {});
    }
  }
  private response(
    method: string,
    decision: 'approve' | 'reject' | 'cancel',
    context: unknown,
  ): object {
    if (method === 'item/permissions/requestApproval') {
      const params = context as PermissionsRequestApprovalParams;
      return {
        permissions:
          decision === 'approve'
            ? {
                ...(params.permissions.fileSystem
                  ? { fileSystem: params.permissions.fileSystem }
                  : {}),
                ...(params.permissions.network ? { network: params.permissions.network } : {}),
              }
            : {},
        scope: 'turn',
      };
    }
    return commandDecision(method, decision, context);
  }
  async decide(
    sessionId: string,
    turnId: string,
    approvalId: string,
    decision: 'approve' | 'reject' | 'cancel',
  ): Promise<{ status: string }> {
    this.tasks.upstream.requireReady();
    const session = this.store.session(sessionId);
    const turn = this.store.turn(turnId);
    const row = this.store.db
      .prepare('SELECT * FROM approvals WHERE approvalId=?')
      .get(approvalId) as Record<string, unknown> | undefined;
    invariant(
      row && row.sessionId === sessionId && row.turnId === turnId && turn.sessionId === sessionId,
      'APPROVAL_STALE',
      'Approval does not match this session and turn',
    );
    invariant(
      row.status === 'pending' &&
        row.generation === this.tasks.upstream.generation &&
        Date.parse(String(row.expiresAt)) > Date.now() &&
        ['running', 'waitingApproval'].includes(turn.status),
      'APPROVAL_STALE',
      'Approval is expired or already handled',
    );
    const context = JSON.parse(String(row.contextJson)) as Record<string, unknown>;
    if (decision === 'approve') {
      const root = await this.tasks.projects.root(session.projectId);
      if (typeof context.cwd === 'string')
        invariant(
          within(root, await realpath(context.cwd)),
          'WORKSPACE_FORBIDDEN',
          'Approval cwd leaves authorized workspace',
        );
      invariant(
        !context.grantRoot ||
          (typeof context.grantRoot === 'string' &&
            (await realpath(context.grantRoot)).toLowerCase() === root.toLowerCase()),
        'WORKSPACE_FORBIDDEN',
        'Approval would broaden workspace access',
      );
      if (row.method === 'item/permissions/requestApproval') {
        const permissions = (context as unknown as PermissionsRequestApprovalParams).permissions;
        const fs = permissions.fileSystem;
        // v1 only grants explicit paths already inside this project; globs/special roots cannot be broadened remotely.
        for (const path of [
          ...(fs?.read ?? []),
          ...(fs?.write ?? []),
          ...(fs?.entries ?? []).map((e) => (e.path.type === 'path' ? e.path.path : '')),
        ]) {
          invariant(
            path && within(root, path),
            'WORKSPACE_FORBIDDEN',
            'Permission request leaves authorized workspace',
          );
          if (path !== root)
            await this.tasks.projects.file(session.projectId, relative(root, path));
        }
      }
    }
    const response = this.response(String(row.method), decision, context);
    validateContract(`${METHODS[String(row.method)]}Response`, response);
    const changes = this.store.db
      .prepare("UPDATE approvals SET status='sending' WHERE approvalId=? AND status='pending'")
      .run(approvalId).changes;
    invariant(changes === 1, 'APPROVAL_STALE', 'Approval already claimed');
    try {
      this.tasks.upstream.rpc.respond(
        JSON.parse(String(row.upstreamRequestJson)) as RequestId,
        response,
      );
    } catch {
      this.finish(row, 'unknown');
      throw new Error('Approval delivery outcome unknown; do not retry');
    }
    this.finish(
      row,
      decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'cancelled',
    );
    return { status: decision === 'approve' ? 'approved' : 'rejected' };
  }
  private finish(row: Record<string, unknown>, status: string): void {
    this.store.db
      .prepare('UPDATE approvals SET status=?,resolvedAt=? WHERE approvalId=?')
      .run(status, now(), row.approvalId);
    const turn = this.store.turn(String(row.turnId));
    if (
      turn.status === 'waitingApproval' &&
      !this.store.approvalRows(turn.sessionId).some((r) => r.turnId === turn.turnId)
    )
      this.store.setStatus(turn.sessionId, turn.turnId, 'running');
    this.store.append(
      'approval.resolved',
      { approvalId: row.approvalId, status },
      String(row.sessionId),
      String(row.turnId),
    );
  }
  private deny(row: Record<string, unknown>, status: string): void {
    if (row.status === 'pending' && row.generation === this.tasks.upstream.generation) {
      const claimed = this.store.db
        .prepare("UPDATE approvals SET status='sending' WHERE approvalId=? AND status='pending'")
        .run(row.approvalId).changes;
      if (claimed) {
        try {
          this.tasks.upstream.rpc.respond(
            JSON.parse(String(row.upstreamRequestJson)) as RequestId,
            this.response(String(row.method), 'reject', JSON.parse(String(row.contextJson))),
          );
        } catch {
          try {
            this.tasks.upstream.rpc.reject(
              JSON.parse(String(row.upstreamRequestJson)) as RequestId,
            );
          } catch {
            /* fail closed */
          }
        }
      }
    }
    this.finish(row, status);
  }
  invalidate(status = 'expired', sendDenial = true): void {
    for (const row of this.store.approvalRows()) {
      if (sendDenial) this.deny(row, status);
      else this.finish(row, status);
    }
  }
  close(): void {
    clearInterval(this.timer);
  }
}

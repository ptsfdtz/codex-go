import { t } from '../i18n';
import { exclusive } from '../coordination';
import { HostSocket } from './host';
import type { HostGrant } from '../host-book';

export type Packet = {
  eventId?: string;
  seq?: number;
  type?: string;
  id?: string;
  action?: string;
  sessionId?: string;
  turnId?: string;
  payload?: Record<string, unknown>;
  code?: string;
  message?: string;
  requestId?: string;
};
export type ReceiptCheck = {
  requestId: string;
  status: 'done' | 'pending' | 'unknown' | 'notFound' | 'unavailable';
  response?: Packet;
  message?: string;
};
// Older Hosts can return these failures without OUTCOME_UNKNOWN even after
// delivering a mutation upstream. Never mistake them for definite rejection.
function ambiguousError(code = '') {
  return (
    code === 'OUTCOME_UNKNOWN' ||
    /_(TIMEOUT|UNAVAILABLE|PROTOCOL_ERROR)$/.test(code) ||
    code === 'DATABASE_ERROR' ||
    code === 'IO_ERROR'
  );
}
function settled(packet: Packet) {
  return packet.type === 'response' || (packet.type === 'error' && !ambiguousError(packet.code));
}
export class Bridge {
  private socket?: HostSocket;
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private events: ((value: Packet) => void)[] = [];
  private closed = false;
  private hostId = '';
  private receiptsFound: Packet[] = [];
  private mutations = new Set<string>();
  private probing?: Promise<void>;
  get awaitingReceipt() {
    try {
      // A request still awaiting its response on this live connection is in
      // flight, not an unknown outcome. Keep its reservation in storage so
      // another tab still cannot submit a competing mutation.
      return this.receipts().some((id) => !this.pending.has(id));
    } catch {
      return true;
    }
  }
  constructor(private readonly scope: string) {}
  private readonly mutationActions = new Set([
    'system.updateInstall',
    'system.updateApply',
    'system.updateCancel',
    'sessions.create',
    'turn.start',
    'turn.steer',
    'turn.interruptActive',
    'turn.interrupt',
    'approvals.decide',
    'sessions.rename',
    'sessions.pin',
    'sessions.fork',
    'sessions.compact',
    'sessions.revert',
    'sessions.revise',
    'sessions.archive',
    'sessions.restore',
    'sessions.delete',
    'sessions.goal.resume',
    'sessions.goal.clear',
    'sessions.goal.edit',
    'queue.add',
    'queue.update',
    'queue.start',
    'queue.steer',
    'queue.delete',
    'queue.reorder',
    'skills.setEnabled',
    'settings.modelDefaults',
    'settings.outputDefaults',
    'settings.update',
    'projects.add',
    'projects.remove',
    'devices.revokeSelf',
  ]);
  async connect(grant: HostGrant) {
    this.hostId = grant.hostId;
    this.socket = await HostSocket.connect(
      grant.hostId,
      grant.fingerprint,
      grant.credential,
      grant.endpoints,
    );
    if (this.closed) {
      this.socket.close();
      throw new Error('Connection cancelled');
    }
    void this.socket.receive(
      (text) => {
        const packet = JSON.parse(text) as Packet;
        const request = packet.id ? this.pending.get(packet.id) : undefined;
        if (request) {
          clearTimeout(request.timer);
          this.pending.delete(packet.id!);
          if (settled(packet)) {
            try {
              if (this.mutations.has(packet.id!)) this.clearReceipt(packet.id!);
            } catch {
              /* Deliver the response; retain the receipt until it can be reconciled. */
            }
          }
          if (packet.type === 'error')
            request.reject(
              new Error(`${packet.code || 'ERROR'}: ${packet.message || 'Host request failed'}`),
            );
          else if (packet.type === 'response') request.resolve(packet.payload);
          else {
            request.reject(new Error('Invalid host response'));
            this.close();
          }
        } else {
          if (packet.id && this.mutations.has(packet.id)) {
            // A response may arrive after its request deadline. Settle the
            // original reservation without resending or changing its draft.
            if (settled(packet)) {
              try {
                this.clearReceipt(packet.id);
              } catch {
                /* Preserve the reservation if storage cannot be updated. */
              }
            }
            this.events.forEach((handler) =>
              handler({
                type: 'receipt',
                requestId: packet.id,
                payload: { status: settled(packet) ? 'done' : 'unknown', response: packet },
              }),
            );
          }
          this.events.forEach((handler) => handler(packet));
        }
      },
      (error) => this.fail(error),
    );
    const hello = await this.request<{ hostId: string }>('system.hello', {
      client: 'AgentDeck Web/0.3.0',
      version: 1,
    });
    if (hello.hostId !== grant.hostId) {
      this.close();
      throw new Error('Host identity mismatch');
    }
    await this.reconcile();
  }
  onEvent(handler: (value: Packet) => void) {
    this.events.push(handler);
    for (const packet of this.receiptsFound.splice(0)) handler(packet);
    return () => {
      this.events = this.events.filter((item) => item !== handler);
    };
  }
  request<T = unknown>(action: string, payload: unknown = {}): Promise<T> {
    if (this.mutationActions.has(action))
      return exclusive(this.receiptKey(), () => this.sendRequest<T>(action, payload));
    return this.sendRequest<T>(action, payload);
  }
  // Resume and heartbeat events share one bounded, read-only liveness check.
  // A suspended socket may remain OPEN even though its network route is gone.
  probe(): Promise<void> {
    if (this.probing) return this.probing;
    this.probing = this.sendRequest<{ hostId: string }>(
      'system.hello',
      { client: 'AgentDeck Web/0.3.0', version: 1 },
      5000,
    )
      .then((hello) => {
        if (hello.hostId !== this.hostId) {
          this.close();
          throw new Error('Host identity mismatch');
        }
      })
      .finally(() => {
        this.probing = undefined;
      });
    return this.probing;
  }
  private sendRequest<T>(
    action: string,
    payload: unknown,
    timeout = action.startsWith('sessions.history') || this.mutationActions.has(action)
      ? 90000
      : 30000,
  ): Promise<T> {
    if (!this.socket || this.closed) return Promise.reject(new Error('Host disconnected'));
    const id = `web-${crypto.randomUUID()}`;
    if (this.mutationActions.has(action)) {
      try {
        const pending = this.receipts();
        if (pending.length)
          return Promise.reject(new Error(t('上一条操作结果尚未确定，请重连核对后再操作')));
        pending.push(id);
        this.saveReceipts(pending);
        this.mutations.add(id);
      } catch {
        return Promise.reject(new Error(t('无法保存操作回执；请允许浏览器存储后重试')));
      }
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            this.mutationActions.has(action)
              ? 'Host request timed out; outcome may be unknown. Reconcile before retrying.'
              : 'Host read timed out; retry this read when the computer is ready.',
          ),
        );
        // A slow history/model read is not evidence of a dead connection.
        // Only the independent, bounded hello probe can close a stale route.
        if (action === 'system.hello') this.fail(new Error('Host liveness check timed out'));
        else void this.probe().catch(() => this.close());
      }, timeout);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      void this.socket!.send(JSON.stringify({ v: 1, type: 'request', id, action, payload })).catch(
        (error) => this.fail(error instanceof Error ? error : new Error('Host send failed')),
      );
    });
  }
  private receiptKey() {
    return `agentdeck.web.receipts.${this.scope}.${this.hostId}`;
  }
  private receipts(): string[] {
    const value: unknown = JSON.parse(localStorage.getItem(this.receiptKey()) || '[]');
    if (!Array.isArray(value) || !value.every((id) => typeof id === 'string'))
      throw new Error(t('无法读取操作回执，请先核对电脑上的操作状态'));
    return value;
  }
  private saveReceipts(value: string[]) {
    if (value.length) localStorage.setItem(this.receiptKey(), JSON.stringify(value));
    else localStorage.removeItem(this.receiptKey());
  }
  private clearReceipt(id: string) {
    const next = this.receipts().filter((value) => value !== id);
    this.saveReceipts(next);
  }
  async reconcile() {
    return exclusive(this.receiptKey(), () => this.reconcileReceipts());
  }
  private async reconcileReceipts(): Promise<ReceiptCheck[]> {
    const checks: ReceiptCheck[] = [];
    for (const id of this.receipts()) {
      try {
        const status = await this.request<{ status?: string; response?: Packet }>(
          'requests.status',
          { requestId: id },
        );
        if (status.status === 'done' && status.response?.id === id && settled(status.response))
          this.clearReceipt(id);
        const result: ReceiptCheck = {
          requestId: id,
          status:
            status.status === 'done' && status.response?.id === id && settled(status.response)
              ? 'done'
              : status.status === 'pending' ||
                  status.status === 'unknown' ||
                  status.status === 'notFound'
                ? status.status
                : 'unavailable',
          response: status.response,
        };
        checks.push(result);
        const packet = { type: 'receipt', requestId: id, payload: status } satisfies Packet;
        if (this.events.length) this.events.forEach((handler) => handler(packet));
        else this.receiptsFound.push(packet);
      } catch (error) {
        checks.push({ requestId: id, status: 'unavailable', message: String(error) });
      }
    }
    return checks;
  }
  async acknowledgeReceipts(reviewedIds: string[]): Promise<void> {
    return exclusive(this.receiptKey(), async () => {
      const reviewed = new Set(reviewedIds);
      if (this.closed || this.receipts().some((id) => !reviewed.has(id)))
        throw new Error(t('操作回执或连接已变化，请重新核对。'));
      const checks = await this.reconcileReceipts();
      if (checks.some((check) => !['done', 'unknown', 'notFound'].includes(check.status)))
        throw new Error(t('操作仍在处理或核对失败，暂时不能恢复编辑。'));
      // Prove the authenticated Host is readable now. A user acknowledgement
      // releases only the browser reservation, never the Host idempotency row.
      await this.request('snapshot.get');
      if (this.closed) throw new Error(t('操作回执或连接已变化，请重新核对。'));
      for (const check of checks)
        if (check.status === 'unknown' || check.status === 'notFound')
          this.clearReceipt(check.requestId);
      this.events.forEach((handler) =>
        handler({ type: 'receipt', payload: { status: 'reviewed' } }),
      );
    });
  }
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    this.socket?.close();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.events.forEach((handler) => handler({ type: 'closed', message: error.message }));
  }
  close() {
    this.fail(new Error('Host connection closed'));
  }
}

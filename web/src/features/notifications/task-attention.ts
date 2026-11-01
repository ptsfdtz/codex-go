import { t } from '../../i18n';
import type { Packet } from '../../transport/bridge';
import type { Turn } from '../../workspace';

export type AttentionKind = 'completed' | 'failed' | 'interrupted' | 'question' | 'approval';
export type TaskNotice = { id: string; sessionId: string; kind: AttentionKind };
export type AttentionState = { unread: Record<string, AttentionKind>; notices: TaskNotice[] };
export const attentionLabels: Record<AttentionKind, string> = {
  get completed() {
    return t('任务已完成');
  },
  get failed() {
    return t('任务执行失败');
  },
  get interrupted() {
    return t('任务已停止');
  },
  get question() {
    return t('需要你的回答');
  },
  get approval() {
    return t('需要你的审批');
  },
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const strings = (...values: unknown[]) =>
  values.filter((v): v is string => typeof v === 'string' && !!v);

export function packetNotice(packet: Packet, turns: Turn[] = []) {
  if (!packet.sessionId) return;
  const payload = packet.payload || {},
    turn = record(payload.turn),
    upstream = record(payload.upstream);
  const sessionId = packet.sessionId;
  if (
    /^(turn\.(completed|failed|interrupted)|upstream\.turn\.completed)$/.test(packet.action || '')
  ) {
    const ids = strings(
      payload.upstreamTurnId,
      turn.upstreamTurnId,
      upstream.id,
      packet.turnId,
      turn.turnId,
    );
    const local = turns.find(
      (t) =>
        t.sessionId === sessionId &&
        (ids.includes(t.turnId || '') || ids.includes(t.upstreamTurnId || '')),
    );
    ids.push(...strings(local?.turnId, local?.upstreamTurnId));
    if (!ids.length) ids.push(...strings(packet.eventId));
    if (!ids.length) return;
    const status = String(
      payload.status || turn.status || upstream.status || packet.action?.split('.').at(-1),
    );
    const kind: AttentionKind =
      status === 'failed' ? 'failed' : status === 'interrupted' ? 'interrupted' : 'completed';
    return {
      sessionId,
      kind,
      keys: [...new Set(ids)].map((id) => JSON.stringify([sessionId, 'turn', id])),
    };
  }
  if (packet.action === 'approval.requested') {
    const id = strings(payload.approvalId)[0];
    if (!id) return;
    return {
      sessionId,
      kind: (payload.method === 'item/tool/requestUserInput'
        ? 'question'
        : 'approval') as AttentionKind,
      keys: [JSON.stringify([sessionId, 'approval', id])],
    };
  }
  const item = record(payload.item);
  if (
    ['turn.progress', 'upstream.progress'].includes(packet.action || '') &&
    payload.method === 'item/completed' &&
    ['agentMessage', 'assistantMessage'].includes(String(item.type)) &&
    Array.isArray(item.questions) &&
    item.questions.some((q) => typeof record(q).title === 'string') &&
    typeof item.id === 'string'
  ) {
    return {
      sessionId,
      kind: 'question' as const,
      keys: [JSON.stringify([sessionId, 'question', item.id])],
    };
  }
}

// Only identities and unread kinds are persisted, never question or message contents.
export class TaskAttention {
  private seen = new Set<string>();
  private listeners = new Set<() => void>();
  private state: AttentionState = { unread: {}, notices: [] };
  private sources: Record<string, string> = {};
  constructor(private storageKey: string) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (Array.isArray(saved?.seen))
        this.seen = new Set(saved.seen.filter((v: unknown) => typeof v === 'string').slice(-512));
      const unread = Object.fromEntries(
        Object.entries(record(saved?.unread))
          .filter(([, kind]) => typeof kind === 'string' && Object.hasOwn(attentionLabels, kind))
          .slice(-128),
      );
      this.state = { unread: unread as Record<string, AttentionKind>, notices: [] };
      this.sources = Object.fromEntries(
        Object.entries(record(saved?.sources)).filter(
          ([id, key]) => Object.hasOwn(unread, id) && typeof key === 'string',
        ),
      ) as Record<string, string>;
    } catch {
      /* Unavailable storage leaves an in-memory notification inbox. */
    }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private commit(state: AttentionState) {
    this.state = state;
    while (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({ seen: [...this.seen], unread: state.unread, sources: this.sources }),
      );
    } catch {
      /* Keep the current tab functional. */
    }
    this.listeners.forEach((listener) => listener());
  }
  receive(notice: { sessionId: string; kind: AttentionKind; keys: string[] }) {
    const duplicate = notice.keys.some((key) => this.seen.has(key));
    if (duplicate && notice.keys.every((key) => this.seen.has(key))) return;
    notice.keys.forEach((key) => this.seen.add(key));
    if (duplicate) {
      this.commit(this.state);
      return;
    }
    // A pending question takes precedence over the completion of the same reply.
    if (
      ['question', 'approval'].includes(this.state.unread[notice.sessionId] || '') &&
      !['question', 'approval'].includes(notice.kind)
    ) {
      this.commit(this.state);
      return;
    }
    const kind = notice.kind;
    const next = { id: notice.keys[0]!, sessionId: notice.sessionId, kind };
    this.sources[notice.sessionId] = next.id;
    this.sources = Object.fromEntries(Object.entries(this.sources).slice(-128));
    this.commit({
      unread: Object.fromEntries(
        Object.entries({ ...this.state.unread, [notice.sessionId]: kind }).slice(-128),
      ),
      notices: [...this.state.notices.filter((n) => n.sessionId !== notice.sessionId), next].slice(
        -3,
      ),
    });
    return next;
  }
  read = (sessionId: string) => {
    if (!this.state.unread[sessionId] && !this.state.notices.some((n) => n.sessionId === sessionId))
      return;
    const unread = { ...this.state.unread };
    delete unread[sessionId];
    delete this.sources[sessionId];
    this.commit({ unread, notices: this.state.notices.filter((n) => n.sessionId !== sessionId) });
  };
  dismiss = (id: string) =>
    this.commit({ ...this.state, notices: this.state.notices.filter((n) => n.id !== id) });
  resolve = (sessionId: string, key: string) => {
    if (this.sources[sessionId] === key) this.read(sessionId);
  };
}

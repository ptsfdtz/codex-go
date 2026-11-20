import { t } from '../../i18n';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Packet } from '../../transport/bridge';
import type { Snapshot } from '../../workspace';
import { packetNotice, TaskAttention, attentionLabels } from './task-attention';
import {
  markSubscription,
  pushConfig,
  subscribedHere,
  subscriptionMatches,
} from './background-push';

export function useTaskAttention(
  scope: string,
  hostId: string | undefined,
  snapshot: Snapshot,
  systemNotifications: boolean,
  backgroundHost = false,
) {
  const store = useMemo(
    () => new TaskAttention(`agentdeck.web.attention.${JSON.stringify([scope, hostId])}`),
    [scope, hostId],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const context = useRef({ snapshot, systemNotifications, backgroundHost });
  const previousTurns = useMemo(() => new Map<string, string>(), [store]);
  useEffect(() => {
    if (!backgroundHost || !subscribedHere(scope) || !navigator.serviceWorker) return;
    let active = true;
    void Promise.all([
      navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL),
      pushConfig(),
    ])
      .then(async ([registration, config]) => {
        const enabled = await subscriptionMatches(config, registration);
        if (active && !enabled) markSubscription(scope, false);
      })
      .catch(() => {
        /* Keep the last known preference during temporary outages. */
      });
    return () => {
      active = false;
    };
  }, [scope, backgroundHost]);
  context.current = { snapshot, systemNotifications, backgroundHost };
  const receive = useMemo(
    () => (packet: Packet) => {
      if (packet.action === 'session.deleted' && packet.sessionId) {
        store.read(packet.sessionId);
        return;
      }
      if (
        packet.action === 'approval.resolved' &&
        packet.sessionId &&
        typeof packet.payload?.approvalId === 'string'
      ) {
        store.resolve(
          packet.sessionId,
          JSON.stringify([packet.sessionId, 'approval', packet.payload.approvalId]),
        );
        return;
      }
      const notice = packetNotice(packet, context.current.snapshot.turns);
      if (!notice) return;
      const added = store.receive(notice);
      if (
        added &&
        context.current.systemNotifications &&
        !(context.current.backgroundHost && subscribedHere(scope)) &&
        document.visibilityState !== 'visible' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification(attentionLabels[added.kind], {
            body: t('打开 AgentDeck 查看会话。'),
            tag: `agentdeck:${hostId}:${added.sessionId}`,
          });
        } catch {
          /* The in-app notice remains available if the system API rejects. */
        }
      }
    },
    [store, hostId, scope],
  );
  useEffect(() => {
    if (!hostId) return;
    for (const approval of snapshot.approvals || []) {
      if (approval.status && approval.status !== 'pending') continue;
      receive({
        action: 'approval.requested',
        sessionId: approval.sessionId,
        payload: { ...approval },
      });
    }
  }, [snapshot.approvals, hostId, receive]);
  useEffect(() => {
    if (!hostId || !snapshot.turns) return;
    for (const turn of snapshot.turns) {
      if (!turn.turnId || !turn.sessionId) continue;
      const before = previousTurns.get(turn.turnId);
      if (
        before &&
        ['queued', 'running', 'waitingApproval', 'inProgress'].includes(before) &&
        ['completed', 'failed', 'interrupted'].includes(turn.status || '')
      ) {
        receive({
          action: `turn.${turn.status}`,
          sessionId: turn.sessionId,
          turnId: turn.turnId,
          payload: { turn },
        });
      }
    }
    previousTurns.clear();
    for (const turn of snapshot.turns)
      if (turn.turnId) previousTurns.set(turn.turnId, turn.status || '');
  }, [snapshot.turns, hostId, previousTurns, receive]);
  return { ...state, receive, read: store.read, dismiss: store.dismiss };
}

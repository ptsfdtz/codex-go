import type React from 'react';
import { api } from '../cloud';
import { t } from '../i18n';
import type { Host, Capabilities, Model, Snapshot } from '../workspace';
import { chatProject } from '../workspace';
import type { Bridge, Packet } from './bridge';
import type { HostGrant } from './host';
import { historyKey, type HistoryEntry, type HistoryPage } from '../history';
import { applyProgress, historyError } from '../conversation';
import { ReconnectLoop, connectionError, type ConnectionState } from './reconnect';
import { EventCheckpoint, missedEvents, RebaseRequired, changesDirectory } from './resume';
import type { ComposerStatus } from '../features/ComposerStatus';

// Owns transport recovery; React owns view state and session selection. Every
// asynchronous boundary keeps the original generation and checkpoint guards.
type HostConnectionContext = {
  setReceiptNotice: React.Dispatch<React.SetStateAction<string>>;
  reconnect: React.RefObject<ReconnectLoop | undefined>;
  connectionEpoch: React.RefObject<number>;
  bridge: React.RefObject<Bridge | undefined>;
  setConnected: React.Dispatch<React.SetStateAction<boolean>>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setConnectionFailure: React.Dispatch<React.SetStateAction<string>>;
  setUpstreamRetry: React.Dispatch<React.SetStateAction<string>>;
  setCapabilities: React.Dispatch<React.SetStateAction<Capabilities>>;
  setModels: React.Dispatch<React.SetStateAction<Model[]>>;
  selectSession: (id?: string, persist?: boolean) => void;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot>>;
  historyRef: React.RefObject<HistoryEntry[]>;
  attentionRef: React.RefObject<{ receive: (packet: Packet) => void }>;
  sessionRef: React.RefObject<string | undefined>;
  uncertainBaseline: React.RefObject<Set<string>>;
  activityVersion: React.RefObject<number>;
  managedActiveTurn: React.RefObject<string | undefined>;
  setActiveTurn: React.Dispatch<React.SetStateAction<string | undefined>>;
  setQueueRevision: React.Dispatch<React.SetStateAction<number>>;
  setObservedUsage: React.Dispatch<
    React.SetStateAction<
      | {
          last?: Record<string, number>;
          total?: Record<string, number>;
          modelContextWindow?: number;
        }
      | undefined
    >
  >;
  setStatusRevision: React.Dispatch<React.SetStateAction<number>>;
  terminalVersion: React.RefObject<number>;
  scheduleRefresh: (includeHistory?: boolean) => void;
  historyVersion: React.RefObject<number>;
  historyStarted: React.RefObject<boolean>;
  setHistoryReady: React.Dispatch<React.SetStateAction<boolean>>;
  setHistoryCursor: React.Dispatch<React.SetStateAction<string | undefined>>;
  setHistory: (update: React.SetStateAction<HistoryEntry[]>, progress?: boolean) => void;
  scope: string;
  heartbeat: React.RefObject<ReturnType<typeof setInterval> | undefined>;
  setReceiptBlocked: React.Dispatch<React.SetStateAction<boolean>>;
  draftProjectRef: React.RefObject<string | undefined>;
  setSelectedProject: React.Dispatch<React.SetStateAction<string>>;
  historyPage: (
    connection: Bridge,
    sessionId: string,
    cursor?: string,
  ) => Promise<HistoryPage & { data: HistoryEntry[] }>;
  setHistoryFailure: React.Dispatch<React.SetStateAction<string>>;
  setConnectionState: React.Dispatch<React.SetStateAction<ConnectionState>>;
};

export function startHostConnection(
  next: Host,
  epoch: number,
  {
    setReceiptNotice,
    reconnect,
    connectionEpoch,
    bridge,
    setConnected,
    setBusy,
    setError,
    setConnectionFailure,
    setUpstreamRetry,
    setCapabilities,
    setModels,
    selectSession,
    setSnapshot,
    historyRef,
    attentionRef,
    sessionRef,
    uncertainBaseline,
    activityVersion,
    managedActiveTurn,
    setActiveTurn,
    setQueueRevision,
    setObservedUsage,
    setStatusRevision,
    terminalVersion,
    scheduleRefresh,
    historyVersion,
    historyStarted,
    setHistoryReady,
    setHistoryCursor,
    setHistory,
    scope,
    heartbeat,
    setReceiptBlocked,
    draftProjectRef,
    setSelectedProject,
    historyPage,
    setHistoryFailure,
    setConnectionState,
  }: HostConnectionContext,
) {
  const checkpoint = new EventCheckpoint();
  let configuration: { caps: Capabilities; models: Model[] } | undefined;
  let upstreamRetryTurn = '';

  function consume(packets: Packet[], baselineKeys?: Set<string>) {
    let entries = historyRef.current;
    for (const packet of packets) {
      attentionRef.current.receive(packet);
      const payload = packet.payload || {};
      const selected = packet.sessionId === sessionRef.current;
      if (selected && ['turn.progress', 'upstream.progress'].includes(packet.action || '')) {
        const turnId = payload.upstreamTurnId || payload.turnId;
        const itemId = payload.itemId || (payload.item as { id?: string } | undefined)?.id;
        const key =
          typeof turnId === 'string' && typeof itemId === 'string'
            ? historyKey({ turnId, item: { id: itemId } })
            : undefined;
        // A baseline read may already contain buffered text. Do not append
        // that text a second time. Completed items are authoritative; an
        // interrupted baseline is checked once at the terminal boundary.
        if (
          key &&
          baselineKeys?.has(key) &&
          (String(payload.method).endsWith('Delta') ||
            String(payload.method).endsWith('/delta') ||
            payload.method === 'item/started')
        ) {
          uncertainBaseline.current.add(key);
        } else {
          entries = applyProgress(entries, packet);
        }
        if (payload.method === 'item/completed') {
          const item = payload.item as { id?: string } | undefined;
          if (typeof turnId === 'string' && item?.id)
            uncertainBaseline.current.delete(historyKey({ turnId, item: { id: item.id } }));
        }
        if (payload.method === 'turn/started') {
          activityVersion.current++;
          managedActiveTurn.current = packet.turnId;
          setActiveTurn(
            packet.turnId || String(turnId || (payload.turn as { id?: string })?.id || ''),
          );
        }
        if (payload.method === 'error') {
          const detail = payload.error as { message?: string } | undefined;
          if (payload.willRetry === true) {
            upstreamRetryTurn = String(turnId || '');
            setUpstreamRetry(String(detail?.message || payload.message || t('Codex 正在重试')));
          } else {
            upstreamRetryTurn = '';
            setUpstreamRetry('');
            if (detail?.message || payload.message)
              setError(String(detail?.message || payload.message));
          }
        } else if (
          upstreamRetryTurn &&
          String(turnId) === upstreamRetryTurn &&
          String(payload.method).startsWith('item/')
        ) {
          upstreamRetryTurn = '';
          setUpstreamRetry('');
        }
      }
      if (selected && packet.action === 'queue.changed') setQueueRevision((value) => value + 1);
      if (selected && packet.action === 'session.tokenUsage')
        setObservedUsage(
          payload.tokenUsage as Parameters<typeof ComposerStatus>[0]['observedUsage'],
        );
      const terminalEvent =
        /^(?:turn\.(?:completed|failed|interrupted)|upstream\.turn\.completed)$/.test(
          packet.action || '',
        );
      if (selected && (terminalEvent || packet.action === 'goal.updated'))
        setStatusRevision((n) => n + 1);
      if (selected && terminalEvent) {
        activityVersion.current++;
        terminalVersion.current++;
        setActiveTurn(undefined);
        managedActiveTurn.current = undefined;
        setUpstreamRetry('');
        // Some old sources omit the final item after interruption. Only that
        // exceptional baseline needs one latest-page read, never each delta.
        if (uncertainBaseline.current.size) {
          uncertainBaseline.current.clear();
          scheduleRefresh(true);
        }
      }
      if (selected && packet.action === 'session.deleted') {
        selectSession(undefined, false);
        entries = [];
      }
      if (selected && packet.action === 'session.historyChanged') {
        entries = [];
        historyVersion.current++;
        historyStarted.current = false;
        setHistoryReady(false);
        setHistoryCursor(undefined);
        scheduleRefresh(true);
      }
      if (selected && packet.action === 'session.contentChanged') {
        // A different local runtime saved content. Read one latest page and
        // merge by native identity, retaining older pages and reading position.
        // Hidden pages catch up on visibilitychange instead of doing disk reads.
        if (document.visibilityState === 'visible') scheduleRefresh(true);
      }
      if (
        packet.action === 'sessions.synced' &&
        Array.isArray(payload.contentSessionIds) &&
        payload.contentSessionIds.includes(sessionRef.current) &&
        document.visibilityState === 'visible'
      )
        scheduleRefresh(true);
      if (changesDirectory(packet)) scheduleRefresh(false);
    }
    setHistory(entries, true);
  }

  try {
    const loop = new ReconnectLoop(
      async (context) => {
        let recovering = true;
        let buffered: Packet[] = [];
        let bufferedBytes = 0;
        let flushTimer: ReturnType<typeof setTimeout> | undefined;
        const grant = await api<HostGrant>(
          '/api/v1/hosts/' + encodeURIComponent(next.hostId) + '/access',
          { method: 'POST' },
        );
        if (!context.current() || epoch !== connectionEpoch.current) return;
        if (
          grant.hostId !== next.hostId ||
          !/^[a-f0-9]{64}$/i.test(grant.fingerprint) ||
          !/^[A-Za-z0-9_-]{43}$/.test(grant.credential)
        )
          throw new Error(t('电脑授权信息无效，请更新 Host'));
        const { Bridge } = await import('./bridge');
        if (!context.current() || epoch !== connectionEpoch.current) return;
        const value = new Bridge(scope);
        context.own(() => {
          if (flushTimer !== undefined) clearTimeout(flushTimer);
          if (heartbeat.current) clearInterval(heartbeat.current);
          if (bridge.current === value) bridge.current = undefined;
          value.close();
        });
        value.onEvent((packet) => {
          if (!context.current() || epoch !== connectionEpoch.current) return;
          if (packet.type === 'closed') {
            context.closed(new Error(packet.message || t('电脑连接已断开')));
            return;
          }
          if (packet.type === 'receipt') {
            setReceiptBlocked(value.awaitingReceipt);
            if (!value.awaitingReceipt)
              setReceiptNotice(t('核对完成，草稿已保留。请确认结果后再发送。'));
            if (!recovering) scheduleRefresh(false);
            return;
          }
          if (packet.type !== 'event') return;
          buffered.push(packet);
          bufferedBytes += JSON.stringify(packet).length;
          if (buffered.length > 4096 || bufferedBytes > 8 * 1024 * 1024) {
            context.closed(new Error(t('同步积压过大，正在重新建立连接')));
            return;
          }
          if (!recovering && flushTimer === undefined)
            flushTimer = setTimeout(() => {
              flushTimer = undefined;
              if (!context.current()) return;
              const batch = buffered;
              buffered = [];
              bufferedBytes = 0;
              try {
                checkpoint.live(batch, consume);
              } catch (error) {
                context.closed(
                  error instanceof Error ? error : new Error(t('Event stream interrupted')),
                );
              }
            }, 40);
        });
        await value.connect(grant);
        if (!context.current()) return;
        context.linked();
        bridge.current = value;
        // Heartbeats do not wait for history reads or recovery.
        heartbeat.current = setInterval(() => {
          void value
            .probe()
            .then(() => value.reconcile())
            .catch(() => value.close());
        }, 30000);
        const snap = await value.request<Snapshot>('snapshot.get', {});
        // Reconnecting may follow a Host upgrade; refresh its feature flags.
        const [caps, modelList] = await Promise.all([
          value.request<Capabilities>('system.capabilities', {}),
          value.request<{ models?: Model[] }>('models.list', {}).catch(() => ({
            models: configuration?.models || [],
          })),
        ]);
        configuration = { caps, models: modelList.models || [] };
        if (!context.current() || epoch !== connectionEpoch.current) return;
        setSnapshot(snap);
        setCapabilities(configuration.caps);
        setModels(configuration.models);
        setReceiptBlocked(value.awaitingReceipt);
        const saved =
          sessionRef.current ||
          (draftProjectRef.current !== undefined
            ? `new:${draftProjectRef.current}`
            : localStorage.getItem('agentdeck.web.selection.' + scope + '.' + next.hostId));
        const savedProject = saved?.startsWith('new:') ? saved.slice(4) : undefined;
        const chosen =
          snap.sessions?.find((s) => s.sessionId === saved) ||
          (!saved ? snap.sessions?.find((s) => s.archived !== 1) : undefined);
        const restoredProject =
          chosen?.projectId ||
          snap.projects?.find((project) => project.projectId === savedProject)?.projectId ||
          (configuration.caps.features?.projectlessChat
            ? chatProject
            : snap.projects?.[0]?.projectId) ||
          '';
        setSelectedProject(restoredProject);
        if (!chosen && saved?.startsWith('new:')) draftProjectRef.current = restoredProject;
        if (chosen?.sessionId !== sessionRef.current) selectSession(chosen?.sessionId);

        let replay: Packet[] = [];
        let rebase = checkpoint.cursor === undefined || !historyStarted.current || !snap.cursor;
        let historyUsable = true;
        if (!rebase && snap.cursor) {
          try {
            replay = await missedEvents(
              (action, payload) => value.request(action, payload),
              checkpoint.cursor!,
              snap.cursor,
              context.current,
            );
          } catch (error) {
            if (error instanceof RebaseRequired) rebase = true;
            else throw error;
          }
        }
        const selected = sessionRef.current;
        let baselineKeys: Set<string> | undefined;
        if (rebase) {
          // Retain the readable view while fetching. Once the cursor expires,
          // old pages may contain missed revisions, so replace them with one
          // authoritative latest page and let the user page backwards again.
          const version = historyVersion.current;
          if (selected) {
            try {
              const page = await historyPage(value, selected);
              if (!context.current()) return;
              if (selected === sessionRef.current && version === historyVersion.current) {
                const chronological = [...page.data].reverse();
                baselineKeys = new Set(chronological.map(historyKey));
                setHistory(chronological, true);
                setHistoryCursor(page.nextCursor);
                historyStarted.current = true;
                setHistoryReady(true);
                setHistoryFailure('');
              }
            } catch (error) {
              if (!context.current()) return;
              if (selected === sessionRef.current && version === historyVersion.current) {
                setHistoryFailure(historyError(error));
                setHistoryReady(false);
                historyUsable = false;
              }
              // History is independently retryable; a readable transport must
              // not remain labelled "reconnecting" because history failed.
            }
          }
          checkpoint.reset(snap.cursor);
          replay = [];
        }
        if (!context.current()) return;
        // Replay and already-received live frames are merged in one batch.
        // Checkpoint deduplication prevents replay/live overlap and late events.
        const running = snap.turns?.find(
          (t) =>
            t.sessionId === selected &&
            ['queued', 'running', 'waitingApproval'].includes(t.status || ''),
        );
        managedActiveTurn.current = running?.turnId;
        setActiveTurn(running?.turnId);
        checkpoint.apply(replay, consume);
        checkpoint.live(buffered, (packets) => consume(packets, baselineKeys));
        buffered = [];
        bufferedBytes = 0;
        recovering = false;
        if (selected && historyStarted.current && historyUsable) setHistoryReady(true);
        localStorage.setItem('agentdeck.web.host.' + scope, next.hostId);
      },
      (state, error) => {
        if (epoch !== connectionEpoch.current) return;
        setConnectionState(state);
        setConnected(state === 'connected');
        setBusy(state === 'connecting');
        if (state === 'connected' || state === 'syncing') setConnectionFailure('');
        else if (state === 'retrying') setConnectionFailure(connectionError(error));
        else if (state === 'blocked') setConnectionFailure(String(error || t('连接需要重新授权')));
      },
    );
    reconnect.current = loop;
    loop.start();
  } catch (error) {
    if (epoch === connectionEpoch.current) {
      setConnectionFailure(String(error));
      setBusy(false);
    }
  }
}

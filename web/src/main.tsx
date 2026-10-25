import { Timeline } from './Timeline';
import { RichContent } from './RichContent';
import { attachmentsFromFiles, type Attachment } from './media';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { api, installationId, accountEvent } from './cloud';
import { ReconnectLoop, type ConnectionState } from './transport/reconnect';
import {
  mergeHistory,
  withLiveText,
  historyKey,
  type HistoryEntry,
  type HistoryPage,
} from './history';
import { Bridge, type Packet } from './transport/bridge';
import { AccountPassword } from './AccountPassword';
import { type HostGrant } from './host-book';

type Host = { hostId: string; displayName: string; online: boolean };
type Device = { deviceId: string; kind: string; displayName: string; revoked?: boolean };
type Model = {
  id?: string;
  model?: string;
  name?: string;
  displayName?: string;
  supportedReasoningEfforts?: (string | { reasoningEffort: string; description?: string })[];
};
type Project = { projectId: string; name: string; canonicalPath?: string };
type Session = { sessionId: string; title?: string; projectId?: string; updatedAt?: string };
type Turn = { turnId?: string; sessionId?: string; status?: string };
type Approval = {
  approvalId: string;
  sessionId: string;
  turnId: string;
  method?: string;
  context?: unknown;
  allowedDecisions?: string[];
};
type Snapshot = {
  sessions?: Session[];
  projects?: Project[];
  turns?: Turn[];
  approvals?: Approval[];
};

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(
        '/api/v1/web/login',
        {
          method: 'POST',
          body: JSON.stringify({
            username,
            password,
            installationId: installationId(),
            deviceName: `Web ${navigator.platform}`,
            kind: 'web',
          }),
        },
        false,
      );
      onLogin();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="center">
      <form className="card login" onSubmit={submit}>
        <div className="brand">
          AGENT<span>DECK</span>
        </div>
        <h1>登录</h1>
        <input
          aria-label="用户名"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="用户名"
          autoComplete="username"
        />
        <input
          aria-label="密码"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="密码"
          type="password"
          autoComplete="current-password"
        />
        <button disabled={busy || !username || !password}>{busy ? '登录中…' : '登录'}</button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}

function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: Approval;
  onDecide: (
    approval: Approval,
    decision: string,
    answers?: Record<string, { answers: string[] }>,
  ) => Promise<void>;
}) {
  type Question = { id: string; question?: string; options?: (string | { label: string })[] };
  const context = approval.context as { questions?: Question[] } | undefined;
  const questions = Array.isArray(context?.questions) ? context.questions : [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState(false);
  const normalizedAnswers = Object.fromEntries(
    Object.entries(answers).map(([id, value]) => [id, { answers: [value] }]),
  );
  return (
    <div className="approval">
      <div className="approval-copy">
        需要确认：{approval.method || 'Codex 操作'}
        {!questions.length && (
          <pre className="approval-context">{JSON.stringify(approval.context, null, 2)}</pre>
        )}
        {questions.map((question) => (
          <label className="question" key={question.id || question.question}>
            <span>{question.question || '请输入回答'}</span>
            <input
              value={answers[question.id] || ''}
              onChange={(event) =>
                setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
              }
              placeholder={question.options
                ?.map((option) => (typeof option === 'string' ? option : option.label))
                .join(' / ')}
            />
          </label>
        ))}
      </div>
      {(approval.allowedDecisions || ['approve', 'reject']).map((decision) => (
        <button
          className={decision === 'approve' ? '' : 'ghost'}
          key={decision}
          disabled={
            deciding ||
            (decision === 'approve' && questions.some((question) => !answers[question.id]?.trim()))
          }
          onClick={async () => {
            setDeciding(true);
            try {
              await onDecide(approval, decision, questions.length ? normalizedAnswers : undefined);
            } finally {
              setDeciding(false);
            }
          }}
        >
          {decision === 'approve' ? '允许' : decision === 'reject' ? '拒绝' : decision}
        </button>
      ))}
    </div>
  );
}

function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [scope, setScope] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const connectionEpoch = useRef(0);
  const accountEpoch = useRef(0);
  const reconnect = useRef<ReconnectLoop | undefined>(undefined);
  const [connectionState, setConnectionState] = useState<ConnectionState>('stopped');
  const [receiptNotice, setReceiptNotice] = useState('');
  const [receiptBlocked, setReceiptBlocked] = useState(false);
  const hostRef = useRef<Host | undefined>(undefined);
  const historyIdentity = useRef('');
  const historyStarted = useRef(false);
  const latestRead = useRef(0);
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  const olderRequest = useRef(0);
  const mutationBusy = useRef(false);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [host, setHost] = useState<Host>();
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [session, setSession] = useState<string>();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const historyRef = useRef(history);
  historyRef.current = history;
  const [historyCursor, setHistoryCursor] = useState<string | undefined>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const liveEntries = useRef(new Map<string, HistoryEntry>());
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const timeline = useRef<Timeline | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeTurn, setActiveTurn] = useState<string>();
  const [selectedProject, setSelectedProject] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [connected, setConnected] = useState(false);
  const bridge = useRef<Bridge | undefined>(undefined);
  const sessionRef = useRef<string | undefined>(undefined);
  const refreshTimer = useRef<number | undefined>(undefined);
  const historyResourceCache = useRef(new Map<string, HistoryEntry>());

  async function historyPage(
    connection: Bridge,
    sessionId: string,
    cursor?: string,
  ): Promise<HistoryPage & { data: HistoryEntry[] }> {
    const page = await connection.request<HistoryPage>('sessions.history', {
      sessionId,
      ...(cursor ? { cursor } : {}),
      limit: 50,
      sortDirection: 'desc',
    });
    const data = [...(page.data || [])];
    const resource = page.resource;
    if (!resource) return { ...page, data };
    const total = resource.bytes || 0;
    if (
      total < 1 ||
      total > 8 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/i.test(resource.sha256 || '') ||
      (resource.cursor !== null &&
        resource.cursor !== undefined &&
        typeof resource.cursor !== 'string')
    )
      throw new Error('电脑返回了无效的历史资源描述');
    const cacheKey = `${sessionId}:${resource.sha256!.toLowerCase()}`;
    const cached = historyResourceCache.current.get(cacheKey);
    if (cached) return { ...page, data: [...data, cached] };
    const bytes = new Uint8Array(total);
    let offset = 0;
    while (offset < total) {
      const chunk = await connection.request<{
        data?: string;
        offset?: number;
        totalBytes?: number;
        nextOffset?: number;
      }>('sessions.historyContent', {
        sessionId,
        ...(typeof resource.cursor === 'string' ? { cursor: resource.cursor } : {}),
        sha256: resource.sha256,
        offset,
        sortDirection: 'desc',
      });
      if (chunk.offset !== offset || chunk.totalBytes !== total || typeof chunk.data !== 'string')
        throw new Error('历史资源分块无效');
      const binary = atob(chunk.data);
      if (!binary.length || binary.length > 64 * 1024 || offset + binary.length > total)
        throw new Error('历史资源分块超出限制');
      for (let index = 0; index < binary.length; index++)
        bytes[offset + index] = binary.charCodeAt(index);
      const next = chunk.nextOffset ?? total;
      if (next !== offset + binary.length || next <= offset)
        throw new Error('历史资源 offset 无效');
      offset = next;
    }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    if (digest.toLowerCase() !== resource.sha256!.toLowerCase())
      throw new Error('历史资源校验失败');
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as HistoryEntry;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.item ||
      (resource.turnId && parsed.turnId !== resource.turnId) ||
      (resource.itemId && parsed.item.id !== resource.itemId)
    )
      throw new Error('历史资源内容无效');
    if (historyResourceCache.current.size >= 4) {
      const oldest = historyResourceCache.current.keys().next().value;
      if (oldest) historyResourceCache.current.delete(oldest);
    }
    historyResourceCache.current.set(cacheKey, parsed);
    data.push(parsed);
    return { ...page, data };
  }
  const current = useMemo(
    () => snapshot.sessions?.find((item) => item.sessionId === session),
    [snapshot.sessions, session],
  );
  const selectedModel = useMemo(
    () => models.find((item) => (item.id || item.model) === model),
    [models, model],
  );
  const effortOptions: string[] = selectedModel?.supportedReasoningEfforts?.length
    ? selectedModel.supportedReasoningEfforts.map((value) =>
        typeof value === 'string' ? value : value.reasoningEffort,
      )
    : [];

  function selectSession(id: string | undefined) {
    if (sessionRef.current !== id) {
      historyStarted.current = false;
      latestRead.current++;
      olderRequest.current++;
      setHistory([]);
      setHistoryCursor(undefined);
      setHistoryLoading(false);
      liveEntries.current.clear();
      setActiveTurn(undefined);
    }
    sessionRef.current = id;
    setSession(id);
  }
  useEffect(() => {
    if (!scope || !host) return;
    try {
      localStorage.setItem(
        'agentdeck.web.selection.' + scope,
        JSON.stringify({ hostId: host.hostId, sessionId: session, projectId: selectedProject }),
      );
    } catch {
      setError('无法保存会话选择，重新打开后需手动选择电脑');
    }
  }, [scope, host, session, selectedProject]);
  useEffect(() => {
    const epoch = accountEpoch.current;
    api('/api/v1/web/session')
      .then((value) => {
        if (epoch !== accountEpoch.current) return;
        setScope(`${value.accountId}:${value.cloudDeviceId}`);
        setMustChangePassword(value.mustChangePassword === true);
        setSignedIn(true);
      })
      .catch(() => {
        if (epoch === accountEpoch.current) setSignedIn(false);
      });
  }, []);
  useEffect(() => {
    if (!signedIn || mustChangePassword) return;
    let active = true;
    const epoch = accountEpoch.current;
    let pending = false;
    const readDirectory = async () => {
      if (pending) return;
      pending = true;
      try {
        const [hostValue, deviceValue] = await Promise.all([
          api<{ hosts: Host[] }>('/api/v1/hosts'),
          api<{ devices: Device[] }>('/api/v1/devices'),
        ]);
        if (!active || epoch !== accountEpoch.current) return;
        setHosts(hostValue.hosts || []);
        setDevices(deviceValue.devices || []);
        if (
          hostRef.current &&
          !hostValue.hosts.some((item) => item.hostId === hostRef.current?.hostId)
        ) {
          connectionEpoch.current++;
          reconnect.current?.stop();
          bridge.current?.close();
          bridge.current = undefined;
          hostRef.current = undefined;
          setHost(undefined);
          setConnected(false);
          setSnapshot({});
          selectSession(undefined);
        }
        try {
          const saved = JSON.parse(
            localStorage.getItem('agentdeck.web.selection.' + scope) || 'null',
          );
          const previous =
            hostValue.hosts.find((item) => item.hostId === saved?.hostId) ||
            (hostValue.hosts.length === 1 ? hostValue.hosts[0] : undefined);
          if (previous && !hostRef.current)
            void connect(previous, saved?.sessionId, saved?.projectId);
        } catch {
          setError('无法读取上次的会话选择，请手动选择电脑');
        }
      } catch (error) {
        if (active && epoch === accountEpoch.current) setError(String(error));
      } finally {
        pending = false;
      }
    };
    void readDirectory();
    const timer = window.setInterval(() => void readDirectory(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [signedIn, mustChangePassword, scope]);
  useEffect(() => {
    const identity = JSON.stringify([host?.hostId, session]);
    if (historyIdentity.current !== identity) {
      historyIdentity.current = identity;
      historyStarted.current = false;
      latestRead.current++;
      olderRequest.current++;
      setHistoryLoading(false);
      setHistory([]);
      setHistoryCursor(undefined);
      liveEntries.current.clear();
    }
    if (connected && session) scheduleRefresh();
  }, [host?.hostId, session, connected]);
  useEffect(() => {
    const offline = () => bridge.current?.close();
    const wake = () => {
      if (document.visibilityState === 'hidden') return;
      reconnect.current?.wake();
      const value = bridge.current;
      if (value)
        void value
          .request('system.hello', { client: 'AgentDeck Web/0.3.0', version: 1 })
          .then(() => value.reconcile())
          .then(() => scheduleRefresh())
          .catch(() => value.close());
    };
    const receiptChanged = (event: StorageEvent) => {
      if (!event.key?.startsWith('agentdeck.web.receipts.') || !bridge.current) return;
      try {
        setReceiptBlocked(bridge.current.awaitingReceipt);
      } catch {
        setReceiptBlocked(true);
        setReceiptNotice('无法读取操作回执，暂不能发送新操作');
      }
    };
    const accountChanged = () => {
      const epoch = ++accountEpoch.current;
      reconnect.current?.stop();
      connectionEpoch.current++;
      bridge.current?.close();
      bridge.current = undefined;
      setConnected(false);
      setSnapshot({});
      setHistory([]);
      setInput('');
      setAttachments([]);
      setHost(undefined);
      hostRef.current = undefined;
      selectSession(undefined);
      setHosts([]);
      setDevices([]);
      setModels([]);
      setSignedIn(null);
      void api('/api/v1/web/session', {}, false)
        .then((value) => {
          if (epoch !== accountEpoch.current) return;
          setScope(String(value.accountId) + ':' + String(value.cloudDeviceId));
          setMustChangePassword(value.mustChangePassword === true);
          setSignedIn(true);
        })
        .catch(() => {
          if (epoch === accountEpoch.current) setSignedIn(false);
        });
    };
    window.addEventListener('storage', receiptChanged);
    window.addEventListener('online', wake);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener(accountEvent, accountChanged);
    return () => {
      window.removeEventListener('storage', receiptChanged);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener(accountEvent, accountChanged);
      connectionEpoch.current++;
      reconnect.current?.stop();
      bridge.current?.close();
      if (refreshTimer.current !== undefined) clearTimeout(refreshTimer.current);
    };
  }, []);

  async function refresh() {
    if (!bridge.current) return;
    if (refreshing.current) {
      refreshAgain.current = true;
      return;
    }
    refreshing.current = true;
    const value = bridge.current,
      epoch = connectionEpoch.current;
    try {
      const next = await value.request<Snapshot>('snapshot.get', {});
      if (epoch !== connectionEpoch.current) return;
      setSnapshot(next);
      const id = sessionRef.current;
      setActiveTurn(
        next.turns?.find(
          (turn) =>
            turn.sessionId === id &&
            ['queued', 'running', 'waitingApproval'].includes(turn.status || ''),
        )?.turnId,
      );
      if (id) {
        const read = ++latestRead.current;
        const page = await historyPage(value, id);
        if (
          epoch === connectionEpoch.current &&
          id === sessionRef.current &&
          read === latestRead.current
        ) {
          setHistory((items) =>
            withLiveText(
              mergeHistory(items, [...page.data].reverse(), 'latest'),
              liveEntries.current,
            ),
          );
          if (!historyStarted.current) {
            setHistoryCursor(page.nextCursor);
            historyStarted.current = true;
          }
        }
      }
    } finally {
      refreshing.current = false;
      if (refreshAgain.current) {
        refreshAgain.current = false;
        scheduleRefresh();
      }
    }
  }

  function scheduleRefresh() {
    if (refreshTimer.current !== undefined) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = undefined;
      void refresh().catch(() => undefined);
    }, 250);
  }

  async function connect(next: Host, restoreSession?: string, restoreProject?: string) {
    reconnect.current?.stop();
    connectionEpoch.current++;
    bridge.current = undefined;
    hostRef.current = next;
    setAttachments([]);
    setInput('');
    setModels([]);
    setHost(next);
    selectSession(restoreSession);
    setSnapshot({});
    setHistory([]);
    historyStarted.current = false;
    historyResourceCache.current.clear();
    setError('');
    setReceiptNotice('');
    const ownerScope = scope;
    const loop = new ReconnectLoop(
      async ({ current: isCurrent, own, closed }) => {
        const epoch = ++connectionEpoch.current;
        const value = new Bridge(ownerScope);
        const heartbeat: { timer?: ReturnType<typeof setInterval> } = {};
        own(() => {
          if (heartbeat.timer) clearInterval(heartbeat.timer);
          value.close();
          if (bridge.current === value) bridge.current = undefined;
        });
        const grant = await api<HostGrant>(
          `/api/v1/hosts/${encodeURIComponent(next.hostId)}/access`,
          { method: 'POST' },
        );
        if (!isCurrent()) return;
        if (
          grant.hostId !== next.hostId ||
          !/^[a-f0-9]{64}$/i.test(grant.fingerprint) ||
          !/^[A-Za-z0-9_-]{43}$/.test(grant.credential)
        )
          throw new Error('电脑授权信息无效，请更新桌面端');
        bridge.current = value;
        let authenticated = false;
        const earlyPackets: Packet[] = [];
        const onPacket = (packet: Packet) => {
          if (!isCurrent()) return;
          if (packet.type === 'closed') {
            closed(new Error(packet.message || 'Host disconnected'));
            return;
          }
          if (!authenticated) {
            if (earlyPackets.length >= 256) {
              closed(new Error('Host event buffer exceeded'));
              return;
            }
            earlyPackets.push(packet);
            return;
          }
          if (packet.type === 'receipt') {
            setReceiptBlocked(value.awaitingReceipt);
            const status = String(packet.payload?.status || 'unknown');
            setReceiptNotice(
              status !== 'done'
                ? '上一条操作结果仍待核对（' + status + '），暂不能发送新操作'
                : '已收到操作核对结果，请查看会话状态',
            );
            scheduleRefresh();
          }
          if (packet.type === 'event') {
            if (!packet.sessionId || packet.sessionId === sessionRef.current) {
              const payload = packet.payload;
              if (
                payload?.method === 'item/agentMessage/delta' &&
                typeof payload.turnId === 'string' &&
                typeof payload.itemId === 'string' &&
                typeof payload.delta === 'string'
              ) {
                const entry: HistoryEntry = {
                  turnId: payload.turnId,
                  item: { id: payload.itemId, type: 'agentMessage', text: '' },
                };
                const key = historyKey(entry),
                  previous =
                    liveEntries.current.get(key) ||
                    historyRef.current.find((item) => historyKey(item) === key);
                entry.item!.text = String(previous?.item?.text || '') + payload.delta;
                liveEntries.current.set(key, entry);
                setHistory((items) => withLiveText(items, liveEntries.current));
              }
              if (/turn\.(completed|failed|interrupted)/.test(packet.action || '')) {
                setActiveTurn(undefined);
                liveEntries.current.clear();
              }
            }
            scheduleRefresh();
          }
        };
        value.onEvent(onPacket);
        await value.connect(grant);
        if (!isCurrent()) return;
        authenticated = true;
        setReceiptBlocked(value.awaitingReceipt);
        for (const packet of earlyPackets) onPacket(packet);
        const snap = await value.request<Snapshot>('snapshot.get', {});
        if (!isCurrent()) return;
        setSnapshot(snap);
        const selected = snap.sessions?.find((item) => item.sessionId === sessionRef.current);
        const selectedId = selected?.sessionId;
        // Never silently substitute a different conversation for a missing original.
        selectSession(selectedId);
        setSelectedProject(
          selected?.projectId || restoreProject || snap.projects?.[0]?.projectId || '',
        );
        if (selectedId) {
          const page = await historyPage(value, selectedId);
          if (!isCurrent()) return;
          if (sessionRef.current === selectedId) {
            setHistory((items) =>
              withLiveText(
                mergeHistory(items, [...page.data].reverse(), 'latest'),
                liveEntries.current,
              ),
            );
            if (!historyStarted.current) {
              setHistoryCursor(page.nextCursor);
              historyStarted.current = true;
            }
          }
        }
        if (!isCurrent()) return;
        setActiveTurn(
          snap.turns?.find(
            (turn) =>
              turn.sessionId === sessionRef.current &&
              ['queued', 'running', 'waitingApproval'].includes(turn.status || ''),
          )?.turnId,
        );
        liveEntries.current.clear();
        heartbeat.timer = setInterval(() => {
          void value
            .request('system.hello', { client: 'AgentDeck Web/0.3.0', version: 1 })
            .then(() => value.reconcile())
            .catch(() => value.close());
        }, 30_000);
        void value
          .request<{ models?: Model[] }>('models.list', {})
          .then((result) => {
            if (epoch === connectionEpoch.current) setModels(result.models || []);
          })
          .catch(() => {
            if (isCurrent()) setModels([]);
          });
      },
      (state, failure) => {
        setConnectionState(state);
        setConnected(state === 'connected');
        if (failure) setError(String(failure));
        else if (state === 'connected') setError('');
      },
    );
    reconnect.current = loop;
    loop.start();
  }

  async function loadOlderHistory() {
    if (!bridge.current || !session || !historyCursor || historyLoading) return;
    const epoch = connectionEpoch.current;
    const id = session;
    timeline.current?.pause();
    const request = ++olderRequest.current;
    setHistoryLoading(true);
    try {
      const page = await historyPage(bridge.current, session, historyCursor);
      if (epoch !== connectionEpoch.current || id !== sessionRef.current) return;
      setHistory((items) =>
        withLiveText(mergeHistory(items, [...page.data].reverse(), 'older'), liveEntries.current),
      );
      setHistoryCursor(page.nextCursor);
    } catch (error) {
      if (epoch === connectionEpoch.current && id === sessionRef.current) setError(String(error));
    } finally {
      if (request === olderRequest.current) setHistoryLoading(false);
    }
  }

  async function send() {
    const value = bridge.current,
      epoch = connectionEpoch.current;
    if (
      !value ||
      !connected ||
      receiptBlocked ||
      (!input.trim() && !attachments.length) ||
      busy ||
      mutationBusy.current
    )
      return;
    mutationBusy.current = true;
    const text = input.trim() || '请查看所附图片。',
      files = attachments;
    const original = sessionRef.current;
    let id = original;
    setBusy(true);
    setError('');
    try {
      if (!id) {
        const created = await value.request<{ session?: Session }>('sessions.create', {
          projectId: selectedProject || snapshot.projects?.[0]?.projectId,
          title: text.slice(0, 80) || '图片会话',
        });
        id = created.session?.sessionId;
        if (!id) throw new Error('电脑没有返回会话标识');
        if (epoch !== connectionEpoch.current || sessionRef.current !== original) return;
        selectSession(id);
      }
      if (epoch !== connectionEpoch.current || sessionRef.current !== id) return;
      const payload: Record<string, unknown> = { sessionId: id, text };
      if (files.length) payload.attachments = files.map(({ name, data }) => ({ name, data }));
      if (model) payload.model = model;
      if (effort) payload.effort = effort;
      const result = await value.request<{ turn?: Turn }>('turn.start', payload);
      if (epoch !== connectionEpoch.current || sessionRef.current !== id) return;
      setInput('');
      setAttachments([]);
      liveEntries.current.clear();
      setActiveTurn(result.turn?.turnId);
      await refresh();
    } catch (error) {
      if (epoch === connectionEpoch.current && sessionRef.current === id) {
        setError(String(error));
        setReceiptBlocked(value.awaitingReceipt);
      }
    } finally {
      mutationBusy.current = false;
      setBusy(false);
    }
  }

  async function interrupt() {
    const value = bridge.current,
      epoch = connectionEpoch.current,
      id = sessionRef.current;
    if (!value || !connected || !id || !activeTurn) return;
    try {
      await value.request('turn.interrupt', { sessionId: id, turnId: activeTurn });
      if (epoch !== connectionEpoch.current || id !== sessionRef.current) return;
      setActiveTurn(undefined);
      await refresh();
    } catch (error) {
      if (epoch === connectionEpoch.current && id === sessionRef.current) setError(String(error));
    }
  }

  async function decide(
    approval: Approval,
    decision: string,
    answers?: Record<string, { answers: string[] }>,
  ) {
    const value = bridge.current,
      epoch = connectionEpoch.current;
    if (!value || !connected) return;
    try {
      await value.request('approvals.decide', {
        sessionId: approval.sessionId,
        turnId: approval.turnId,
        approvalId: approval.approvalId,
        decision,
        ...(answers ? { answers } : {}),
      });
      if (epoch !== connectionEpoch.current) return;
      await refresh();
    } catch (error) {
      if (epoch === connectionEpoch.current) setError(String(error));
    }
  }

  async function revokeDevice(deviceId: string) {
    try {
      await api(`/api/v1/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
      setDevices((items) =>
        items.map((item) => (item.deviceId === deviceId ? { ...item, revoked: true } : item)),
      );
    } catch (error) {
      setError(String(error));
    }
  }

  if (signedIn === null) return <main className="center">加载中…</main>;
  if (!signedIn) return <Login onLogin={() => location.reload()} />;
  if (mustChangePassword) return <AccountPassword />;
  return (
    <div className="shell">
      <header>
        <div className="brand">
          AGENT<span>DECK</span>
        </div>
        <span className={connected ? 'connection online-text' : 'connection'}>
          {connected
            ? '已连接'
            : connectionState === 'retrying'
              ? '正在重连…'
              : connectionState === 'connecting'
                ? '正在连接…'
                : connectionState === 'blocked'
                  ? '需要处理连接问题'
                  : '未连接'}
        </span>
        <button
          className="ghost"
          onClick={() =>
            api('/api/v1/web/logout', { method: 'POST' }).then(() => location.reload())
          }
        >
          退出
        </button>
      </header>
      <div className="layout">
        <aside className="card hosts">
          <h2>电脑</h2>
          {hosts.map((item) => (
            <button
              className={host?.hostId === item.hostId ? 'host selected' : 'host'}
              key={item.hostId}
              onClick={() => void connect(item)}
            >
              <span className={item.online ? 'dot online' : 'dot'} />
              {item.displayName}
              <small>{item.online ? '在线' : '离线'}</small>
            </button>
          ))}
          {!hosts.length && <p className="muted">还没有绑定电脑。</p>}
          <h2 className="session-title">项目</h2>
          <select
            value={selectedProject}
            onChange={(event) => setSelectedProject(event.target.value)}
            disabled={!snapshot.projects?.length}
          >
            <option value="">选择项目</option>
            {(snapshot.projects || []).map((item) => (
              <option value={item.projectId} key={item.projectId}>
                {item.name}
              </option>
            ))}
          </select>
          <div className="session-heading">
            <h2 className="session-title">会话</h2>
            <button
              className="new-session"
              onClick={() => {
                setActiveTurn(undefined);
                liveEntries.current.clear();
                selectSession(undefined);
              }}
            >
              ＋
            </button>
          </div>
          {(snapshot.sessions || []).map((item) => (
            <button
              className={session === item.sessionId ? 'session selected' : 'session'}
              key={item.sessionId}
              onClick={() => {
                setActiveTurn(undefined);
                liveEntries.current.clear();
                selectSession(item.sessionId);
              }}
            >
              {item.title || '未命名会话'}
            </button>
          ))}
          <h2 className="session-title">设备</h2>
          {devices.map((item) => (
            <div className="device" key={item.deviceId}>
              <span>
                {item.displayName}
                <small>{item.kind}</small>
              </span>
              {item.revoked ? (
                <small>已撤销</small>
              ) : (
                <button className="device-revoke" onClick={() => void revokeDevice(item.deviceId)}>
                  撤销
                </button>
              )}
            </div>
          ))}
        </aside>
        <section className="card conversation">
          <div className="conversation-head">
            <div>
              <h1>{host?.displayName || '选择一台电脑'}</h1>
              <p>{current?.title || '云端会话'}</p>
            </div>
            {host && (
              <button
                className="ghost"
                disabled={busy}
                onClick={() => void connect(host, session, selectedProject)}
              >
                重新连接
              </button>
            )}
            {error && <span className="error">{error}</span>}
          </div>
          {receiptNotice && (
            <p role="status" className="receipt-notice">
              {receiptNotice}
            </p>
          )}
          {(snapshot.approvals || []).map((approval, index) => (
            <ApprovalCard
              approval={approval}
              onDecide={decide}
              key={approval.approvalId || index}
            />
          ))}
          <Timeline ref={timeline} identity={JSON.stringify([host?.hostId, session])}>
            {historyCursor && (
              <button
                className="ghost history-more"
                onClick={() => void loadOlderHistory()}
                disabled={historyLoading}
              >
                {historyLoading ? '加载中…' : '加载更早记录'}
              </button>
            )}
            {history.map((entry) => {
              const item = entry.item || {};
              return (
                <article
                  className="turn"
                  key={historyKey(entry)}
                  data-history-key={historyKey(entry)}
                >
                  <div className="role">
                    {item.type === 'userMessage' || item.role === 'user' ? '你' : 'Codex'}
                  </div>
                  <RichContent
                    entry={entry}
                    connection={connected ? bridge.current : undefined}
                    sessionId={session || ''}
                  />
                </article>
              );
            })}
            {!history.length && <div className="empty">连接电脑后开始一段新的 Codex 会话。</div>}
          </Timeline>
          <div className="composer">
            <div className="composer-options">
              <select value={model} onChange={(event) => setModel(event.target.value)}>
                <option value="">默认模型</option>
                {models.map((item) => {
                  const id = item.id || item.model || '';
                  return id ? (
                    <option value={id} key={id}>
                      {item.displayName || item.name || id}
                    </option>
                  ) : null;
                })}
              </select>
              <select value={effort} onChange={(event) => setEffort(event.target.value)}>
                <option value="">默认推理</option>
                {effortOptions.map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <label className="attachment-picker">
              添加图片（最多 4 张，共 512 KiB）
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                disabled={!connected || busy || receiptBlocked}
                onChange={async (event) => {
                  const files = [...(event.target.files || [])];
                  event.target.value = '';
                  const epoch = connectionEpoch.current;
                  if (!files.length || mutationBusy.current) return;
                  mutationBusy.current = true;
                  setBusy(true);
                  try {
                    const next = await attachmentsFromFiles(files, attachments);
                    if (epoch === connectionEpoch.current) setAttachments(next);
                  } catch (error) {
                    if (epoch === connectionEpoch.current) setError(String(error));
                  } finally {
                    mutationBusy.current = false;
                    setBusy(false);
                  }
                }}
              />
            </label>
            <div className="attachment-previews">
              {attachments.map((file, index) => (
                <div key={file.name}>
                  <img
                    src={'data:' + file.mime + ';base64,' + file.data}
                    alt={'待发送图片 ' + (index + 1)}
                  />
                  <button
                    disabled={busy}
                    onClick={() => setAttachments((items) => items.filter((item) => item !== file))}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
            <div className="composer-row">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={host ? '输入消息，按 Enter 发送' : '请先选择电脑'}
                disabled={!connected || busy}
              />
              {activeTurn ? (
                <button onClick={() => void interrupt()}>停止</button>
              ) : (
                <button
                  onClick={() => void send()}
                  disabled={
                    !connected || busy || receiptBlocked || (!input.trim() && !attachments.length)
                  }
                >
                  {busy ? '处理中…' : '发送'}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

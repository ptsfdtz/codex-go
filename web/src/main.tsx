import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { api, installationId } from './cloud';
import { Bridge } from './transport/bridge';
import { PairHost } from './PairHost';
import { AccountPassword } from './AccountPassword';
import { loadGrant, type HostGrant } from './host-book';

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
type HistoryEntry = { turnId?: string; item?: { id?: string; [key: string]: unknown } };
type HistoryPage = {
  data?: HistoryEntry[];
  nextCursor?: string;
  resource?: {
    cursor?: string | null;
    sha256?: string;
    bytes?: number;
    chunkBytes?: number;
    turnId?: string;
    itemId?: string;
  } | null;
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

function historyText(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return String(item ?? '');
  const value = item as Record<string, unknown>;
  for (const key of ['text', 'content', 'message', 'summary'])
    if (typeof value[key] === 'string') return value[key];
  if (Array.isArray(value.content))
    return value.content.map(historyText).filter(Boolean).join('\n');
  return JSON.stringify(item, null, 2);
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

function eventText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const value = payload as Record<string, unknown>;
  for (const key of ['delta', 'text', 'content', 'summary'])
    if (typeof value[key] === 'string') return value[key];
  if (value.item) return eventText(value.item);
  return '';
}

function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [scope, setScope] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [pairHost, setPairHost] = useState<Host>();
  const connectionEpoch = useRef(0);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [host, setHost] = useState<Host>();
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [session, setSession] = useState<string>();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | undefined>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [input, setInput] = useState('');
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

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    api('/api/v1/web/session')
      .then((value) => {
        setScope(`${value.accountId}:${value.cloudDeviceId}`);
        setMustChangePassword(value.mustChangePassword === true);
        setSignedIn(true);
      })
      .catch(() => setSignedIn(false));
  }, []);
  useEffect(() => {
    if (!signedIn || mustChangePassword) return;
    Promise.all([
      api<{ hosts: Host[] }>('/api/v1/hosts'),
      api<{ devices: Device[] }>('/api/v1/devices'),
    ])
      .then(([hostValue, deviceValue]) => {
        setHosts(hostValue.hosts || []);
        setDevices(deviceValue.devices || []);
      })
      .catch((error) => setError(String(error)));
  }, [signedIn, mustChangePassword]);
  useEffect(() => {
    if (!bridge.current || !session) {
      setHistory([]);
      setHistoryCursor(undefined);
      setLiveText('');
      return;
    }
    let cancelled = false;
    void historyPage(bridge.current, session)
      .then((value) => {
        if (!cancelled) {
          setHistory([...(value.data || [])].reverse());
          setHistoryCursor(value.nextCursor);
        }
      })
      .catch((error) => {
        if (!cancelled) setError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(
    () => () => {
      connectionEpoch.current++;
      bridge.current?.close();
      if (refreshTimer.current !== undefined) clearTimeout(refreshTimer.current);
    },
    [],
  );

  async function refresh() {
    if (!bridge.current) return;
    const value = bridge.current;
    const epoch = connectionEpoch.current;
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
      const page = await historyPage(value, id);
      if (epoch === connectionEpoch.current && id === sessionRef.current) {
        setHistory([...(page.data || [])].reverse());
        setHistoryCursor(page.nextCursor);
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

  async function connect(next: Host, paired?: HostGrant) {
    const epoch = ++connectionEpoch.current;
    setError('');
    setBusy(true);
    setConnected(false);
    bridge.current?.close();
    bridge.current = undefined;
    historyResourceCache.current.clear();
    setSession(undefined);
    setSnapshot({});
    setHistory([]);
    setHistoryCursor(undefined);
    setLiveText('');
    setHost(next);
    setPairHost(undefined);
    const value = new Bridge(scope);
    try {
      const grant = paired || (await loadGrant(scope, next.hostId));
      if (epoch !== connectionEpoch.current) return;
      if (!grant) {
        setPairHost(next);
        return;
      }
      await value.connect(grant);
      if (epoch !== connectionEpoch.current) {
        value.close();
        return;
      }
      const snap = await value.request<Snapshot>('snapshot.get', {});
      if (epoch !== connectionEpoch.current) {
        value.close();
        return;
      }
      bridge.current = value;
      setHost(next);
      setSnapshot(snap);
      setSelectedProject(snap.projects?.[0]?.projectId || '');
      const selectedSession = snap.sessions?.[0]?.sessionId;
      setSession(selectedSession);
      setActiveTurn(
        snap.turns?.find(
          (turn) =>
            turn.sessionId === selectedSession &&
            ['queued', 'running', 'waitingApproval'].includes(turn.status || ''),
        )?.turnId,
      );
      setLiveText('');
      setConnected(true);
      void value
        .request<{ models?: Model[] }>('models.list', {})
        .then((result) => {
          if (epoch === connectionEpoch.current) setModels(result.models || []);
        })
        .catch(() => {
          if (epoch === connectionEpoch.current) setModels([]);
        });
      value.onEvent((packet) => {
        if (epoch !== connectionEpoch.current) return;
        if (packet.type === 'closed') {
          setConnected(false);
          setError('电脑连接已断开');
          return;
        }
        if (packet.type === 'receipt') {
          setError(`上一条操作已核对：${packet.payload?.status || '未知状态'}，请查看会话状态`);
          scheduleRefresh();
          return;
        }
        if (packet.type === 'event') {
          if (packet.sessionId && packet.sessionId !== sessionRef.current) {
            scheduleRefresh();
            return;
          }
          if (packet.action?.includes('turn.progress')) {
            const text = eventText(packet.payload);
            if (text) setLiveText((value) => value + text);
          }
          if (
            packet.action?.includes('turn.completed') ||
            packet.action?.includes('turn.failed') ||
            packet.action?.includes('turn.interrupted')
          ) {
            setActiveTurn(undefined);
            setLiveText('');
          }
          scheduleRefresh();
        }
      });
    } catch (error) {
      value.close();
      if (epoch === connectionEpoch.current) {
        setConnected(false);
        setError(String(error));
      }
    } finally {
      if (epoch === connectionEpoch.current) setBusy(false);
    }
  }

  async function loadOlderHistory() {
    if (!bridge.current || !session || !historyCursor || historyLoading) return;
    const epoch = connectionEpoch.current;
    const id = session;
    setHistoryLoading(true);
    try {
      const page = await historyPage(bridge.current, session, historyCursor);
      if (epoch !== connectionEpoch.current || id !== sessionRef.current) return;
      setHistory((items) => [[...(page.data || [])].reverse(), ...items].flat());
      setHistoryCursor(page.nextCursor);
    } catch (error) {
      if (epoch === connectionEpoch.current && id === sessionRef.current) setError(String(error));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function send() {
    if (!bridge.current || !input.trim() || busy) return;
    const text = input.trim();
    setInput('');
    setLiveText('');
    setBusy(true);
    try {
      let id = session;
      if (!id) {
        const created = await bridge.current.request<{ session?: Session }>('sessions.create', {
          projectId: selectedProject || snapshot.projects?.[0]?.projectId,
          title: text.slice(0, 80),
        });
        id = created.session?.sessionId;
        if (!id) throw new Error('电脑没有返回会话标识');
        setSession(id);
      }
      const payload: Record<string, unknown> = { sessionId: id, text };
      if (model) payload.model = model;
      if (effort) payload.effort = effort;
      const result = await bridge.current.request<{ turn?: Turn }>('turn.start', payload);
      setActiveTurn(result.turn?.turnId);
      await refresh();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function interrupt() {
    if (!bridge.current || !session || !activeTurn) return;
    try {
      await bridge.current.request('turn.interrupt', { sessionId: session, turnId: activeTurn });
      setActiveTurn(undefined);
      await refresh();
    } catch (error) {
      setError(String(error));
    }
  }

  async function decide(
    approval: Approval,
    decision: string,
    answers?: Record<string, { answers: string[] }>,
  ) {
    if (!bridge.current) return;
    try {
      await bridge.current.request('approvals.decide', {
        sessionId: approval.sessionId,
        turnId: approval.turnId,
        approvalId: approval.approvalId,
        decision,
        ...(answers ? { answers } : {}),
      });
      await refresh();
    } catch (error) {
      setError(String(error));
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
          {connected ? '已连接' : '未连接'}
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
                setLiveText('');
                setSession(undefined);
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
                setLiveText('');
                setSession(item.sessionId);
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
          {pairHost && (
            <PairHost
              key={pairHost.hostId}
              hostId={pairHost.hostId}
              scope={scope}
              onPaired={(grant) => {
                setPairHost(undefined);
                void connect(pairHost, grant);
              }}
              onCancel={() => setPairHost(undefined)}
            />
          )}
          <div className="conversation-head">
            <div>
              <h1>{host?.displayName || '选择一台电脑'}</h1>
              <p>{current?.title || '云端会话'}</p>
            </div>
            {host && (
              <button
                className="ghost"
                disabled={busy}
                onClick={() => {
                  connectionEpoch.current++;
                  bridge.current?.close();
                  bridge.current = undefined;
                  setConnected(false);
                  setPairHost(host);
                }}
              >
                重新配对
              </button>
            )}
            {error && <span className="error">{error}</span>}
          </div>
          {(snapshot.approvals || []).map((approval, index) => (
            <ApprovalCard
              approval={approval}
              onDecide={decide}
              key={approval.approvalId || index}
            />
          ))}
          <div className="timeline">
            {historyCursor && (
              <button
                className="ghost history-more"
                onClick={() => void loadOlderHistory()}
                disabled={historyLoading}
              >
                {historyLoading ? '加载中…' : '加载更早记录'}
              </button>
            )}
            {history.map((entry, index) => {
              const item = entry.item || {};
              return (
                <article className="turn" key={`${entry.turnId || 'item'}-${index}`}>
                  <div className="role">
                    {item.type === 'userMessage' || item.role === 'user' ? '你' : 'Codex'}
                  </div>
                  <pre>{historyText(item)}</pre>
                </article>
              );
            })}
            {liveText && (
              <article className="turn live">
                <div className="role">Codex · 输出中</div>
                <pre>{liveText}</pre>
              </article>
            )}
            {!history.length && !liveText && (
              <div className="empty">连接电脑后开始一段新的 Codex 会话。</div>
            )}
          </div>
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
                <button onClick={() => void send()} disabled={!connected || busy || !input.trim()}>
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

import { MotionPresence, useSidebarMotion } from './motion';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';
import { api, installationId, accountEvent } from './cloud';
import { Bridge } from './transport/bridge';
import { AccountPassword } from './AccountPassword';
import type { HostGrant } from './host-book';
import { contentText, RichContent } from './RichContent';
import { Timeline } from './Timeline';
import { historyKey, mergeHistory, type HistoryEntry } from './history';
import { applyProgress, historyError, mergeHistorySnapshot, finalItem } from './conversation';

import type {
  Host,
  Device,
  Model,
  Session,
  Turn,
  Approval,
  Snapshot,
  Capabilities,
  Draft,
  Request,
} from './workspace';
import { emptyDraft, canManage } from './workspace';
import { Sidebar } from './features/Sidebar';
import { Composer } from './features/Composer';
import { ApprovalCard, AsyncQuestions } from './features/Questions';
import { ComposerStatus } from './features/ComposerStatus';
import { TurnChanges } from './features/TurnChanges';
import { projectRelativePath } from './features/turn-changes';
import { turnOptions, resources } from './features/composer-input';
import {
  SessionPanel,
  GoalPanel,
  FilesPanel,
  GitPanel,
  SkillsPanel,
  QueuePanel,
  ProjectsPanel,
  ConfigurationPanel,
  RetentionPanel,
  DiagnosticsPanel,
  AccountPanel,
} from './features/Panels';
import { IconButton, Modal, DataFields } from './ui';
import {
  Menu,
  ChevronDown,
  Computer,
  MoreHorizontal,
  MessageSquarePlus,
  Settings,
  FileDiff,
  FolderOpen,
  Search,
  History,
  Clock,
  EyeOff,
  Target,
  Copy,
  Quote,
  Pencil,
  RotateCcw,
  GitFork,
  LogOut,
  RefreshCw,
  X,
  FileText,
  Keyboard,
  Database,
  SlidersHorizontal,
} from 'lucide-react';
import { ReconnectLoop, connectionLabels, connectionError } from './transport/reconnect';
import type { ConnectionState } from './transport/reconnect';
import {
  EventCheckpoint,
  missedEvents,
  RebaseRequired,
  changesDirectory,
} from './transport/resume';
import type { Packet } from './transport/bridge';
import { TaskProgress } from './features/TaskProgress';
import { InstallApp } from './features/InstallApp';

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
        <InstallApp />
      </form>
    </main>
  );
}

export function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [scope, setScope] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const connectionEpoch = useRef(0);
  const accountEpoch = useRef(0);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [directoryFailure, setDirectoryFailure] = useState('');
  const [host, setHost] = useState<Host>();
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [session, setSession] = useState<string>();
  const [history, setHistoryState] = useState<HistoryEntry[]>([]);
  const [viewRevision, setViewRevision] = useState(0);
  const historyRef = useRef(history);
  function setHistory(update: React.SetStateAction<HistoryEntry[]>, progress = false) {
    const next = typeof update === 'function' ? update(historyRef.current) : update;
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistoryState(next);
    if (progress) setViewRevision((revision) => revision + 1);
  }
  const renderedHistory = history;
  const [historyCursor, setHistoryCursor] = useState<string | undefined>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFailure, setHistoryFailure] = useState('');
  const [historyReady, setHistoryReady] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const sending = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeTurn, setActiveTurn] = useState<string>();
  const managedActiveTurn = useRef<string | undefined>(undefined);
  const [selectedProject, setSelectedProject] = useState('');

  const [models, setModels] = useState<Model[]>([]);
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('stopped');
  const [connectionFailure, setConnectionFailure] = useState('');
  const [upstreamRetry, setUpstreamRetry] = useState('');
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [sidebarOpen, setSidebarOpen] = useState(() => matchMedia('(min-width:761px)').matches);
  const conversationElement = useSidebarMotion(sidebarOpen);
  const [panel, setPanel] = useState('');
  const [manageSession, setManageSession] = useState<Session>();
  const [menu, setMenu] = useState(false),
    [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all');
  const [find, setFind] = useState(''),
    [findIndex, setFindIndex] = useState(0);
  const [mask, setMask] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('agentdeck.web.theme') || 'system');
  const [permission, setPermission] = useState('workspace'),
    [fullConfirm, setFullConfirm] = useState(false);
  const [receiptBlocked, setReceiptBlocked] = useState(false);
  const [messageAction, setMessageAction] = useState<{ entry: HistoryEntry; kind: string }>();
  const [editText, setEditText] = useState('');
  const [hostFingerprint, setHostFingerprint] = useState(''),
    [hostLabel, setHostLabel] = useState(''),
    [lastSynced, setLastSynced] = useState('');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [notification, setNotification] = useState(false);
  const notificationRef = useRef(notification);
  notificationRef.current = notification;
  const [statusRevision, setStatusRevision] = useState(0);
  const [observedUsage, setObservedUsage] =
    useState<Parameters<typeof ComposerStatus>[0]['observedUsage']>();
  const [filePath, setFilePath] = useState<string>();
  const reconnect = useRef<ReconnectLoop>(undefined);
  const connectRef = useRef<(h: Host) => void>(undefined);
  const hostRef = useRef(host);
  hostRef.current = host;
  const draftKey = JSON.stringify([scope, host?.hostId, session || `new:${selectedProject}`]);
  const draft = drafts[draftKey] || emptyDraft();
  function updateDraft(change: Partial<Draft>) {
    setDrafts((items) => ({
      ...items,
      [draftKey]: { ...(items[draftKey] || emptyDraft()), ...change },
    }));
  }
  const supports = (key: string) => capabilities.features?.[key] === true;
  const bridge = useRef<Bridge | undefined>(undefined);
  const sessionRef = useRef<string | undefined>(undefined);
  const refreshTimer = useRef<number | undefined>(undefined);
  const historyResourceCache = useRef(new Map<string, HistoryEntry>());
  const timeline = useRef<Timeline>(null);
  const historyStarted = useRef(false);
  const historyVersion = useRef(0);
  const refreshRunning = useRef(false);
  const refreshAgain = useRef(false);
  const refreshNeedsHistory = useRef(false);
  const olderRequest = useRef(false);
  const uncertainBaseline = useRef(new Set<string>());
  const activityVersion = useRef(0);
  const terminalVersion = useRef(0);
  const heartbeat = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  function selectSession(id?: string, persist = true) {
    if (id && id === sessionRef.current) return;
    historyVersion.current++;
    activityVersion.current++;
    uncertainBaseline.current.clear();
    sessionRef.current = id;
    historyStarted.current = false;
    setSession(id);
    setHistory([]);
    setHistoryCursor(undefined);
    setHistoryLoading(false);
    setHistoryFailure('');
    setHistoryReady(false);
    setUpstreamRetry('');
    setActiveTurn(undefined);
    managedActiveTurn.current = undefined;
    setError('');
    setPanel('');
    setMessageAction(undefined);
    setManageSession(undefined);
    setObservedUsage(undefined);
    if (persist && hostRef.current)
      localStorage.setItem(`agentdeck.web.selection.${scope}.${hostRef.current.hostId}`, id || '');
  }

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

  function publishLatestPage(data: HistoryEntry[], before: HistoryEntry[], terminal: number) {
    const incoming = [...data].reverse();
    const prior = new Map(before.map((entry) => [historyKey(entry), entry]));
    const live = new Map(historyRef.current.map((entry) => [historyKey(entry), entry]));
    for (const entry of incoming) {
      const key = historyKey(entry),
        changed = live.get(key);
      if (finalItem(entry) || finalItem(changed)) uncertainBaseline.current.delete(key);
      else if (changed && changed !== prior.get(key)) uncertainBaseline.current.add(key);
    }
    setHistory((items) => mergeHistorySnapshot(items, incoming, before), true);
    if (terminal !== terminalVersion.current && uncertainBaseline.current.size) {
      uncertainBaseline.current.clear();
      scheduleRefresh(true);
    }
  }
  const current = useMemo(
    () => snapshot.sessions?.find((item) => item.sessionId === session),
    [snapshot.sessions, session],
  );
  const request = useMemo<Request>(() => {
    const connection = bridge.current,
      epoch = connectionEpoch.current;
    return async <T,>(action: string, payload: Record<string, unknown> = {}) => {
      if (
        !connection ||
        !connected ||
        epoch !== connectionEpoch.current ||
        connection !== bridge.current
      )
        throw new Error('电脑连接已变化，请重新打开');
      try {
        const result = await connection.request<T>(action, payload);
        if (epoch !== connectionEpoch.current) throw new Error('电脑已经切换');
        return result;
      } finally {
        if (epoch === connectionEpoch.current) setReceiptBlocked(connection.awaitingReceipt);
      }
    };
  }, [connected, host?.hostId]);
  useEffect(() => {
    const media = matchMedia('(max-width:760px)');
    const changed = (event: MediaQueryListEvent) => setSidebarOpen(!event.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('agentdeck.web.theme', theme);
  }, [theme]);
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'hidden') return;
      reconnect.current?.wake();
      const connection = bridge.current;
      if (connection && document.visibilityState === 'visible')
        void connection
          .request('system.hello', { client: 'AgentDeck Web/0.3.0', version: 1 })
          .then(() => connection.reconcile())
          .then(() => scheduleRefresh())
          .catch(() => connection.close());
    };
    const offline = () => bridge.current?.close();
    const receiptChanged = (event: StorageEvent) => {
      if (event.key?.startsWith('agentdeck.web.receipts.') && bridge.current)
        setReceiptBlocked(bridge.current.awaitingReceipt);
    };
    const accountChanged = () => {
      const generation = ++accountEpoch.current;
      reconnect.current?.stop();
      connectionEpoch.current++;
      bridge.current?.close();
      bridge.current = undefined;
      setConnected(false);
      setBusy(false);
      setFullConfirm(false);
      setPermission('workspace');
      setHost(undefined);
      hostRef.current = undefined;
      setHosts([]);
      setDevices([]);
      setCapabilities({});
      setModels([]);
      setDrafts({});
      selectSession(undefined, false);
      setConnectionState('stopped');
      setConnectionFailure('');
      setSnapshot({});
      setPanel('');
      setSignedIn(null);
      void api('/api/v1/web/session', {}, false)
        .then((value) => {
          if (generation !== accountEpoch.current) return;
          setScope(`${value.accountId}:${value.cloudDeviceId}`);
          setMustChangePassword(value.mustChangePassword === true);
          setSignedIn(true);
        })
        .catch(() => {
          if (generation === accountEpoch.current) setSignedIn(false);
        });
    };
    window.addEventListener('storage', receiptChanged);
    window.addEventListener('offline', offline);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener(accountEvent, accountChanged);
    return () => {
      window.removeEventListener('storage', receiptChanged);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener(accountEvent, accountChanged);
    };
  }, []);
  useEffect(() => {
    if (panel === 'search') document.getElementById('session-search')?.focus();
  }, [panel]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPanel('search');
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setPanel('find');
      }
      if (e.altKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const sessions = snapshot.sessions?.filter((s) => s.archived !== 1) || [];
        const index = sessions.findIndex((s) => s.sessionId === session);
        const next = sessions[index + (e.key === 'ArrowLeft' ? -1 : 1)];
        if (next) chooseSession(next);
      }
      if (e.key === 'Escape') {
        setMenu(false);
        setWorkspaceMenu(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [snapshot.sessions, session, scope]);

  useEffect(() => {
    const generation = accountEpoch.current;
    api('/api/v1/web/session')
      .then((value) => {
        if (generation !== accountEpoch.current) return;
        setScope(`${value.accountId}:${value.cloudDeviceId}`);
        setMustChangePassword(value.mustChangePassword === true);
        setSignedIn(true);
      })
      .catch(() => {
        if (generation === accountEpoch.current) setSignedIn(false);
      });
  }, []);
  useEffect(() => {
    if (!signedIn || mustChangePassword) return;
    let cancelled = false,
      pending = false;
    const generation = accountEpoch.current;
    const readDirectory = async () => {
      if (pending) return;
      pending = true;
      await Promise.all([
        api<{ hosts: Host[] }>('/api/v1/hosts'),
        api<{ devices: Device[] }>('/api/v1/devices'),
      ])
        .then(([hostValue, deviceValue]) => {
          if (cancelled || generation !== accountEpoch.current) return;
          setHosts(hostValue.hosts || []);
          setDevices(deviceValue.devices || []);
          setDirectoryFailure('');
          if (
            hostRef.current &&
            !hostValue.hosts?.some((item) => item.hostId === hostRef.current?.hostId)
          ) {
            reconnect.current?.stop();
            connectionEpoch.current++;
            bridge.current = undefined;
            hostRef.current = undefined;
            setHost(undefined);
            setConnected(false);
            selectSession(undefined, false);
            setConnectionState('stopped');
            setConnectionFailure('');
            setSnapshot({});
          }
          const legacy = JSON.parse(
            localStorage.getItem(`agentdeck.web.selection.${scope}`) || 'null',
          );
          const saved = localStorage.getItem(`agentdeck.web.host.${scope}`) || legacy?.hostId;
          if (
            legacy?.hostId &&
            legacy?.sessionId &&
            !localStorage.getItem(`agentdeck.web.selection.${scope}.${legacy.hostId}`)
          )
            localStorage.setItem(
              `agentdeck.web.selection.${scope}.${legacy.hostId}`,
              legacy.sessionId,
            );
          const previous =
            hostValue.hosts?.find((item) => item.hostId === saved) ||
            (hostValue.hosts?.length === 1 ? hostValue.hosts[0] : undefined);
          if (previous && !hostRef.current) connectRef.current?.(previous);
        })
        .catch((error) => {
          if (!cancelled && generation === accountEpoch.current)
            setDirectoryFailure(
              /TimeoutError|timed out/i.test(String(error))
                ? '云端电脑列表刷新超时，显示的是上次状态；正在重试。'
                : '云端电脑列表暂时无法刷新，显示的是上次状态；正在重试。',
            );
        })
        .finally(() => {
          pending = false;
        });
    };
    void readDirectory();
    const timer = window.setInterval(() => void readDirectory(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [signedIn, mustChangePassword, scope]);
  useEffect(() => {
    if (!bridge.current || !session || !connected || historyStarted.current) return;
    let cancelled = false;
    const version = historyVersion.current;
    const epoch = connectionEpoch.current;
    const connection = bridge.current;
    const before = historyRef.current,
      terminal = terminalVersion.current;
    void historyPage(connection, session)
      .then((value) => {
        if (
          !cancelled &&
          connection === bridge.current &&
          epoch === connectionEpoch.current &&
          version === historyVersion.current
        ) {
          publishLatestPage(value.data, before, terminal);
          if (!historyStarted.current) setHistoryCursor(value.nextCursor);
          historyStarted.current = true;
          setHistoryReady(true);
          setHistoryFailure('');
        }
      })
      .catch((error) => {
        if (
          !cancelled &&
          connection === bridge.current &&
          epoch === connectionEpoch.current &&
          version === historyVersion.current
        ) {
          setHistoryFailure(historyError(error));
          setHistoryReady(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, connected]);

  useEffect(() => {
    if (!connected || !session || capabilities.features?.externalThreadObservation !== true) return;
    let active = true;
    void request('sessions.observe', { sessionId: session }).catch((error) => {
      if (active) setError(String(error));
    });
    return () => {
      active = false;
    };
  }, [connected, session, capabilities.features?.externalThreadObservation, request]);

  useEffect(() => {
    if (!connected || !session || !capabilities.features?.latestUpstreamTurn) return;
    let cancelled = false;
    const version = activityVersion.current;
    void request<{ turn?: { upstreamTurnId?: string; status?: string } }>('turn.latest', {
      sessionId: session,
      contractVersion: 1,
    })
      .then((value) => {
        if (cancelled || version !== activityVersion.current) return;
        const queued = snapshot.turns?.find(
          (turn) => turn.sessionId === session && turn.status === 'queued',
        );
        const local = snapshot.turns?.find(
          (turn) =>
            turn.sessionId === session && turn.upstreamTurnId === value.turn?.upstreamTurnId,
        );
        managedActiveTurn.current =
          value.turn?.status === 'inProgress' ? local?.turnId : queued?.turnId;
        if (value.turn?.status && value.turn.status !== 'inProgress') setUpstreamRetry('');
        setActiveTurn(
          value.turn?.status === 'inProgress'
            ? local?.turnId || value.turn.upstreamTurnId
            : queued?.turnId,
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connected, session, capabilities.features?.latestUpstreamTurn, request]);

  useEffect(
    () => () => {
      connectionEpoch.current++;
      reconnect.current?.stop();
      bridge.current?.close();
      if (heartbeat.current) clearInterval(heartbeat.current);
      if (refreshTimer.current !== undefined) clearTimeout(refreshTimer.current);
    },
    [],
  );

  async function refresh(includeHistory = true) {
    if (!bridge.current) return;
    if (refreshRunning.current) {
      refreshAgain.current = true;
      refreshNeedsHistory.current ||= includeHistory;
      return;
    }
    refreshRunning.current = true;
    const value = bridge.current;
    const epoch = connectionEpoch.current;
    const version = historyVersion.current;
    const activity = activityVersion.current;
    let readingHistory = false;
    try {
      const next = await value.request<Snapshot>('snapshot.get', {});
      if (epoch !== connectionEpoch.current || value !== bridge.current) return;
      setSnapshot(next);
      setLastSynced(new Date().toISOString());
      const id = sessionRef.current;
      const running = next.turns?.find(
        (turn) =>
          turn.sessionId === id &&
          ['queued', 'running', 'waitingApproval'].includes(turn.status || ''),
      );
      if (activity === activityVersion.current) {
        const previousManaged = managedActiveTurn.current;
        managedActiveTurn.current = running?.turnId;
        setActiveTurn(
          (current) => running?.turnId || (current === previousManaged ? undefined : current),
        );
      }
      if (id && includeHistory) {
        readingHistory = true;
        const before = historyRef.current,
          terminal = terminalVersion.current;
        const page = await historyPage(value, id);
        if (
          epoch === connectionEpoch.current &&
          value === bridge.current &&
          id === sessionRef.current &&
          version === historyVersion.current
        ) {
          publishLatestPage(page.data, before, terminal);
          if (!historyStarted.current) setHistoryCursor(page.nextCursor);
          historyStarted.current = true;
          setHistoryReady(true);
          setHistoryFailure('');
        }
      }
    } catch (error) {
      if (
        epoch === connectionEpoch.current &&
        value === bridge.current &&
        version === historyVersion.current
      ) {
        if (readingHistory) {
          setHistoryFailure(historyError(error));
          setHistoryReady(false);
        } else setError(`状态同步失败：${String(error)}`);
      }
    } finally {
      refreshRunning.current = false;
      if (refreshAgain.current) {
        refreshAgain.current = false;
        const needsHistory = refreshNeedsHistory.current;
        refreshNeedsHistory.current = false;
        scheduleRefresh(needsHistory);
      }
    }
  }

  function scheduleRefresh(includeHistory = false) {
    refreshNeedsHistory.current ||= includeHistory;
    if (refreshTimer.current !== undefined) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = undefined;
      const needsHistory = refreshNeedsHistory.current;
      refreshNeedsHistory.current = false;
      void refresh(needsHistory).catch(() => undefined);
    }, 1000);
  }

  async function connect(next: Host) {
    const sameHost = hostRef.current?.hostId === next.hostId;
    reconnect.current?.stop();
    const epoch = ++connectionEpoch.current;
    bridge.current?.close();
    bridge.current = undefined;
    if (refreshTimer.current !== undefined) clearTimeout(refreshTimer.current);
    refreshTimer.current = undefined;
    refreshAgain.current = false;
    refreshNeedsHistory.current = false;
    setConnected(false);
    setBusy(true);
    setError('');
    setConnectionFailure('');
    setUpstreamRetry('');
    if (!sameHost) {
      setPanel('');
      setCapabilities({});
      setModels([]);
      setPermission('workspace');
      setHostLabel(localStorage.getItem('agentdeck.web.label.' + scope + '.' + next.hostId) || '');
      setHostFingerprint('');
      setLastSynced('');
      historyResourceCache.current.clear();
      selectSession(undefined, false);
      setSnapshot({});
    }
    setHost(next);
    hostRef.current = next;
    const checkpoint = new EventCheckpoint();
    let configuration: { caps: Capabilities; models: Model[] } | undefined;
    let upstreamRetryTurn = '';

    function consume(packets: Packet[], baselineKeys?: Set<string>) {
      let entries = historyRef.current;
      for (const packet of packets) {
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
              setUpstreamRetry(String(detail?.message || payload.message || 'Codex 正在重试'));
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
          if (
            notificationRef.current &&
            'Notification' in window &&
            Notification.permission === 'granted' &&
            document.visibilityState !== 'visible'
          )
            new Notification('Codex task updated', {
              body: 'Open AgentDeck to review the result.',
            });
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
        if (changesDirectory(packet)) scheduleRefresh(false);
      }
      setHistory(entries, true);
      if (packets.length) setLastSynced(new Date().toISOString());
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
            throw new Error('电脑授权信息无效，请更新 Host');
          setHostFingerprint(grant.fingerprint);
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
              context.closed(new Error(packet.message || '电脑连接已断开'));
              return;
            }
            if (packet.type === 'receipt') {
              setReceiptBlocked(value.awaitingReceipt);
              if (!recovering) scheduleRefresh(false);
              return;
            }
            if (packet.type !== 'event') return;
            buffered.push(packet);
            bufferedBytes += JSON.stringify(packet).length;
            if (buffered.length > 4096 || bufferedBytes > 8 * 1024 * 1024) {
              context.closed(new Error('同步积压过大，正在重新建立连接'));
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
                    error instanceof Error ? error : new Error('Event stream interrupted'),
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
              .request('system.hello', { client: 'AgentDeck Web/0.3.0', version: 1 })
              .then(() => value.reconcile())
              .catch(() => value.close());
          }, 30000);
          const snap = await value.request<Snapshot>('snapshot.get', {});
          if (!configuration) {
            const [caps, modelList] = await Promise.all([
              value.request<Capabilities>('system.capabilities', {}),
              value.request<{ models?: Model[] }>('models.list', {}).catch(() => ({ models: [] })),
            ]);
            configuration = { caps, models: modelList.models || [] };
          }
          if (!context.current() || epoch !== connectionEpoch.current) return;
          setSnapshot(snap);
          setLastSynced(new Date().toISOString());
          setCapabilities(configuration.caps);
          setModels(configuration.models);
          setReceiptBlocked(value.awaitingReceipt);
          const saved =
            sessionRef.current ||
            localStorage.getItem('agentdeck.web.selection.' + scope + '.' + next.hostId);
          const chosen =
            snap.sessions?.find((s) => s.sessionId === saved) ||
            (!saved ? snap.sessions?.find((s) => s.archived !== 1) : undefined);
          setSelectedProject(chosen?.projectId || snap.projects?.[0]?.projectId || '');
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
          else if (state === 'blocked') setConnectionFailure(String(error || '连接需要重新授权'));
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
  connectRef.current = (h) => void connect(h);

  async function loadOlderHistory() {
    if (!bridge.current || !connected || !session || !historyCursor || olderRequest.current) return;
    olderRequest.current = true;
    const epoch = connectionEpoch.current;
    const id = session;
    const version = historyVersion.current;
    const connection = bridge.current;
    timeline.current?.pause();
    setHistoryLoading(true);
    try {
      const page = await historyPage(connection, session, historyCursor);
      if (
        connection !== bridge.current ||
        epoch !== connectionEpoch.current ||
        id !== sessionRef.current ||
        version !== historyVersion.current
      )
        return;
      setHistory((items) => mergeHistory(items, [...page.data].reverse(), 'older'));
      setHistoryCursor(page.nextCursor);
    } catch (error) {
      if (epoch === connectionEpoch.current && version === historyVersion.current)
        setHistoryFailure(historyError(error));
    } finally {
      olderRequest.current = false;
      if (version === historyVersion.current) setHistoryLoading(false);
    }
  }

  async function send(kind?: 'queue' | 'steer') {
    const connection = bridge.current;
    if (
      !connection ||
      !connected ||
      sending.current ||
      (!draft.text.trim() && !draft.attachments.length && !draft.skills.length) ||
      busy ||
      receiptBlocked ||
      (session && !historyReady) ||
      !selectedProject
    )
      return;
    const sourceKey = draftKey,
      source = draft,
      epoch = connectionEpoch.current;
    let targetKey = sourceKey;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      let id = session;
      if (!id) {
        const created = await connection.request<{ session?: Session }>('sessions.create', {
          projectId: selectedProject,
          title: source.text.trim().slice(0, 80) || 'New conversation',
        });
        if (epoch !== connectionEpoch.current) return;
        id = created.session?.sessionId;
        if (!id) throw new Error('电脑没有返回会话标识');
        targetKey = JSON.stringify([scope, host?.hostId, id]);
        setDrafts((items) => ({ ...items, [targetKey]: source }));
        selectSession(id);
      }
      if (epoch !== connectionEpoch.current) return;
      if (activeTurn) {
        if (kind === 'steer') {
          if (source.attachments.length || source.skills.length)
            throw new Error('带资源的消息请加入待发送队列');
          const active = await connection.request<{ upstreamTurnId?: string }>('turn.active', {
            sessionId: id,
          });
          if (!active.upstreamTurnId) throw new Error('当前任务已变化，请刷新核对');
          await connection.request('turn.steer', {
            sessionId: id,
            expectedTurnId: active.upstreamTurnId,
            text: source.text.trim(),
          });
        } else {
          if (!supports('nativeQueue'))
            throw new Error('当前电脑不支持待发送队列，请等待任务完成或选择立即补充');
          if (
            (source.attachments.length && !supports('nativeQueueAttachments')) ||
            (source.skills.length && !supports('nativeQueueSkills'))
          )
            throw new Error('当前电脑不支持队列中的这些资源');
          await connection.request('queue.add', {
            sessionId: id,
            text: source.text.trim(),
            ...resources(source),
          });
        }
      } else {
        const result = await connection.request<{ turn?: Turn }>('turn.start', {
          sessionId: id,
          ...turnOptions(source, permission),
        });
        if (epoch === connectionEpoch.current && sessionRef.current === id) {
          activityVersion.current++;
          managedActiveTurn.current = result.turn?.turnId;
          setActiveTurn(result.turn?.turnId);
        }
      }
      if (epoch !== connectionEpoch.current) return;
      setDrafts((items) => {
        const next = { ...items };
        for (const key of new Set([sourceKey, targetKey]))
          if (next[key] === source)
            next[key] = { ...source, text: '', attachments: [], skills: [] };
        return next;
      });
      await refresh(false);
    } catch (error) {
      if (epoch === connectionEpoch.current) setError(String(error));
    } finally {
      sending.current = false;
      if (epoch === connectionEpoch.current) {
        setBusy(false);
        setReceiptBlocked(connection.awaitingReceipt);
      }
    }
  }

  async function interrupt() {
    if (!bridge.current || !session || !activeTurn || busy || receiptBlocked) return;
    const epoch = connectionEpoch.current,
      connection = bridge.current,
      id = session;
    setBusy(true);
    try {
      if (supports('activeTurnInterruption')) {
        const active = await connection.request<{ upstreamTurnId?: string }>('turn.active', {
          sessionId: id,
        });
        if (!active.upstreamTurnId) throw new Error('任务已变化，请刷新核对');
        await connection.request('turn.interruptActive', {
          sessionId: id,
          expectedTurnId: active.upstreamTurnId,
        });
      } else await connection.request('turn.interrupt', { sessionId: id, turnId: activeTurn });
      await refresh(false);
    } catch (error) {
      if (epoch === connectionEpoch.current) setError(String(error));
    } finally {
      if (epoch === connectionEpoch.current) {
        setBusy(false);
        setReceiptBlocked(connection.awaitingReceipt);
      }
    }
  }

  async function decide(
    approval: Approval,
    decision: string,
    answers?: Record<string, { answers: string[] }>,
  ) {
    if (!bridge.current) throw new Error('电脑连接已断开，请重新连接后核对审批');
    try {
      await bridge.current.request('approvals.decide', {
        sessionId: approval.sessionId,
        turnId: approval.turnId,
        approvalId: approval.approvalId,
        decision,
        ...(answers ? { answers } : {}),
      });
      // A confirmed decision remains accepted even if the following read fails.
      void refresh(false).catch((error) => setError(String(error)));
    } catch (error) {
      setError(String(error));
      throw error;
    } finally {
      setReceiptBlocked(bridge.current?.awaitingReceipt === true);
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

  function chooseSession(item: Session) {
    setSelectedProject(item.projectId || '');
    selectSession(item.sessionId);
    const running = snapshot.turns?.find(
      (t) =>
        t.sessionId === item.sessionId &&
        ['queued', 'running', 'waitingApproval'].includes(t.status || ''),
    );
    managedActiveTurn.current = running?.turnId;
    setActiveTurn(running?.turnId);
    if (matchMedia('(max-width: 760px)').matches) setSidebarOpen(false);
  }
  function newChat() {
    selectSession(undefined);
    setPanel('');
    if (!selectedProject) setSelectedProject(snapshot.projects?.[0]?.projectId || '');
    if (matchMedia('(max-width:760px)').matches) setSidebarOpen(false);
  }
  function openFile(path: string) {
    const relative = projectRelativePath(
      path,
      snapshot.projects?.find((p) => p.projectId === selectedProject)?.canonicalPath,
    );
    if (!relative) {
      setError('该文件不在当前授权项目中，无法预览');
      return;
    }
    setFilePath(relative);
    setPanel('files');
  }
  function openAgent(id: string) {
    const item = snapshot.sessions?.find((s) => s.upstreamThreadId === id);
    if (item) chooseSession(item);
    else setError('此代理会话尚未同步或不在授权项目中');
  }
  function openPanel(name: string) {
    setFilePath(undefined);
    setMenu(false);
    setWorkspaceMenu(false);
    if (name === 'manage') setManageSession(current);
    setPanel(name);
  }
  async function syncIndex() {
    try {
      if (supports('threadIndexRefresh'))
        await request('sessions.refreshIndex', { contractVersion: 1 });
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }
  async function runMessageAction() {
    if (!messageAction || !session || busy || receiptBlocked) return;
    const { entry, kind } = messageAction,
      id = session,
      epoch = connectionEpoch.current;
    setBusy(true);
    try {
      if (kind === 'fork') {
        const result = await request<{ session?: Session }>('sessions.fork', {
          sessionId: id,
          lastTurnId: entry.turnId,
        });
        if (result.session) {
          await refresh();
          if (sessionRef.current === id) chooseSession(result.session);
        }
      } else {
        const latest = await request<{ threadStatus?: string; turn?: { upstreamTurnId?: string } }>(
          'turn.latest',
          { sessionId: id, contractVersion: 1 },
        );
        if (latest.threadStatus !== 'idle' || !latest.turn?.upstreamTurnId)
          throw new Error('请先停止或核对当前任务');
        if (kind === 'revert')
          await request('sessions.revert', {
            sessionId: id,
            beforeTurnId: entry.turnId,
            expectedLastTurnId: latest.turn.upstreamTurnId,
          });
        else
          await request('sessions.revise', {
            sessionId: id,
            beforeTurnId: entry.turnId,
            expectedLastTurnId: latest.turn.upstreamTurnId,
            itemId: entry.item?.id,
            text: editText.trim(),
            permissionMode: permission,
            mode: draft.mode,
            ...(draft.model ? { model: draft.model } : {}),
            ...(draft.effort ? { effort: draft.effort } : {}),
          });
        if (epoch === connectionEpoch.current && sessionRef.current === id) {
          historyVersion.current++;
          setHistory([]);
          setHistoryCursor(undefined);
          historyStarted.current = false;
          await refresh();
        }
      }
      if (epoch === connectionEpoch.current) setMessageAction(undefined);
    } catch (e) {
      if (epoch === connectionEpoch.current) setError(String(e));
    } finally {
      if (epoch === connectionEpoch.current) setBusy(false);
    }
  }
  const [settingsTab, setSettingsTab] = useState('general');
  const titles: Record<string, string> = {
    computers: '电脑与设备',
    settings: '设置',
    manage: '管理会话',
    goal: '会话目标',
    files: '项目文件',
    git: '工作区改动',
    skills: '技能',
    queue: '待发送消息',
    projects: '项目',
    drafts: '未发送草稿',
    find: '在会话中查找',
    search: '搜索会话',
    history: '会话历史',
  };
  const targetSession =
    snapshot.sessions?.find((s) => s.sessionId === manageSession?.sessionId) || current;
  const matches = renderedHistory.filter(
    (entry) => find.trim() && contentText(entry.item).toLowerCase().includes(find.toLowerCase()),
  );
  const matchingSessions = (snapshot.sessions || []).filter((s) =>
    `${s.title || ''} ${snapshot.projects?.find((p) => p.projectId === s.projectId)?.name || ''}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  function jumpTo(entry: HistoryEntry) {
    setPanel('');
    timeline.current?.pause();
    requestAnimationFrame(() => {
      const key = historyKey(entry);
      const node = Array.from(document.querySelectorAll<HTMLElement>('[data-history-key]')).find(
        (n) => n.dataset.historyKey === key,
      );
      node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      node?.classList.add('search-highlight');
      setTimeout(() => node?.classList.remove('search-highlight'), 2000);
    });
  }

  if (signedIn === null) return <main className="center">加载中…</main>;
  if (!signedIn) return <Login onLogin={() => location.reload()} />;
  if (mustChangePassword) return <AccountPassword />;
  return (
    <div className={`shell ${sidebarOpen ? 'with-sidebar' : ''} ${mask ? 'display-masked' : ''}`}>
      <Sidebar
        sessions={snapshot.sessions || []}
        projects={snapshot.projects || []}
        host={host ? { ...host, displayName: hostLabel || host.displayName } : undefined}
        sessionId={session}
        projectId={selectedProject}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNew={newChat}
        onSelect={chooseSession}
        onProject={(id) => {
          setSelectedProject(id);
          selectSession(undefined);
        }}
        onRefresh={() => void syncIndex()}
        onSettings={() => openPanel('settings')}
        onComputers={() => openPanel('computers')}
        onManage={(s) => {
          setManageSession(s);
          openPanel('manage');
          setManageSession(s);
        }}
        onSearch={() => openPanel('search')}
        filter={filter}
        setFilter={setFilter}
      />
      <section className="conversation" ref={conversationElement}>
        <header className="topbar">
          <IconButton
            icon={Menu}
            label="打开会话列表"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={sidebarOpen ? 'rail-toggle' : ''}
          />
          <div className="workspace-anchor">
            <button className="workspace-title" onClick={() => setWorkspaceMenu(!workspaceMenu)}>
              <span>{current?.title || 'AgentDeck'}</span>
              <ChevronDown size={16} />
            </button>
            <MotionPresence>
              {workspaceMenu && (
                <>
                  <button
                    className="menu-scrim"
                    aria-label="关闭项目菜单"
                    onClick={() => setWorkspaceMenu(false)}
                  />
                  <div className="popover workspace-menu">
                    <button onClick={() => openPanel('computers')}>
                      <Computer size={18} />
                      {host?.displayName || '连接电脑'}
                    </button>
                    <p className="menu-caption">{connected ? 'Connected' : 'Disconnected'}</p>
                    <hr />
                    {snapshot.projects?.map((p) => (
                      <button
                        key={p.projectId}
                        onClick={() => {
                          setSelectedProject(p.projectId);
                          selectSession(undefined);
                          setWorkspaceMenu(false);
                        }}
                      >
                        <FolderOpen size={17} />
                        {p.name}
                      </button>
                    ))}
                    {connected && (
                      <button onClick={() => openPanel('projects')}>
                        <FolderOpen size={17} />
                        管理项目
                      </button>
                    )}
                  </div>
                </>
              )}
            </MotionPresence>
          </div>
          <span
            className={`connection ${connected ? 'online-text' : ''}`}
            data-connection-state={connectionState}
          >
            <span className={`dot ${connected || connectionState === 'syncing' ? 'online' : ''}`} />
            {connectionLabels[connectionState]}
          </span>
          <IconButton icon={MessageSquarePlus} label="新建会话" onClick={newChat} />
          <IconButton icon={Computer} label="切换电脑" onClick={() => openPanel('computers')} />
          <div className="menu-anchor">
            <IconButton icon={MoreHorizontal} label="更多操作" onClick={() => setMenu(!menu)} />
            <MotionPresence>
              {menu && (
                <>
                  <button
                    className="menu-scrim"
                    aria-label="关闭更多菜单"
                    onClick={() => setMenu(false)}
                  />
                  <div className="popover top-menu" role="menu">
                    <button role="menuitem" onClick={() => openPanel('drafts')}>
                      <FileText size={18} />
                      未发送草稿
                    </button>
                    {connected && (
                      <>
                        {supports('gitRead') && selectedProject && (
                          <button role="menuitem" onClick={() => openPanel('git')}>
                            <FileDiff size={18} />
                            审查工作区改动
                          </button>
                        )}
                        {supports('projectFileBrowser') && selectedProject && (
                          <button role="menuitem" onClick={() => openPanel('files')}>
                            <FolderOpen size={18} />
                            浏览项目文件
                          </button>
                        )}
                      </>
                    )}
                    {current && (
                      <>
                        <hr />
                        <button role="menuitem" onClick={() => openPanel('find')}>
                          <Search size={18} />
                          在会话中查找
                        </button>
                        <button role="menuitem" onClick={() => openPanel('history')}>
                          <History size={18} />
                          会话历史
                        </button>
                        {supports('nativeQueue') && (
                          <button role="menuitem" onClick={() => openPanel('queue')}>
                            <Clock size={18} />
                            待发送消息
                          </button>
                        )}
                        {supports('sessionGoalView') && (
                          <button role="menuitem" onClick={() => openPanel('goal')}>
                            <Target size={18} />
                            会话目标
                          </button>
                        )}
                        {supports('sessionManagement') && (
                          <button role="menuitem" onClick={() => openPanel('manage')}>
                            <MoreHorizontal size={18} />
                            管理当前会话
                          </button>
                        )}
                      </>
                    )}
                    <hr />
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMask(!mask);
                        setMenu(false);
                      }}
                    >
                      <EyeOff size={18} />
                      {mask ? '显示文字' : '遮盖文字'}
                    </button>
                    <button role="menuitem" onClick={() => openPanel('settings')}>
                      <Settings size={18} />
                      设置
                    </button>
                  </div>
                </>
              )}
            </MotionPresence>
          </div>
        </header>
        <MotionPresence>
          {connectionFailure && connectionState === 'blocked' && (
            <div className="connection-error" role="alert">
              {connectionFailure}
            </div>
          )}
        </MotionPresence>
        <MotionPresence>
          {['connecting', 'retrying', 'syncing'].includes(connectionState) && host && (
            <div className="connection-recovery" role="status">
              {connectionState === 'syncing'
                ? '连接已恢复，正在同步最新进度…'
                : connectionFailure || '正在重新连接电脑；现有消息和草稿已保留。'}
            </div>
          )}
        </MotionPresence>
        <MotionPresence>
          {upstreamRetry && (
            <div className="connection-recovery" role="status">
              Codex 正在重试 · {upstreamRetry}
            </div>
          )}
        </MotionPresence>
        <MotionPresence>
          {error && (
            <div className="connection-error" role="status">
              <span>{error}</span>
              <IconButton icon={X} label="关闭提示" onClick={() => setError('')} />
            </div>
          )}
        </MotionPresence>
        <MotionPresence>
          {receiptBlocked && (
            <div className="history-error" role="alert">
              上次操作结果尚未确定。核对前不能继续变更。
              <button
                disabled={!connected}
                onClick={async () => {
                  try {
                    await bridge.current?.reconcile();
                    setReceiptBlocked(bridge.current?.awaitingReceipt || false);
                    await refresh();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                核对操作结果
              </button>
            </div>
          )}
        </MotionPresence>
        <MotionPresence>
          {historyFailure && (
            <div className="history-error" role="alert">
              {historyFailure}
              <button onClick={() => void refresh()}>重试读取</button>
            </div>
          )}
        </MotionPresence>
        {(snapshot.approvals || [])
          .filter((a) => a.sessionId === session)
          .map((a) => (
            <ApprovalCard
              key={a.approvalId}
              approval={a}
              disabled={!connected || receiptBlocked}
              uncertain={() => bridge.current?.awaitingReceipt === true}
              onRefresh={() => void refresh()}
              onDecide={decide}
            />
          ))}
        <TaskProgress
          entries={renderedHistory}
          active={!!activeTurn}
          turnId={
            snapshot.turns?.find((turn) => turn.turnId === activeTurn)?.upstreamTurnId || activeTurn
          }
          stale={!connected}
        />
        <Timeline
          ref={timeline}
          identity={JSON.stringify([host?.hostId, session])}
          revision={viewRevision}
          animateNewItems={historyReady}
          hasOlder={!!historyCursor && connected && historyReady}
          loadingOlder={historyLoading}
          onOlder={() => void loadOlderHistory()}
        >
          <div className="timeline-content">
            {historyCursor && (
              <button
                className="text-button history-more"
                disabled={historyLoading}
                onClick={() => void loadOlderHistory()}
              >
                {historyLoading ? '加载中…' : '加载更早记录'}
              </button>
            )}
            {renderedHistory.map((entry, entryIndex) => {
              const item = entry.item || {},
                type = String(item.type || '');
              if (type === 'reasoning' && !contentText(item)) return null;
              const user = type === 'userMessage' || item.role === 'user',
                assistant =
                  ['agentMessage', 'assistantMessage'].includes(type) || item.role === 'assistant',
                text = contentText(item);
              return (
                <article
                  className={`turn ${user ? 'user-turn' : assistant ? 'assistant-turn' : 'activity-turn'}`}
                  key={historyKey(entry)}
                  data-history-key={historyKey(entry)}
                >
                  <div className="message-content">
                    <RichContent
                      entry={entry}
                      connection={bridge.current}
                      sessionId={session || ''}
                      onFile={supports('projectTextPreview') ? openFile : undefined}
                      onAgent={openAgent}
                    />
                  </div>
                  {assistant &&
                    Array.isArray(item.questions) &&
                    item.questions.length > 0 &&
                    session && (
                      <AsyncQuestions
                        entry={entry}
                        history={renderedHistory}
                        request={request}
                        receiptKey={`agentdeck.web.question.${scope}.${host?.hostId}.${session}.${item.id}`}
                        disabled={
                          !connected ||
                          receiptBlocked ||
                          !historyReady ||
                          current?.archived === 1 ||
                          !supports('activeTurnSteering')
                        }
                        options={{
                          sessionId: session,
                          permissionMode: permission,
                          mode: draft.mode,
                          ...(draft.model ? { model: draft.model } : {}),
                          ...(draft.effort ? { effort: draft.effort } : {}),
                        }}
                        onRefresh={() => void refresh()}
                        uncertain={() => bridge.current?.awaitingReceipt === true}
                      />
                    )}
                  {(user || assistant) && text && (
                    <div className="message-actions">
                      <IconButton
                        icon={Copy}
                        label="复制消息"
                        onClick={() =>
                          void navigator.clipboard.writeText(text).catch((e) => setError(String(e)))
                        }
                      />
                      <IconButton
                        icon={Quote}
                        label="引用消息"
                        onClick={() =>
                          updateDraft({
                            text: `${draft.text}${draft.text ? '\n\n' : ''}${text
                              .split('\n')
                              .map((line) => '> ' + line)
                              .join('\n')}\n\n`,
                          })
                        }
                      />
                      <IconButton
                        icon={Search}
                        label="阅读完整消息"
                        onClick={() => {
                          setMessageAction({ entry, kind: 'read' });
                        }}
                      />
                      {user && supports('sessionHistoryRevert') && (
                        <IconButton
                          icon={Pencil}
                          label="编辑并重新发送"
                          disabled={busy || receiptBlocked || !!activeTurn || !historyReady}
                          onClick={() => {
                            setEditText(text);
                            setMessageAction({ entry, kind: 'revise' });
                          }}
                        />
                      )}
                      {assistant && supports('sessionHistoryRevert') && (
                        <IconButton
                          icon={RotateCcw}
                          label="重试此回答"
                          disabled={busy || receiptBlocked || !!activeTurn || !historyReady}
                          onClick={() => {
                            const before = renderedHistory
                              .slice(0, renderedHistory.indexOf(entry) + 1)
                              .reverse()
                              .find(
                                (e) =>
                                  e.turnId === entry.turnId &&
                                  (e.item?.type === 'userMessage' || e.item?.role === 'user'),
                              );
                            if (!before) {
                              setError('此轮用户消息尚未加载，请先加载更早记录');
                              return;
                            }
                            setEditText(contentText(before.item));
                            setMessageAction({ entry: before, kind: 'revise' });
                          }}
                        />
                      )}
                      {supports('sessionForkAtTurn') && (
                        <IconButton
                          icon={GitFork}
                          label="从此处分叉"
                          disabled={busy || receiptBlocked || !!activeTurn}
                          onClick={() => setMessageAction({ entry, kind: 'fork' })}
                        />
                      )}
                      {supports('sessionHistoryRevert') && user && (
                        <IconButton
                          icon={History}
                          label="回退到此消息之前"
                          disabled={busy || receiptBlocked || !!activeTurn || !historyReady}
                          onClick={() => setMessageAction({ entry, kind: 'revert' })}
                        />
                      )}
                    </div>
                  )}
                  {!activeTurn && renderedHistory[entryIndex + 1]?.turnId !== entry.turnId && (
                    <TurnChanges
                      entries={renderedHistory.filter((e) => e.turnId === entry.turnId)}
                      partial={!!historyCursor}
                    />
                  )}
                </article>
              );
            })}
            {!renderedHistory.length && !historyFailure && (
              <div className="empty">
                {session && !historyReady ? (
                  <p>正在读取会话历史…</p>
                ) : (
                  <>
                    <div className="empty-symbol">✳</div>
                    <h1>What can we build?</h1>
                    <p>
                      {connected
                        ? '选择项目，开始一段 Codex 对话。'
                        : '连接你的电脑，随时继续工作。'}
                    </p>
                    {!connected && (
                      <button onClick={() => openPanel('computers')}>
                        <Computer size={17} />
                        连接电脑
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </Timeline>
        <Composer
          key={draftKey}
          draft={draft}
          status={
            session && host ? (
              <ComposerStatus
                key={session}
                request={request}
                sessionId={session}
                goalSupported={supports('sessionGoalView')}
                usageSupported={supports('sessionTokenUsage')}
                revision={statusRevision}
                observedUsage={observedUsage}
                onGoal={() => openPanel('goal')}
                enabled={connected}
              />
            ) : undefined
          }
          onChange={updateDraft}
          models={models}
          supports={supports}
          disabled={
            !connected ||
            !selectedProject ||
            receiptBlocked ||
            !!(session && !historyReady) ||
            current?.archived === 1
          }
          busy={busy}
          active={!!activeTurn}
          permission={permission}
          onPermission={(value) => (value === 'full' ? setFullConfirm(true) : setPermission(value))}
          onSend={(kind) => void send(kind)}
          onStop={() => void interrupt()}
          onPanel={openPanel}
          onNew={newChat}
          onError={setError}
        />
      </section>
      <MotionPresence>
        {fullConfirm && (
          <Modal title="允许完整访问？" onClose={() => setFullConfirm(false)}>
            <p>接下来的任务将使用电脑允许的完整访问权限。请确认你信任当前项目与任务。</p>
            <div className="button-row">
              <button
                onClick={() => {
                  setPermission('full');
                  setFullConfirm(false);
                }}
              >
                使用 Full access
              </button>
              <button onClick={() => setFullConfirm(false)}>取消</button>
            </div>
          </Modal>
        )}
      </MotionPresence>
      <MotionPresence>
        {messageAction && (
          <Modal
            wide
            title={
              messageAction.kind === 'read'
                ? '消息'
                : messageAction.kind === 'revise'
                  ? '编辑并重新发送'
                  : messageAction.kind === 'fork'
                    ? '从此处分叉'
                    : '回退会话'
            }
            onClose={() => {
              if (!busy) setMessageAction(undefined);
            }}
          >
            {messageAction.kind === 'read' ? (
              <div className="message-reader">
                <RichContent
                  entry={messageAction.entry}
                  connection={bridge.current}
                  sessionId={session || ''}
                />
              </div>
            ) : (
              <div className="panel-stack">
                {messageAction.kind === 'revise' ? (
                  <>
                    <p className="muted">
                      替换该轮用户消息并重新执行，后续轮次将被回退。原附件和技能由电脑核对保留。
                    </p>
                    <textarea
                      aria-label="修改消息"
                      rows={8}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                    />
                  </>
                ) : (
                  <p>
                    {messageAction.kind === 'fork'
                      ? '从该原生轮次创建独立会话？'
                      : '回退此消息和之后的轮次？此操作会改变电脑上的原会话。'}
                  </p>
                )}
                <button
                  disabled={
                    busy ||
                    receiptBlocked ||
                    !canManage(current) ||
                    (messageAction.kind === 'revise' && !editText.trim())
                  }
                  onClick={() => void runMessageAction()}
                >
                  确认{messageAction.kind === 'revise' ? '并发送' : ''}
                </button>
                {error && <p className="error">{error}</p>}
              </div>
            )}
          </Modal>
        )}
      </MotionPresence>
      <MotionPresence>
        {panel && (
          <Modal
            wide={['git', 'files', 'history', 'settings'].includes(panel)}
            title={titles[panel] || panel}
            onClose={() => setPanel('')}
          >
            <div
              key={JSON.stringify([
                connectionEpoch.current,
                session,
                selectedProject,
                panel,
                manageSession?.sessionId,
              ])}
              className="panel-content"
            >
              {panel === 'computers' && (
                <div className="panel-stack">
                  <p className="muted">
                    在线表示电脑已连到云端；浏览器仍需完成授权、安全连接与会话同步。
                  </p>
                  {directoryFailure && (
                    <p className="error" role="status">
                      {directoryFailure}
                    </p>
                  )}
                  {host && <p role="status">浏览器连接：{connectionLabels[connectionState]}</p>}
                  {connectionFailure && (
                    <p className="error" role="status">
                      {connectionFailure}
                    </p>
                  )}
                  {hosts.map((item) => (
                    <div className="computer-entry" key={item.hostId}>
                      <button
                        className={`host ${item.hostId === host?.hostId ? 'selected' : ''}`}
                        onClick={() => {
                          setPanel('');
                          void connect(item);
                        }}
                      >
                        <span className={`dot ${item.online ? 'online' : ''}`} />
                        <span>{item.displayName}</span>
                        <small>
                          {directoryFailure ? '状态待刷新' : item.online ? '在线' : '离线'}
                        </small>
                      </button>
                      {item.hostId === host?.hostId && (
                        <div className="button-row">
                          <button disabled={busy} onClick={() => void connect(item)}>
                            <RefreshCw size={15} />
                            重新连接
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {!hosts.length && <p>尚未绑定电脑。请先在电脑端登录同一账户。</p>}
                  {host && (
                    <DataFields
                      value={{
                        hostId: host.hostId,
                        fingerprint: hostFingerprint,
                        lastSynced,
                        codexVersion: capabilities.codexVersion,
                        status: connectionLabels[connectionState],
                      }}
                    />
                  )}
                  {host && (
                    <>
                      <label className="host-label">
                        本机显示名称
                        <input
                          value={hostLabel}
                          maxLength={80}
                          placeholder={host.displayName}
                          onChange={(e) => {
                            setHostLabel(e.target.value);
                            localStorage.setItem(
                              `agentdeck.web.label.${scope}.${host.hostId}`,
                              e.target.value,
                            );
                          }}
                        />
                      </label>
                    </>
                  )}
                  <h3>账户设备</h3>
                  {devices.map((item) => (
                    <div className="device" key={item.deviceId}>
                      <span>
                        {item.displayName}
                        <small>{item.kind}</small>
                      </span>
                      {item.revoked ? (
                        <small>已撤销</small>
                      ) : (
                        <button
                          onClick={() => {
                            if (confirm(`撤销设备“${item.displayName}”的连接权限？`))
                              void revokeDevice(item.deviceId);
                          }}
                        >
                          撤销
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {panel === 'settings' && (
                <div className="settings-layout">
                  <nav className="settings-nav">
                    <input
                      className="settings-search"
                      aria-label="搜索设置"
                      placeholder="搜索设置"
                      value={settingsSearch}
                      onChange={(e) => setSettingsSearch(e.target.value)}
                    />
                    {[
                      ['general', '常规', Settings],
                      ['configuration', '模型与输出', SlidersHorizontal],
                      ['conversations', '对话', History],
                      ['shortcuts', '快捷键', Keyboard],
                      ['computers', '电脑', Computer],
                      ['data', '数据', Database],
                      ['diagnostics', '诊断', FileText],
                      ['account', 'Codex 账户', Computer],
                    ]
                      .filter(([, name]) =>
                        String(name).toLowerCase().includes(settingsSearch.toLowerCase()),
                      )
                      .map(([id, name, Icon]) => {
                        const SettingsIcon = Icon as typeof Settings;
                        return (
                          <button
                            key={String(id)}
                            className={settingsTab === id ? 'active' : ''}
                            onClick={() => setSettingsTab(String(id))}
                          >
                            <SettingsIcon size={17} />
                            {String(name)}
                          </button>
                        );
                      })}
                  </nav>
                  <section className="settings-body" key={settingsTab}>
                    {settingsTab === 'general' && (
                      <div className="panel-stack">
                        <InstallApp />
                        <label>
                          外观
                          <select
                            aria-label="外观"
                            value={theme}
                            onChange={(e) => setTheme(e.target.value)}
                          >
                            <option value="system">跟随系统</option>
                            <option value="light">浅色</option>
                            <option value="dark">深色</option>
                          </select>
                        </label>
                        <label className="setting-row">
                          <span>
                            任务通知<small>仅显示状态；网页关闭后不能接收通知。</small>
                          </span>
                          <input
                            type="checkbox"
                            checked={notification}
                            disabled={!('Notification' in window)}
                            onChange={async (e) => {
                              if (e.target.checked) {
                                const result = await Notification.requestPermission();
                                setNotification(result === 'granted');
                              } else setNotification(false);
                            }}
                          />
                        </label>
                        <button
                          onClick={() => {
                            setMask(!mask);
                          }}
                        >
                          <EyeOff size={17} />
                          {mask ? '显示文字' : '遮盖文字'}
                        </button>
                        <button
                          onClick={() =>
                            void api('/api/v1/web/logout', { method: 'POST' })
                              .then(() => location.reload())
                              .catch((e) => setError(String(e)))
                          }
                        >
                          <LogOut size={17} />
                          退出账户
                        </button>
                      </div>
                    )}
                    {settingsTab === 'configuration' &&
                      (connected ? (
                        <ConfigurationPanel request={request} models={models} supports={supports} />
                      ) : (
                        <p>连接电脑后查看模型与输出配置。</p>
                      ))}
                    {settingsTab === 'data' &&
                      (connected ? (
                        <RetentionPanel request={request} />
                      ) : (
                        <p>连接电脑后管理缓存。</p>
                      ))}
                    {settingsTab === 'diagnostics' &&
                      (connected ? (
                        <DiagnosticsPanel request={request} />
                      ) : (
                        <p>连接电脑后读取诊断。</p>
                      ))}
                    {settingsTab === 'account' &&
                      (connected && supports('accountSummary') ? (
                        <AccountPanel request={request} />
                      ) : (
                        <p>连接支持账户摘要的电脑后查看。</p>
                      ))}
                    {settingsTab === 'shortcuts' && (
                      <DataFields
                        value={{
                          'Ctrl + K': '搜索会话',
                          'Ctrl + F': '查找已加载消息',
                          'Alt + ← / →': '切换上一条 / 下一条会话',
                          Enter: '发送 / 加入队列',
                          'Shift + Enter': '换行',
                          'Ctrl + Enter': '发送',
                          Escape: '关闭菜单或弹窗',
                          '/plan /goal /default': '切换模式',
                          '/skills /mention': '技能 / 项目文件',
                          '/queue /history /compact /new': '队列 / 历史 / 整理 / 新对话',
                        }}
                      />
                    )}
                    {settingsTab === 'conversations' && (
                      <div className="panel-stack">
                        <button
                          onClick={() => {
                            setFilter('archived');
                            setSidebarOpen(true);
                            setPanel('');
                          }}
                        >
                          查看归档对话
                        </button>
                        <button onClick={() => openPanel('drafts')}>未发送草稿</button>
                        <button disabled={!connected} onClick={() => void syncIndex()}>
                          同步电脑已有对话
                        </button>
                      </div>
                    )}
                    {settingsTab === 'computers' && (
                      <button onClick={() => openPanel('computers')}>管理电脑与设备</button>
                    )}
                  </section>
                </div>
              )}
              {panel === 'manage' && targetSession && connected && (
                <SessionPanel
                  request={request}
                  session={targetSession}
                  capabilities={capabilities}
                  onChanged={() => void refresh()}
                  onSelect={(id) => {
                    selectSession(id);
                    setPanel('');
                  }}
                />
              )}
              {panel === 'goal' && session && connected && (
                <GoalPanel
                  request={request}
                  sessionId={session}
                  supports={supports}
                  onChanged={() => void refresh()}
                />
              )}
              {panel === 'files' && selectedProject && connected && (
                <FilesPanel
                  request={request}
                  projectId={selectedProject}
                  initialPath={filePath}
                  onReference={(text) => {
                    updateDraft({ text: `${draft.text}${draft.text ? '\n' : ''}${text}\n` });
                    setPanel('');
                  }}
                />
              )}
              {panel === 'git' && selectedProject && connected && (
                <GitPanel request={request} projectId={selectedProject} />
              )}
              {panel === 'skills' && selectedProject && connected && (
                <SkillsPanel
                  request={request}
                  projectId={selectedProject}
                  selected={draft.skills}
                  onSelect={(skills) => updateDraft({ skills })}
                  configure={supports('skillConfiguration')}
                />
              )}
              {panel === 'queue' && session && connected && (
                <QueuePanel
                  request={request}
                  sessionId={session}
                  supports={supports}
                  onChanged={() => void refresh()}
                />
              )}
              {panel === 'projects' && connected && (
                <ProjectsPanel
                  request={request}
                  projects={snapshot.projects || []}
                  supports={supports}
                  onChanged={() => void refresh()}
                  onProject={(id) => {
                    setSelectedProject(id);
                    selectSession(undefined);
                    setPanel('');
                  }}
                />
              )}
              {['files', 'git', 'skills'].includes(panel) && (!selectedProject || !connected) && (
                <p className="muted">请先连接电脑并选择项目。</p>
              )}
              {['manage', 'goal', 'queue', 'projects'].includes(panel) && !connected && (
                <p className="muted">请先连接电脑。</p>
              )}
              {['goal', 'queue', 'manage'].includes(panel) && connected && !session && (
                <p className="muted">请先选择会话。</p>
              )}
              {panel === 'drafts' && (
                <div className="panel-stack">
                  <p className="muted">草稿按电脑和会话隔离，仅保留在当前标签页中。</p>
                  {Object.entries(drafts)
                    .filter(([key, d]) => {
                      const [account, id] = JSON.parse(key);
                      return (
                        account === scope &&
                        id === host?.hostId &&
                        (d.text || d.attachments.length || d.skills.length)
                      );
                    })
                    .map(([key, d]) => {
                      const id = JSON.parse(key)[2] as string;
                      return (
                        <button
                          className="draft-entry"
                          key={key}
                          onClick={() => {
                            if (id.startsWith('new:')) {
                              setSelectedProject(id.slice(4));
                              selectSession(undefined);
                            } else selectSession(id);
                            setPanel('');
                          }}
                        >
                          <strong>
                            {snapshot.sessions?.find((s) => s.sessionId === id)?.title || '新对话'}
                          </strong>
                          <span>
                            {d.text.slice(0, 180) ||
                              `${d.attachments.length} 个附件 · ${d.skills.length} 个技能`}
                          </span>
                        </button>
                      );
                    })}
                </div>
              )}
              {panel === 'search' && (
                <div className="panel-stack">
                  <input
                    autoFocus
                    id="session-search"
                    aria-label="搜索会话"
                    placeholder="搜索会话名称或项目"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {matchingSessions.map((s) => (
                    <button
                      className="search-result"
                      key={s.sessionId}
                      onClick={() => {
                        chooseSession(s);
                        setPanel('');
                      }}
                    >
                      <strong>{s.title || '未命名会话'}</strong>
                      <span>
                        {snapshot.projects?.find((p) => p.projectId === s.projectId)?.name}
                        {s.archived === 1 ? ' · 已归档' : ''}
                      </span>
                    </button>
                  ))}
                  {!matchingSessions.length && <p className="muted">没有匹配的会话</p>}
                </div>
              )}
              {panel === 'find' && (
                <div className="panel-stack">
                  <input
                    autoFocus
                    aria-label="查找消息"
                    value={find}
                    onChange={(e) => {
                      setFind(e.target.value);
                      setFindIndex(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && matches.length) {
                        const next =
                          (findIndex + (e.shiftKey ? -1 : 1) + matches.length) % matches.length;
                        setFindIndex(next);
                        jumpTo(matches[next]!);
                      }
                    }}
                    placeholder="查找已加载的消息"
                  />
                  <p className="muted">{matches.length} 条匹配 · 仅查找当前已加载历史</p>
                  {matches.map((entry) => (
                    <button
                      className="search-result"
                      key={historyKey(entry)}
                      onClick={() => jumpTo(entry)}
                    >
                      {contentText(entry.item).slice(0, 220)}
                    </button>
                  ))}
                </div>
              )}
              {panel === 'history' && (
                <div className="panel-stack">
                  <p className="muted">来自电脑原会话的已加载记录</p>
                  {historyCursor && (
                    <button disabled={historyLoading} onClick={() => void loadOlderHistory()}>
                      加载更早记录
                    </button>
                  )}
                  {renderedHistory
                    .filter((e) => e.item?.type === 'userMessage' || e.item?.role === 'user')
                    .map((entry) => (
                      <button
                        className="search-result"
                        key={historyKey(entry)}
                        onClick={() => jumpTo(entry)}
                      >
                        {contentText(entry.item).slice(0, 240)}
                      </button>
                    ))}
                </div>
              )}
            </div>
          </Modal>
        )}
      </MotionPresence>
    </div>
  );
}

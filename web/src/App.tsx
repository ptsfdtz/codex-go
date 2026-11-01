import { Select } from './components/Select';
import { MotionPresence, MotionList, useSidebarMotion } from './motion';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';
import agentDeckMark from '../../assets/branding/agentdeck-mark.svg';
import { api, installationId, accountEvent } from './cloud';
import { Bridge } from './transport/bridge';
import { DeleteDevice } from './features/AccountDevices';
import { SelectionQuote, appendQuote } from './features/SelectionQuote';
import { HostNameEditor } from './features/HostNameEditor';
import { hostName as cloudHostName, migrateHostNames, type HostName } from './features/host-names';
import { AccountPassword } from './AccountPassword';
import type { HostGrant } from './host-book';
import { contentText, RichContent } from './RichContent';
import { Timeline } from './Timeline';
import { readHistoryPage } from './history-page';
import { ActivityStages } from './features/activity/ActivityStages';
import { historyKey, mergeHistory, type HistoryEntry } from './history';
import { applyProgress, historyError, mergeHistorySnapshot, finalItem } from './conversation';

import type {
  Host,
  Model,
  Session,
  Turn,
  Approval,
  Snapshot,
  Capabilities,
  Draft,
  Request,
} from './workspace';
import { emptyDraft, canManage, chatProject, isSessionWorking } from './workspace';
import { Sidebar } from './features/Sidebar';
import type { WorkMode } from './features/ModeSwitcher';
import { deferred } from './deferred';
const ApiChat = deferred<
  React.ComponentProps<typeof import('./features/api-chat/ApiChat').ApiChat>
>(() => import('./features/api-chat/ApiChat').then((module) => ({ default: module.ApiChat })));
import './features/api-chat/api-chat.css';
import { Composer } from './features/Composer';
import { PlanConfirmation } from './features/plan/PlanConfirmation';
import { ApprovalCard, AsyncQuestions } from './features/Questions';
import { QueuedMessages } from './features/queue/QueuedMessages';
import { ComposerStatus } from './features/ComposerStatus';
import { TurnChanges } from './features/TurnChanges';
import { ProjectOverview } from './features/project-overview/ProjectOverview';
import { projectRelativePath } from './features/turn-changes';
import { turnOptions, resources } from './features/composer-input';
const SessionPanel = deferred<
  React.ComponentProps<typeof import('./features/Panels').SessionPanel>
>(() => import('./features/Panels').then((module) => ({ default: module.SessionPanel })));
const GoalPanel = deferred<React.ComponentProps<typeof import('./features/Panels').GoalPanel>>(() =>
  import('./features/Panels').then((module) => ({ default: module.GoalPanel })),
);
const SkillsPanel = deferred<React.ComponentProps<typeof import('./features/Panels').SkillsPanel>>(
  () => import('./features/Panels').then((module) => ({ default: module.SkillsPanel })),
);
const QueuePanel = deferred<React.ComponentProps<typeof import('./features/Panels').QueuePanel>>(
  () => import('./features/Panels').then((module) => ({ default: module.QueuePanel })),
);
const ProjectsPanel = deferred<
  React.ComponentProps<typeof import('./features/Panels').ProjectsPanel>
>(() => import('./features/Panels').then((module) => ({ default: module.ProjectsPanel })));
const ProjectSettings = deferred<
  React.ComponentProps<typeof import('./features/project-settings/ProjectSettings').ProjectSettings>
>(() =>
  import('./features/project-settings/ProjectSettings').then((module) => ({
    default: module.ProjectSettings,
  })),
);
const ConfigurationPanel = deferred<
  React.ComponentProps<typeof import('./features/Panels').ConfigurationPanel>
>(() => import('./features/Panels').then((module) => ({ default: module.ConfigurationPanel })));
const RetentionPanel = deferred<
  React.ComponentProps<typeof import('./features/Panels').RetentionPanel>
>(() => import('./features/Panels').then((module) => ({ default: module.RetentionPanel })));
const DiagnosticsPanel = deferred<
  React.ComponentProps<typeof import('./features/Panels').DiagnosticsPanel>
>(() => import('./features/Panels').then((module) => ({ default: module.DiagnosticsPanel })));
const AccountPanel = deferred<
  React.ComponentProps<typeof import('./features/Panels').AccountPanel>
>(() => import('./features/Panels').then((module) => ({ default: module.AccountPanel })));
import { IconButton, Modal, DataFields } from './ui';
import {
  Menu,
  ChevronDown,
  ChevronLeft,
  Check,
  Computer,
  MoreHorizontal,
  Settings,
  FileDiff,
  FolderOpen,
  Search,
  History,
  Clock,
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
import { MessageEditor } from './features/MessageEditor';
import { answerActions } from './features/answer-actions';
import { InstallApp } from './features/InstallApp';
import { AppUpdates } from './features/AppUpdates';
import { SettingsLayout } from './features/SettingsLayout';
import { HostUpdates } from './features/HostUpdates';
const FileWorkspace = deferred<
  React.ComponentProps<typeof import('./features/files/FileWorkspace').FileWorkspace>
>(
  () =>
    import('./features/files/FileWorkspace').then((module) => ({ default: module.FileWorkspace })),
  () => (
    <aside className="file-workspace module-status" role="status">
      加载文件工作区…
    </aside>
  ),
);
import './features/files/file-workspace.css';
import { ToolsButton, ToolHeader, type Tool } from './features/tools/ToolsNavigation';
const SshTerminal = deferred<
  React.ComponentProps<typeof import('./features/tools/SshTerminal').SshTerminal>
>(() => import('./features/tools/SshTerminal').then((module) => ({ default: module.SshTerminal })));
const SideChat = deferred<
  React.ComponentProps<typeof import('./features/tools/SideChat').SideChat>
>(() => import('./features/tools/SideChat').then((module) => ({ default: module.SideChat })));
import { usePreference } from './features/preferences';
import {
  resolveComposerModelPreferences,
  readComposerPreferences,
  saveComposerPreferences,
  type ComposerPreferences,
  readComposerModelPreferences,
  saveComposerModelPreferences,
  type ComposerModelPreferences,
} from './features/composer-preferences';

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
  const [mode] = usePreference<WorkMode>(
    'agentdeck.web.work-mode',
    'codex',
    (value): value is WorkMode => value === 'codex' || value === 'api',
  );
  const modeControl = <span className="app-brand">AgentDeck</span>;
  return mode === 'api' ? (
    <ApiChatGate modeControl={modeControl} />
  ) : (
    <CodexApp modeControl={modeControl} />
  );
}
function ApiChatGate({ modeControl }: { modeControl: React.ReactNode }) {
  const [identity, setIdentity] = useState<{
    accountId: string;
    mustChangePassword: boolean;
  } | null>();
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let current = true;
    const changed = () => {
      setIdentity(undefined);
      setGeneration((value) => value + 1);
    };
    window.addEventListener(accountEvent, changed);
    void api<{ accountId: string; mustChangePassword: boolean }>('/api/v1/web/session')
      .then((value) => {
        if (current) setIdentity(value);
      })
      .catch(() => {
        if (current) setIdentity(null);
      });
    return () => {
      current = false;
      window.removeEventListener(accountEvent, changed);
    };
  }, [generation]);
  if (identity === undefined) return <main className="center">加载中…</main>;
  if (identity === null) return <Login onLogin={() => setGeneration((value) => value + 1)} />;
  if (identity.mustChangePassword) return <AccountPassword />;
  return (
    <ApiChat
      key={`${identity.accountId}:${generation}`}
      scope={identity.accountId}
      modeControl={modeControl}
    />
  );
}
function CodexApp({ modeControl }: { modeControl: React.ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [scope, setScope] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const connectionEpoch = useRef(0);
  const accountEpoch = useRef(0);
  const [hosts, setHosts] = useState<Host[]>([]);
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
  const [sendFailure, setSendFailure] = useState<{ key: string; message: string }>();
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
  const [theme, setTheme] = useState(() => localStorage.getItem('agentdeck.web.theme') || 'system');
  const [preferences, setPreferences] = useState<Record<string, ComposerPreferences>>({});
  const [modelPreferences, setModelPreferences] = useState<
    Record<string, ComposerModelPreferences>
  >({});
  const [receiptBlocked, setReceiptBlocked] = useState(false);
  const [messageAction, setMessageAction] = useState<{ entry: HistoryEntry; kind: string }>();
  const [editText, setEditText] = useState('');
  const [editError, setEditError] = useState('');
  const messageActionPending = useRef(false);
  const [notification, setNotification] = usePreference(
    'agentdeck.web.notifications',
    false,
    (value): value is boolean => typeof value === 'boolean',
  );
  const notificationRef = useRef(notification);
  notificationRef.current = notification;
  const [statusRevision, setStatusRevision] = useState(0);
  const [queueRevision, setQueueRevision] = useState(0);
  const [observedUsage, setObservedUsage] =
    useState<Parameters<typeof ComposerStatus>[0]['observedUsage']>();
  const [filePath, setFilePath] = useState<string>();
  const [fileWorkspaceOpen, setFileWorkspaceOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>('files');
  const [sideChatSeen, setSideChatSeen] = useState(false);
  const [terminalSeen, setTerminalSeen] = useState(false);
  const [fileWorkspaceSeen, setFileWorkspaceSeen] = useState(false);
  const [fileWorkspaceWide, setFileWorkspaceWide] = useState(false);
  const [fileWorkspaceView, setFileWorkspaceView] = useState<'files' | 'changes'>('files');
  const [fileTargetProject, setFileTargetProject] = useState('');
  const [fileOpenToken, setFileOpenToken] = useState(0);
  const [filePaneWidth, setFilePaneWidth] = usePreference(
    'agentdeck.web.filePaneWidth',
    '60',
    (value): value is string =>
      typeof value === 'string' && Number(value) >= 35 && Number(value) <= 75,
  );
  const reconnect = useRef<ReconnectLoop>(undefined);
  const connectRef = useRef<(h: Host) => void>(undefined);
  const hostRef = useRef(host);
  hostRef.current = host;
  useEffect(() => {
    setFileTargetProject('');
    setFilePath(undefined);
    setFileWorkspaceView('files');
  }, [scope, host?.hostId, selectedProject]);
  function hostName(item: Host) {
    return cloudHostName(hosts.find((entry) => entry.hostId === item.hostId) || item);
  }
  function hostNameSaved(name: HostName) {
    setHosts((current) =>
      current.map((item) => (item.hostId === name.hostId ? { ...item, ...name } : item)),
    );
    setHost((current) => (current?.hostId === name.hostId ? { ...current, ...name } : current));
  }
  const draftKey = JSON.stringify([scope, host?.hostId, session || `new:${selectedProject}`]);
  const current = useMemo(
    () => snapshot.sessions?.find((item) => item.sessionId === session),
    [snapshot.sessions, session],
  );
  const preferenceKey = host ? JSON.stringify([scope, host.hostId]) : '';
  const preference = useMemo(
    () => preferences[preferenceKey] || readComposerPreferences(preferenceKey),
    [preferences, preferenceKey],
  );
  const permission = preference.permission;
  const modelPreferenceKey = host ? draftKey : '';
  const modelPreference = useMemo(
    () =>
      modelPreferences[modelPreferenceKey] ||
      readComposerModelPreferences(modelPreferenceKey, {
        model: current?.model || '',
        effort: current?.effort || '',
      }),
    [modelPreferences, modelPreferenceKey, current?.model, current?.effort],
  );
  const storedDraft = drafts[draftKey];
  const draft = {
    ...(storedDraft || emptyDraft()),
    model: modelPreference.model,
    effort: modelPreference.effort,
  };
  function updatePreferences(change: Partial<ComposerPreferences>) {
    const next = { ...preference, ...change };
    saveComposerPreferences(preferenceKey, next);
    setPreferences((items) => ({ ...items, [preferenceKey]: next }));
  }
  function updateDraft(change: Partial<Draft>) {
    if (change.model !== undefined || change.effort !== undefined) {
      const next = {
        model: change.model ?? modelPreference.model,
        effort: change.effort ?? modelPreference.effort,
      };
      saveComposerModelPreferences(modelPreferenceKey, next);
      setModelPreferences((items) => ({ ...items, [modelPreferenceKey]: next }));
    }
    setDrafts((items) => ({
      ...items,
      [draftKey]: { ...(items[draftKey] || emptyDraft()), ...change },
    }));
  }
  const supports = (key: string) => capabilities.features?.[key] === true;
  const chat = selectedProject === chatProject;
  const projects = (snapshot.projects || []).filter((p) => p.projectId !== chatProject);
  const composerSupports = (key: string) =>
    (!chat || !['composerSkills', 'projectFileBrowser', 'plan', 'goal'].includes(key)) &&
    supports(key);
  const [dismissedPlan, setDismissedPlan] = useState('');
  const lastPlanMessage = [...renderedHistory]
    .reverse()
    .find((entry) =>
      ['userMessage', 'agentMessage', 'assistantMessage', 'plan'].includes(
        String(entry.item?.type),
      ),
    );
  const pendingPlan =
    lastPlanMessage?.item?.type === 'plan' &&
    !Array.isArray(lastPlanMessage.item.plan) &&
    contentText(lastPlanMessage.item).trim() &&
    !['failed', 'interrupted', 'declined', 'inProgress'].includes(
      String(lastPlanMessage.item.status),
    )
      ? lastPlanMessage
      : undefined;
  const pendingPlanKey = pendingPlan ? JSON.stringify([draftKey, historyKey(pendingPlan)]) : '';
  const showPlanConfirmation =
    !!pendingPlan &&
    pendingPlanKey !== dismissedPlan &&
    !activeTurn &&
    historyReady &&
    !historyFailure &&
    !chat &&
    current?.archived !== 1;
  const bridge = useRef<Bridge | undefined>(undefined);
  const sessionRef = useRef<string | undefined>(undefined);
  const refreshTimer = useRef<number | undefined>(undefined);
  const historyResourceCache = useRef(new Map<string, HistoryEntry>());
  const timeline = useRef<Timeline>(null);
  const historyStarted = useRef(false);
  const startingSession = useRef<string | undefined>(undefined);
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
    setPanel((current) => (current === 'settings' ? current : ''));
    setMessageAction(undefined);
    setManageSession(undefined);
    setObservedUsage(undefined);
    if (persist && hostRef.current)
      localStorage.setItem(
        `agentdeck.web.selection.${scope}.${hostRef.current.hostId}`,
        id || (chat ? 'new:chat' : ''),
      );
  }

  function historyPage(connection: Bridge, sessionId: string, cursor?: string) {
    return readHistoryPage(connection, sessionId, cursor, historyResourceCache.current);
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
    let checking: Bridge | undefined;
    const wake = () => {
      if (document.visibilityState === 'hidden') return;
      reconnect.current?.wake();
      const connection = bridge.current;
      if (connection && checking !== connection && document.visibilityState === 'visible') {
        checking = connection;
        void connection
          .probe()
          .then(() => connection.reconcile())
          .then(() => {
            if (bridge.current === connection) scheduleRefresh(true);
          })
          .catch(() => {
            connection.close();
            reconnect.current?.wake();
          })
          .finally(() => {
            if (checking === connection) checking = undefined;
          });
      }
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
      setHost(undefined);
      hostRef.current = undefined;
      setHosts([]);
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
    window.addEventListener('pageshow', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener(accountEvent, accountChanged);
    return () => {
      window.removeEventListener('storage', receiptChanged);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', wake);
      window.removeEventListener('pageshow', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener(accountEvent, accountChanged);
    };
  }, []);
  useEffect(() => {
    if (panel === 'search') document.getElementById('session-search')?.focus();
  }, [panel]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.ssh-screen')) return;
      if (e.ctrlKey && host) {
        const tool =
          e.key === '`'
            ? 'terminal'
            : e.altKey && e.key.toLowerCase() === 's'
              ? 'chat'
              : e.shiftKey && e.key.toLowerCase() === 'g'
                ? 'changes'
                : !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p'
                  ? 'files'
                  : undefined;
        if (
          tool &&
          (tool === 'terminal' || tool === 'chat' || (connected && selectedProject && !chat))
        ) {
          e.preventDefault();
          showTool(tool);
          return;
        }
      }
      if (target.closest('.side-chat')) return;
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
  }, [snapshot.sessions, session, scope, host, connected, selectedProject]);

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
      await api<{ hosts: Host[] }>('/api/v1/hosts')
        .then(async (hostValue) => {
          if (cancelled || generation !== accountEpoch.current) return;
          let migrationFailure = '';
          try {
            hostValue.hosts = await migrateHostNames(
              hostValue.hosts || [],
              scope,
              localStorage,
              (hostId, customName) =>
                api<HostName>(`/api/v1/hosts/${encodeURIComponent(hostId)}/name`, {
                  method: 'PUT',
                  body: JSON.stringify({ customName, onlyIfUnset: true }),
                }),
              () => !cancelled && generation === accountEpoch.current,
            );
          } catch {
            migrationFailure = '旧电脑名称尚未同步到服务器，正在重试；本地名称已保留。';
          }
          if (cancelled || generation !== accountEpoch.current) return;
          setHosts(hostValue.hosts || []);
          setDirectoryFailure(migrationFailure);
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
    if (
      !bridge.current ||
      !session ||
      !connected ||
      historyStarted.current ||
      startingSession.current === session
    )
      return;
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
      if (id && includeHistory && startingSession.current !== id) {
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
    }, 250);
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
      setCapabilities({});
      setModels([]);
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
            throw new Error('电脑授权信息无效，请更新 Host');
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
            localStorage.getItem('agentdeck.web.selection.' + scope + '.' + next.hostId);
          const chosen =
            snap.sessions?.find((s) => s.sessionId === saved) ||
            (!saved ? snap.sessions?.find((s) => s.archived !== 1) : undefined);
          setSelectedProject(
            chosen?.projectId ||
              (configuration.caps.features?.projectlessChat
                ? chatProject
                : snap.projects?.[0]?.projectId) ||
              '',
          );
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

  async function send(kind?: 'queue' | 'steer', planText?: string, revision?: string) {
    const connection = bridge.current;
    let source =
      planText === undefined
        ? draft
        : {
            ...draft,
            text: revision
              ? `请继续调整以下计划：\n\n${planText}\n\n调整要求：${revision}`
              : `请按照以下计划开始开发：\n\n${planText}`,
            mode: revision ? 'plan' : 'default',
            attachments: [],
            references: [],
            skills: [],
          };
    if (
      !connection ||
      !connected ||
      sending.current ||
      (!source.text.trim() &&
        !source.attachments.length &&
        !source.skills.length &&
        !source.references?.length) ||
      (planText !== undefined && !!activeTurn) ||
      busy ||
      receiptBlocked ||
      (session && !historyReady) ||
      !selectedProject
    )
      return;
    const sourceKey = draftKey,
      epoch = connectionEpoch.current;
    let targetKey = sourceKey;
    let createdSession: string | undefined;
    sending.current = true;
    setSendFailure(undefined);
    setBusy(true);
    setError('');
    try {
      if (
        source.references?.length &&
        (!supports('fileReferenceInputs') ||
          source.references.some((ref) => ref.projectId !== selectedProject))
      )
        throw new Error('文件引用的项目已变化或 Host 需要升级，请重新引用');
      source = { ...source, ...resolveComposerModelPreferences(source, models) };
      let id = session;
      if (!id) {
        const created = await connection.request<{ session?: Session }>('sessions.create', {
          projectId: selectedProject,
          title: source.text.trim().slice(0, 80) || 'New conversation',
        });
        if (epoch !== connectionEpoch.current) return;
        id = created.session?.sessionId;
        if (!id) throw new Error('电脑没有返回会话标识');
        createdSession = id;
        startingSession.current = id;
        targetKey = JSON.stringify([scope, host?.hostId, id]);
        const selection = { model: source.model, effort: source.effort };
        saveComposerModelPreferences(targetKey, selection);
        setModelPreferences((items) => ({ ...items, [targetKey]: selection }));
        setDrafts((items) => ({ ...items, [targetKey]: source }));
        selectSession(id);
        // sessions.create confirms a new empty thread. Codex cannot paginate
        // its rollout until the first turn starts, so don't race that read
        // against turn.start. Read the first saved page after acknowledgement.
        setHistoryReady(true);
      }
      if (epoch !== connectionEpoch.current) return;
      if (activeTurn) {
        if (kind === 'steer') {
          if (source.attachments.length || source.skills.length || source.references?.length)
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
            (source.skills.length && !supports('nativeQueueSkills')) ||
            (source.references?.length && !supports('fileReferenceInputs'))
          )
            throw new Error('当前电脑不支持队列中的这些资源');
          await connection.request('queue.add', {
            sessionId: id,
            text: source.text.trim(),
            ...resources(source),
          });
          if (epoch === connectionEpoch.current) setQueueRevision((value) => value + 1);
        }
      } else {
        const result = await connection.request<{ turn?: Turn }>('turn.start', {
          sessionId: id,
          ...turnOptions(chat ? { ...source, mode: 'default', skills: [] } : source, permission),
        });
        if (epoch === connectionEpoch.current && sessionRef.current === id) {
          activityVersion.current++;
          managedActiveTurn.current = result.turn?.turnId;
          setActiveTurn(result.turn?.turnId);
        }
      }
      if (epoch !== connectionEpoch.current) return;
      if (startingSession.current === createdSession) startingSession.current = undefined;
      setDrafts((items) => {
        const next = { ...items };
        for (const key of new Set([sourceKey, targetKey]))
          if (next[key] === storedDraft || next[key] === source)
            next[key] =
              planText === undefined
                ? { ...source, text: '', attachments: [], skills: [], references: [] }
                : { ...draft, mode: revision ? 'plan' : 'default' };
        return next;
      });
      await refresh(!session && sessionRef.current === id);
    } catch (error) {
      if (epoch === connectionEpoch.current) {
        setError(String(error));
        setSendFailure({ key: targetKey, message: String(error) });
      }
    } finally {
      if (startingSession.current === createdSession) startingSession.current = undefined;
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
    if (!selectedProject)
      setSelectedProject(supports('projectlessChat') ? chatProject : projects[0]?.projectId || '');
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
    showFiles(relative);
  }
  function showFiles(
    path?: string,
    view: 'files' | 'changes' = 'files',
    projectId = selectedProject,
  ) {
    setActiveTool(view);
    setFileTargetProject(projectId);
    setFilePath(path);
    setFileWorkspaceView(view);
    setFileOpenToken((value) => value + 1);
    setFileWorkspaceSeen(true);
    setFileWorkspaceOpen(true);
    setPanel('');
    setMenu(false);
    setWorkspaceMenu(false);
    if (matchMedia('(max-width:1300px)').matches) setSidebarOpen(false);
  }
  function showTool(tool: Tool) {
    if (tool === 'files' || tool === 'changes') {
      showFiles(undefined, tool);
      return;
    }
    setActiveTool(tool);
    if (tool === 'chat') setSideChatSeen(true);
    if (tool === 'terminal') setTerminalSeen(true);
    setFileWorkspaceSeen(true);
    setFileWorkspaceOpen(true);
    setPanel('');
    setMenu(false);
    setWorkspaceMenu(false);
    if (matchMedia('(max-width:1300px)').matches) setSidebarOpen(false);
  }
  function openAgent(id: string) {
    const item = snapshot.sessions?.find((s) => s.upstreamThreadId === id);
    if (item) chooseSession(item);
    else setError('此代理会话尚未同步或不在授权项目中');
  }
  function openPanel(name: string) {
    if (chat && ['files', 'git', 'skills', 'goal'].includes(name)) {
      setError('普通聊天不使用项目文件、技能或任务目标。请先切换到项目。');
      return;
    }
    if (name === 'files' || name === 'git') {
      showFiles(undefined, name === 'git' ? 'changes' : 'files');
      return;
    }
    setMenu(false);
    setWorkspaceMenu(false);
    setSettingsChild(name === 'drafts' && panel === 'settings');
    if (name === 'manage') setManageSession(current);
    if (name === 'computers') {
      setSettingsTab('computers');
      setPanel('settings');
      return;
    }
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
    if (
      !messageAction ||
      !session ||
      busy ||
      receiptBlocked ||
      !connected ||
      messageActionPending.current ||
      !canManage(current) ||
      current?.archived === 1 ||
      (messageAction.kind === 'revise' && (!editText.trim() || !!activeTurn || !historyReady))
    )
      return;
    const { entry, kind } = messageAction,
      id = session,
      epoch = connectionEpoch.current;
    messageActionPending.current = true;
    setBusy(true);
    setEditError('');
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
            ...Object.fromEntries(
              Object.entries(resolveComposerModelPreferences(draft, models)).filter(
                ([, value]) => value,
              ),
            ),
          });
        if (epoch === connectionEpoch.current && sessionRef.current === id) {
          historyVersion.current++;
          setHistory([]);
          setHistoryCursor(undefined);
          historyStarted.current = false;
          await refresh();
        }
      }
      if (epoch === connectionEpoch.current && sessionRef.current === id)
        setMessageAction(undefined);
    } catch (e) {
      if (epoch === connectionEpoch.current && sessionRef.current === id) {
        if (kind === 'revise') setEditError(String(e));
        else setError(String(e));
      }
    } finally {
      messageActionPending.current = false;
      if (epoch === connectionEpoch.current) setBusy(false);
    }
  }
  function editMessage(entry: HistoryEntry) {
    timeline.current?.pause();
    setEditText(contentText(entry.item));
    setEditError('');
    setMessageAction({ entry, kind: 'revise' });
  }
  function cancelMessageEdit() {
    const entry = messageAction?.entry;
    setMessageAction(undefined);
    if (entry)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(
            `[data-history-key="${CSS.escape(historyKey(entry))}"] button[aria-label="编辑并重新发送"]`,
          )
          ?.focus({ preventScroll: true }),
      );
  }
  const [settingsChild, setSettingsChild] = useState(false);
  const [settingsTab, setSettingsTab] = usePreference(
    'agentdeck.web.settingsTab',
    'general',
    (value): value is string =>
      typeof value === 'string' &&
      [
        'general',
        'configuration',
        'conversations',
        'shortcuts',
        'computers',
        'data',
        'diagnostics',
        'account',
      ].includes(value),
  );
  const titles: Record<string, string> = {
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
  const answers = answerActions(
    renderedHistory,
    snapshot.turns?.find((turn) => turn.turnId === activeTurn)?.upstreamTurnId || activeTurn,
    contentText,
  );
  const matches = renderedHistory.filter(
    (entry) => find.trim() && contentText(entry.item).toLowerCase().includes(find.toLowerCase()),
  );
  const visibleDrafts =
    panel === 'drafts'
      ? Object.entries(drafts).filter(([key, d]) => {
          const [account, id] = JSON.parse(key);
          return (
            account === scope &&
            id === host?.hostId &&
            (d.text || d.attachments.length || d.skills.length || d.references?.length)
          );
        })
      : [];
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
      const stage = node?.closest<HTMLDetailsElement>('.activity-stage');
      if (stage) stage.open = true;
      node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      node?.classList.add('search-highlight');
      setTimeout(() => node?.classList.remove('search-highlight'), 2000);
    });
  }

  if (signedIn === null) return <main className="center">加载中…</main>;
  if (!signedIn) return <Login onLogin={() => location.reload()} />;
  if (mustChangePassword) return <AccountPassword />;
  const toolsVisible = fileWorkspaceOpen && !!host;
  const fileProject = fileTargetProject || selectedProject;
  const filesAvailable = connected && !!fileProject && fileProject !== chatProject;
  const filesVisible =
    toolsVisible && filesAvailable && (activeTool === 'files' || activeTool === 'changes');
  return (
    <div
      className={`shell ${sidebarOpen ? 'with-sidebar' : ''} ${toolsVisible ? 'has-file-workspace' : ''}`}
    >
      <Sidebar
        key={JSON.stringify([scope, host?.hostId])}
        brand={modeControl}
        sessions={snapshot.sessions || []}
        connected={connected}
        projects={projects}
        chatAvailable={connected && supports('projectlessChat')}
        onChat={() => {
          setSelectedProject(chatProject);
          selectSession(undefined);
          if (hostRef.current)
            localStorage.setItem(
              `agentdeck.web.selection.${scope}.${hostRef.current.hostId}`,
              'new:chat',
            );
          if (matchMedia('(max-width:760px)').matches) setSidebarOpen(false);
        }}
        host={host ? { ...host, displayName: hostName(host) } : undefined}
        sessionId={session}
        projectId={selectedProject}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNew={newChat}
        onSelect={chooseSession}
        onProject={(id) => {
          setSelectedProject(id);
          selectSession(undefined);
          setPanel('');
          if (matchMedia('(max-width:760px)').matches) setSidebarOpen(false);
        }}
        actionsBlocked={receiptBlocked || busy}
        onSessionAction={async (action, item) => {
          const latest = snapshot.sessions?.find((s) => s.sessionId === item.sessionId);
          if (
            !connected ||
            receiptBlocked ||
            busy ||
            !canManage(latest) ||
            (latest && isSessionWorking(latest))
          )
            throw new Error('请先等待任务结束或核对当前状态');
          await request(`sessions.${action}`, {
            sessionId: item.sessionId,
            ...(action === 'pin' ? { pinned: latest?.pinned !== 1 } : {}),
          });
          await refresh(false);
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
      <section
        className={`conversation-layout ${toolsVisible ? 'with-file-workspace' : ''} ${fileWorkspaceWide ? 'file-workspace-wide' : ''}`}
        ref={conversationElement}
        style={{ '--file-pane-width': `${filePaneWidth}%` } as React.CSSProperties}
      >
        <section className="conversation">
          <header className="topbar">
            <IconButton
              icon={Menu}
              label="打开会话列表"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={sidebarOpen ? 'rail-toggle' : ''}
            />
            <div className="workspace-anchor">
              <button
                className="workspace-title"
                aria-label="切换项目"
                aria-expanded={workspaceMenu}
                onClick={() => setWorkspaceMenu(!workspaceMenu)}
              >
                <span>
                  {current
                    ? current.title || '未命名会话'
                    : chat
                      ? '普通聊天'
                      : projects.find((p) => p.projectId === selectedProject)?.name || '选择项目'}
                </span>
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
                      {projects.map((p) => (
                        <button
                          key={p.projectId}
                          aria-current={p.projectId === selectedProject ? 'true' : undefined}
                          onClick={() => {
                            setSelectedProject(p.projectId);
                            selectSession(undefined);
                            setWorkspaceMenu(false);
                          }}
                        >
                          <FolderOpen size={17} />
                          <span>{p.name}</span>
                          {p.projectId === selectedProject && <Check size={16} />}
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
              <span
                className={`dot ${connected || connectionState === 'syncing' ? 'online' : ''}`}
              />
              {connectionLabels[connectionState]}
            </span>
            {connected &&
              !chat &&
              projects
                .filter((project) => project.projectId === selectedProject)
                .map((project) => (
                  <ProjectOverview
                    filesOpen={filesVisible}
                    onOpen={() => setFileWorkspaceOpen(false)}
                    key={JSON.stringify([host?.hostId, project.projectId])}
                    request={request}
                    project={project}
                    computer={host ? hostName(host) : ''}
                    gitRead={supports('gitRead')}
                    fileBrowser={supports('projectFileBrowser')}
                    activeTurn={activeTurn}
                    onFiles={() => showFiles()}
                    onChanges={() => showFiles(undefined, 'changes')}
                    onFile={openFile}
                  />
                ))}
            {host && (
              <ToolsButton
                onOpen={showTool}
                fileAvailable={connected && !!selectedProject && !chat}
              />
            )}
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
                          {supports('gitRead') && selectedProject && !chat && (
                            <button role="menuitem" onClick={() => openPanel('git')}>
                              <FileDiff size={18} />
                              审查工作区改动
                            </button>
                          )}
                          {supports('projectFileBrowser') && selectedProject && !chat && (
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
                          {!chat && supports('sessionGoalView') && (
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
          {host && connected && (
            <HostUpdates
              key={host.hostId}
              hostId={host.hostId}
              request={request}
              supported={supports('hostUpdateCheck')}
              disabled={busy || receiptBlocked}
              name={hostName(host)}
              managed={supports('hostUpdateManage')}
            />
          )}
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
          <TaskProgress
            entries={renderedHistory}
            active={!!activeTurn}
            turnId={
              snapshot.turns?.find((turn) => turn.turnId === activeTurn)?.upstreamTurnId ||
              activeTurn
            }
            stale={!connected}
          />
          <SelectionQuote
            key={draftKey}
            container={conversationElement}
            onQuote={(text) => {
              updateDraft({ text: appendQuote(draft.text, text) });
              requestAnimationFrame(() => {
                const input = conversationElement.current?.querySelector<HTMLTextAreaElement>(
                  'textarea[aria-label="消息"]',
                );
                input?.focus();
                if (input) input.setSelectionRange(input.value.length, input.value.length);
              });
            }}
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
              <ActivityStages
                key={JSON.stringify([host?.hostId, session])}
                entries={renderedHistory}
                activeTurn={
                  snapshot.turns?.find((turn) => turn.turnId === activeTurn)?.upstreamTurnId ||
                  activeTurn
                }
              >
                {(entry, entryIndex) => {
                  const item = entry.item || {},
                    type = String(item.type || '');
                  if (type === 'reasoning' && !contentText(item)) return null;
                  const user = type === 'userMessage' || item.role === 'user',
                    assistant =
                      ['agentMessage', 'assistantMessage'].includes(type) ||
                      item.role === 'assistant',
                    text = contentText(item),
                    actionText = assistant ? answers.get(entry) : text,
                    editing =
                      messageAction?.kind === 'revise' &&
                      historyKey(messageAction.entry) === historyKey(entry);
                  return (
                    <article
                      className={`turn ${user ? 'user-turn' : assistant ? 'assistant-turn' : 'activity-turn'}`}
                      key={historyKey(entry)}
                      data-history-key={historyKey(entry)}
                    >
                      <div className={`message-content${editing ? ' editing-message' : ''}`}>
                        {editing ? (
                          <MessageEditor
                            text={editText}
                            busy={busy}
                            disabled={
                              !connected ||
                              busy ||
                              receiptBlocked ||
                              !!activeTurn ||
                              !historyReady ||
                              current?.archived === 1 ||
                              !canManage(current)
                            }
                            error={editError}
                            onChange={setEditText}
                            onCancel={cancelMessageEdit}
                            onSend={() => void runMessageAction()}
                          />
                        ) : (
                          <RichContent
                            entry={entry}
                            images={
                              connected &&
                              supports('projectImagePreview') &&
                              selectedProject &&
                              !chat
                                ? {
                                    request,
                                    projectId: selectedProject,
                                    root:
                                      projects.find(
                                        (project) => project.projectId === selectedProject,
                                      )?.canonicalPath || '',
                                  }
                                : undefined
                            }
                            sessionImages={connected && supports('sessionMessageImages')}
                            connection={bridge.current}
                            sessionId={session || ''}
                            onFile={supports('projectTextPreview') ? openFile : undefined}
                            onAgent={openAgent}
                          />
                        )}
                      </div>
                      {(user || assistant) && actionText && !editing && (
                        <div className="message-actions">
                          <IconButton
                            icon={Copy}
                            label="复制消息"
                            onClick={() =>
                              void navigator.clipboard
                                .writeText(actionText)
                                .catch((e) => setError(String(e)))
                            }
                          />
                          <IconButton
                            icon={Quote}
                            label="引用消息"
                            onClick={() =>
                              updateDraft({
                                text: `${draft.text}${draft.text ? '\n\n' : ''}${actionText
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
                              setMessageAction({
                                entry: assistant
                                  ? { ...entry, item: { ...item, text: actionText } }
                                  : entry,
                                kind: 'read',
                              });
                            }}
                          />
                          {user && supports('sessionHistoryRevert') && (
                            <IconButton
                              icon={Pencil}
                              label="编辑并重新发送"
                              disabled={busy || receiptBlocked || !!activeTurn || !historyReady}
                              onClick={() => {
                                editMessage(entry);
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
                                editMessage(before);
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
                          projectRoot={
                            snapshot.projects?.find((p) => p.projectId === current?.projectId)
                              ?.canonicalPath
                          }
                        />
                      )}
                    </article>
                  );
                }}
              </ActivityStages>
              {!renderedHistory.length && !historyFailure && (
                <div className="empty">
                  {session && !historyReady ? (
                    <p>正在读取会话历史…</p>
                  ) : (
                    <>
                      <div
                        className="empty-symbol"
                        aria-hidden="true"
                        style={{
                          maskImage: `url("${agentDeckMark}")`,
                          WebkitMaskImage: `url("${agentDeckMark}")`,
                        }}
                      />
                      <h1>{chat ? '聊点什么？' : 'What can we build?'}</h1>
                      <p>
                        {connected
                          ? chat
                            ? '无需选择项目，直接开始对话。'
                            : '选择项目，开始一段 Codex 对话。'
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
            planConfirmation={
              showPlanConfirmation && pendingPlan ? (
                <PlanConfirmation
                  key={pendingPlanKey}
                  disabled={!connected || busy || receiptBlocked}
                  error={sendFailure?.key === draftKey ? sendFailure.message : undefined}
                  onImplement={() => void send(undefined, contentText(pendingPlan.item))}
                  onRevise={(text) => void send(undefined, contentText(pendingPlan.item), text)}
                  onDismiss={() => setDismissedPlan(pendingPlanKey)}
                />
              ) : undefined
            }
            prompts={
              <>
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
                {session &&
                  renderedHistory
                    .filter(
                      (entry) =>
                        ['agentMessage', 'assistantMessage'].includes(String(entry.item?.type)) &&
                        Array.isArray(entry.item?.questions) &&
                        entry.item.questions.length > 0,
                    )
                    .map((entry) => (
                      <AsyncQuestions
                        key={`${host?.hostId}.${session}.${historyKey(entry)}`}
                        entry={entry}
                        history={renderedHistory}
                        request={request}
                        receiptKey={`agentdeck.web.question.${scope}.${host?.hostId}.${session}.${entry.item?.id}`}
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
                    ))}
              </>
            }
            queued={
              session && supports('nativeQueue') ? (
                <QueuedMessages
                  key={JSON.stringify([scope, host?.hostId, session])}
                  request={request}
                  sessionId={session}
                  revision={queueRevision + statusRevision}
                  enabled={connected}
                  disabled={busy || receiptBlocked || !historyReady || current?.archived === 1}
                  active={!!activeTurn}
                  canStart={supports('nativeQueueStart')}
                  canSteer={supports('nativeQueueSteer')}
                  uncertain={() => bridge.current?.awaitingReceipt === true}
                  onChanged={() => void refresh()}
                />
              ) : undefined
            }
            status={
              session && host ? (
                <ComposerStatus
                  key={session}
                  request={request}
                  sessionId={session}
                  goalSupported={!chat && supports('sessionGoalView')}
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
            supports={composerSupports}
            attachmentTotalBytes={capabilities.limits?.attachmentTotalBytes}
            chat={chat}
            disabled={
              !connected ||
              !selectedProject ||
              receiptBlocked ||
              !!(session && !historyReady) ||
              current?.archived === 1
            }
            feedback={
              receiptBlocked
                ? '发送结果尚未确认，请先核对任务状态，避免重复发送。'
                : sendFailure?.key === draftKey
                  ? sendFailure.message
                  : undefined
            }
            busy={busy}
            active={!!activeTurn}
            permission={permission}
            onPermission={(permission) => updatePreferences({ permission })}
            onSend={(kind) => void send(kind)}
            onStop={() => void interrupt()}
            onPanel={openPanel}
            onNew={newChat}
          />
        </section>
        {toolsVisible && (
          <div
            className="file-pane-resizer"
            role="separator"
            aria-label="调整对话与工具栏宽度"
            aria-orientation="vertical"
            aria-valuemin={35}
            aria-valuemax={75}
            aria-valuenow={Number(filePaneWidth)}
            tabIndex={0}
            onDoubleClick={() => {
              setFileWorkspaceWide(false);
              setFilePaneWidth('60');
            }}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
                setFileWorkspaceWide(false);
                setFilePaneWidth(
                  String(
                    Math.max(
                      35,
                      Math.min(75, Number(filePaneWidth) + (event.key === 'ArrowLeft' ? 2 : -2)),
                    ),
                  ),
                );
              }
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              setFileWorkspaceWide(false);
              event.currentTarget.parentElement?.setAttribute('data-resizing', 'true');
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const box = conversationElement.current?.getBoundingClientRect();
              if (box)
                setFilePaneWidth(
                  String(
                    Math.max(35, Math.min(75, ((box.right - event.clientX) / box.width) * 100)),
                  ),
                );
            }}
            onLostPointerCapture={(event) => {
              event.currentTarget.parentElement?.removeAttribute('data-resizing');
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          />
        )}
        {fileWorkspaceSeen && host && (
          <aside
            key={JSON.stringify([scope, host.hostId])}
            className="file-workspace tools-workspace"
            hidden={!toolsVisible}
            inert={!toolsVisible}
            aria-label="工作区工具栏"
          >
            <ToolHeader
              active={activeTool}
              onChange={showTool}
              fileAvailable={connected && !!selectedProject && !chat}
              expanded={fileWorkspaceWide}
              onExpand={() => setFileWorkspaceWide((value) => !value)}
              onClose={() => setFileWorkspaceOpen(false)}
            />
            {connected && filesAvailable && (
              <FileWorkspace
                embedded
                key={JSON.stringify([connectionEpoch.current, host?.hostId, fileProject])}
                request={request}
                projectId={fileProject}
                projectName={
                  projects.find((project) => project.projectId === fileProject)?.name || '项目'
                }
                storageKey={`agentdeck.web.files.${JSON.stringify([scope, host?.hostId, fileProject])}`}
                visible={filesVisible}
                initialPath={fileTargetProject === fileProject ? filePath : undefined}
                initialView={fileTargetProject === fileProject ? fileWorkspaceView : 'files'}
                openToken={fileOpenToken}
                imagePreview={supports('projectImagePreview')}
                gitRead={supports('gitRead')}
                gitBranchCompare={supports('gitBranchCompare')}
                referenceAllowed={
                  fileProject === selectedProject && supports('fileReferenceInputs')
                }
                expanded={fileWorkspaceWide}
                onExpand={() => setFileWorkspaceWide((value) => !value)}
                onClose={() => setFileWorkspaceOpen(false)}
                onReference={(reference) => {
                  const refs = draft.references || [];
                  if (reference.projectId !== selectedProject) return;
                  if (refs.length >= 32) {
                    setError('最多引用 32 个文件');
                    return;
                  }
                  if (!refs.some((ref) => ref.path === reference.path))
                    updateDraft({ references: [...refs, reference] });
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLTextAreaElement>('textarea[aria-label="消息"]')
                      ?.focus(),
                  );
                  if (matchMedia('(max-width:760px)').matches) setFileWorkspaceOpen(false);
                }}
              />
            )}
            {(activeTool === 'files' || activeTool === 'changes') && !filesAvailable && (
              <p className="tool-unavailable">
                {connected
                  ? '请先选择一个项目以浏览文件和改动。'
                  : '电脑连接已断开，恢复后可继续浏览文件。'}
              </p>
            )}
            {sideChatSeen && (
              <div
                className="workspace-tool-body"
                hidden={activeTool !== 'chat'}
                inert={activeTool !== 'chat'}
              >
                <SideChat
                  request={request}
                  connection={bridge.current}
                  connected={connected}
                  snapshot={snapshot}
                  models={models}
                  capabilities={capabilities}
                  initialProject={selectedProject}
                  scope={JSON.stringify([scope, host.hostId])}
                  blocked={receiptBlocked}
                  drafts={drafts}
                  setDrafts={setDrafts}
                  onChanged={() => void refresh(false)}
                  onFile={(projectId, path) => {
                    const relative = projectRelativePath(
                      path,
                      snapshot.projects?.find((p) => p.projectId === projectId)?.canonicalPath,
                    );
                    if (!relative) {
                      setError('该文件不在当前授权项目中，无法预览');
                      return;
                    }
                    showFiles(relative, 'files', projectId);
                  }}
                />
              </div>
            )}
            {terminalSeen && toolsVisible && connected && supports('sshTerminal') && (
              <div
                className="workspace-tool-body"
                hidden={activeTool !== 'terminal'}
                inert={activeTool !== 'terminal'}
              >
                <SshTerminal request={request} visible={activeTool === 'terminal'} />
              </div>
            )}
            {activeTool === 'terminal' && (!connected || !supports('sshTerminal')) && (
              <p className="tool-unavailable">
                {connected
                  ? '当前 Host 尚不支持 SSH 终端，请升级 Host 后使用。'
                  : '请先连接电脑，再启动 SSH 终端。'}
              </p>
            )}
          </aside>
        )}
      </section>
      <MotionPresence>
        {messageAction && messageAction.kind !== 'revise' && (
          <Modal
            wide={messageAction.kind === 'read'}
            compact={messageAction.kind !== 'read'}
            title={
              messageAction.kind === 'read'
                ? '消息'
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
                  images={
                    connected && supports('projectImagePreview') && selectedProject && !chat
                      ? {
                          request,
                          projectId: selectedProject,
                          root:
                            projects.find((project) => project.projectId === selectedProject)
                              ?.canonicalPath || '',
                        }
                      : undefined
                  }
                  sessionImages={connected && supports('sessionMessageImages')}
                  connection={bridge.current}
                  sessionId={session || ''}
                />
              </div>
            ) : (
              <div className="panel-stack">
                <p>
                  {messageAction.kind === 'fork'
                    ? '从该原生轮次创建独立会话？'
                    : '回退此消息和之后的轮次？此操作会改变电脑上的原会话。'}
                </p>
                <div className="button-row">
                  <button disabled={busy} onClick={() => setMessageAction(undefined)}>
                    取消
                  </button>
                  <button
                    disabled={busy || receiptBlocked || !canManage(current)}
                    onClick={() => void runMessageAction()}
                  >
                    {busy ? '处理中…' : messageAction.kind === 'fork' ? '创建分叉' : '确认回退'}
                  </button>
                </div>
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
            className={
              panel === 'settings' || (panel === 'drafts' && settingsChild) ? 'settings-modal' : ''
            }
            header={
              panel === 'drafts' && settingsChild ? (
                <div className="modal-navigation">
                  <IconButton
                    icon={ChevronLeft}
                    label="返回设置"
                    onClick={() => {
                      setSettingsChild(false);
                      setPanel('settings');
                    }}
                  />
                  <h2>未发送草稿</h2>
                </div>
              ) : undefined
            }
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
              className={`panel-content ${panel === 'drafts' && settingsChild ? 'settings-subpage' : ''}`}
            >
              {panel === 'settings' && (
                <SettingsLayout active={settingsTab} onChange={setSettingsTab}>
                  {settingsTab === 'general' && (
                    <div className="settings-general">
                      <section className="settings-section panel-stack">
                        <label className="setting-row">
                          <span>外观</span>
                          <Select
                            aria-label="外观"
                            value={theme}
                            onValueChange={(value) => setTheme(value)}
                          >
                            <option value="system">跟随系统</option>
                            <option value="light">浅色</option>
                            <option value="dark">深色</option>
                          </Select>
                        </label>
                        <label className="setting-row">
                          <span>
                            任务通知<small>仅在应用打开时接收</small>
                          </span>
                          <input
                            type="checkbox"
                            checked={notification}
                            disabled={!('Notification' in window)}
                            onChange={async (e) => {
                              if (e.target.checked) {
                                try {
                                  const result = await Notification.requestPermission();
                                  setNotification(result === 'granted');
                                  if (result !== 'granted')
                                    setError('浏览器尚未允许通知，请在系统或网站设置中开启。');
                                } catch (error) {
                                  setError(String(error));
                                }
                              } else setNotification(false);
                            }}
                          />
                        </label>
                        {notification &&
                          (!('Notification' in window) ||
                            Notification.permission !== 'granted') && (
                            <p className="muted" role="status">
                              通知偏好已保存，当前浏览器尚未允许通知；请在系统或网站设置中开启。
                            </p>
                          )}
                      </section>
                      <section className="settings-section panel-stack">
                        <h3>安装应用</h3>
                        <InstallApp />
                        <p className="settings-installed">已安装</p>
                      </section>
                      <section className="settings-section">
                        <AppUpdates />
                      </section>
                      <section className="settings-section setting-row">
                        <div>
                          <h3>AgentDeck 账户</h3>
                        </div>
                        <button
                          className="settings-logout"
                          onClick={() =>
                            void api('/api/v1/web/logout', { method: 'POST' })
                              .then(() => location.reload())
                              .catch((e) => setError(String(e)))
                          }
                        >
                          <LogOut size={17} />
                          退出账户
                        </button>
                      </section>
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
                        className="settings-action"
                        onClick={() => {
                          setFilter('archived');
                          setSidebarOpen(true);
                          setPanel('');
                        }}
                      >
                        <span>
                          <strong>查看归档对话</strong>
                        </span>
                      </button>
                      <button className="settings-action" onClick={() => openPanel('drafts')}>
                        <span>
                          <strong>未发送草稿</strong>
                        </span>
                      </button>
                      <button
                        className="settings-action"
                        disabled={!connected}
                        onClick={() => void syncIndex()}
                      >
                        <span>
                          <strong>同步电脑已有对话</strong>
                        </span>
                      </button>
                      <ProjectSettings
                        key={host?.hostId || 'disconnected'}
                        request={request}
                        projects={projects}
                        connected={connected}
                        hostName={host ? hostName(host) : undefined}
                        currentProject={selectedProject}
                        canSync={supports('codexWorkspaceDiscovery')}
                        onChanged={() => refresh()}
                        onProject={(id) => {
                          setSelectedProject(id);
                          selectSession(undefined);
                          setPanel('');
                        }}
                      />
                    </div>
                  )}
                  {settingsTab === 'computers' && (
                    <div className="panel-stack">
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
                      <MotionList className="computer-list">
                        {hosts.map((item) => (
                          <div className="computer-entry" data-motion-item key={item.hostId}>
                            <button
                              className="host"
                              aria-current={item.hostId === host?.hostId ? 'true' : undefined}
                              onClick={() => {
                                void connect(item);
                              }}
                            >
                              <span className={`dot ${item.online ? 'online' : ''}`} />
                              <span className="computer-name">
                                <span>{hostName(item)}</span>
                              </span>
                              <small>
                                {directoryFailure ? '状态待刷新' : item.online ? '在线' : '离线'}
                              </small>
                            </button>
                            <div className="computer-actions">
                              {item.cloudDeviceId && (
                                <DeleteDevice
                                  onDeleted={() =>
                                    setHosts((current) =>
                                      current.filter((entry) => entry.hostId !== item.hostId),
                                    )
                                  }
                                  device={{
                                    deviceId: item.cloudDeviceId,
                                    displayName: hostName(item),
                                    kind: 'desktop',
                                  }}
                                />
                              )}
                              {item.hostId === host?.hostId && (
                                <IconButton
                                  icon={RefreshCw}
                                  label="重新连接"
                                  disabled={busy}
                                  onClick={() => void connect(item)}
                                />
                              )}
                            </div>
                          </div>
                        ))}
                      </MotionList>
                      {!hosts.length && <p>尚未绑定电脑。请先在电脑端登录同一账户。</p>}
                      {host && (
                        <HostNameEditor
                          key={JSON.stringify([scope, host.hostId])}
                          host={hosts.find((item) => item.hostId === host.hostId) || host}
                          onSaved={hostNameSaved}
                        />
                      )}
                    </div>
                  )}
                </SettingsLayout>
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
                  onChanged={() => {
                    setQueueRevision((value) => value + 1);
                    void refresh();
                  }}
                />
              )}
              {panel === 'projects' && connected && (
                <ProjectsPanel
                  request={request}
                  projects={projects}
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
                  {visibleDrafts.length ? (
                    <p className="muted">仅保留在当前标签页，关闭后不会保存。</p>
                  ) : (
                    <div className="panel-empty" role="status">
                      暂无未发送草稿
                    </div>
                  )}
                  {visibleDrafts.map(([key, d]) => {
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
                            `${d.attachments.length} 个附件 · ${d.skills.length} 个技能 · ${d.references?.length || 0} 个引用`}
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

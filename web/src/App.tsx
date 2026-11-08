import { useHistory } from './features/use-history';
const ConversationMenu = deferred<
  React.ComponentProps<typeof import('./features/ConversationMenu').ConversationMenu>
>(() => import('./features/ConversationMenu').then((m) => ({ default: m.ConversationMenu })));
const AgentTray = deferred<React.ComponentProps<typeof import('./features/AgentTray').AgentTray>>(
  () => import('./features/AgentTray').then((m) => ({ default: m.AgentTray })),
);
import { usePageDrafts } from './features/page-drafts';
import { useToolTabs } from './features/tools/tool-tabs';
const SettingsContents = deferred<
  React.ComponentProps<typeof import('./features/SettingsContents').SettingsContents>
>(() => import('./features/SettingsContents').then((m) => ({ default: m.SettingsContents })));
const Login = deferred<React.ComponentProps<typeof import('./features/Login').Login>>(() =>
  import('./features/Login').then((m) => ({ default: m.Login })),
);
import { errorText, t, useLocale } from './i18n';
import { MotionPresence, useMotionRetention, useSidebarMotion } from './motion';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';
import agentDeckMark from '../../assets/branding/agentdeck-mark.svg';
import { api, accountEvent } from './cloud';
import type { Bridge } from './transport/bridge';
const ReceiptRecovery = deferred<
  React.ComponentProps<typeof import('./features/recovery/ReceiptRecovery').ReceiptRecovery>
>(() =>
  import('./features/recovery/ReceiptRecovery').then((module) => ({
    default: module.ReceiptRecovery,
  })),
);

import { appendQuote } from './features/selection-quote';
const SelectionQuote = deferred<
  React.ComponentProps<typeof import('./features/SelectionQuote').SelectionQuote>
>(() => import('./features/SelectionQuote').then((m) => ({ default: m.SelectionQuote })));

import { hostName as cloudHostName, migrateHostNames, type HostName } from './features/host-names';
const AccountPassword = deferred<Record<string, never>>(() =>
  import('./AccountPassword').then((module) => ({ default: module.AccountPassword })),
);
import { contentText } from './content-text';
const RichContent = deferred<React.ComponentProps<typeof import('./RichContent').RichContent>>(() =>
  import('./RichContent').then((m) => ({ default: m.RichContent })),
);
const UserMessageImages = deferred<
  React.ComponentProps<typeof import('./RichContent').UserMessageImages>
>(() => import('./RichContent').then((m) => ({ default: m.UserMessageImages })));
import { Timeline } from './Timeline';
import { readHistoryPage } from './history-page';
const ActivityStages = deferred<
  React.ComponentProps<typeof import('./features/activity/ActivityStages').ActivityStages>
>(() => import('./features/activity/ActivityStages').then((m) => ({ default: m.ActivityStages })));
import { historyKey, mergeHistory, type HistoryEntry } from './history';
import { historyError, mergeHistorySnapshot, finalItem } from './conversation';

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
import { LoadingPlaceholder } from './features/LoadingPlaceholder';
import { useTaskAttention } from './features/notifications/use-task-attention';
import './features/notifications/task-attention.css';
import { messageQuestions, confirmedAnswers } from './features/question-replies';
import { ModeSwitcher, type WorkMode } from './features/ModeSwitcher';
import { Select } from './components/Select';
import { deferred } from './deferred';
const ApiChat = deferred<
  React.ComponentProps<typeof import('./features/api-chat/ApiChat').ApiChat>
>(() => import('./features/api-chat/ApiChat').then((module) => ({ default: module.ApiChat })));
import './features/api-chat/api-chat.css';
const Composer = deferred<React.ComponentProps<typeof import('./features/Composer').Composer>>(() =>
  import('./features/Composer').then((m) => ({ default: m.Composer })),
);
const PlanConfirmation = deferred<
  React.ComponentProps<typeof import('./features/plan/PlanConfirmation').PlanConfirmation>
>(() =>
  import('./features/plan/PlanConfirmation').then((module) => ({
    default: module.PlanConfirmation,
  })),
);
const ApprovalCard = deferred<
  React.ComponentProps<typeof import('./features/Questions').ApprovalCard>
>(() => import('./features/Questions').then((module) => ({ default: module.ApprovalCard })));
const AsyncQuestions = deferred<
  React.ComponentProps<typeof import('./features/Questions').AsyncQuestions>
>(() => import('./features/Questions').then((module) => ({ default: module.AsyncQuestions })));
const QueuedMessages = deferred<
  React.ComponentProps<typeof import('./features/queue/QueuedMessages').QueuedMessages>
>(() => import('./features/queue/QueuedMessages').then((m) => ({ default: m.QueuedMessages })));
const ComposerStatus = deferred<
  React.ComponentProps<typeof import('./features/ComposerStatus').ComposerStatus>
>(() => import('./features/ComposerStatus').then((m) => ({ default: m.ComposerStatus })));
const TurnChanges = deferred<
  React.ComponentProps<typeof import('./features/TurnChanges').TurnChanges>
>(() => import('./features/TurnChanges').then((m) => ({ default: m.TurnChanges })));
const ProjectOverview = deferred<
  React.ComponentProps<typeof import('./features/project-overview/ProjectOverview').ProjectOverview>
>(() =>
  import('./features/project-overview/ProjectOverview').then((module) => ({
    default: module.ProjectOverview,
  })),
);
import { projectRelativePath } from './features/turn-changes';
import { turnOptions, resources } from './features/composer-options';
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

import { IconButton, Modal } from './ui';
import { AnswerFeedback, AnswerTime, ForkAnswerIcon } from './features/AnswerFeedback';
import { MessageBubble } from './features/MessageBubble';
import {
  Menu,
  ChevronDown,
  ChevronLeft,
  ChevronsUpDown,
  Check,
  Computer,
  LaptopMinimal,
  MoreHorizontal,
  FolderOpen,
  Folder,
  Search,
  Copy,
  Quote,
  RotateCcw,
  GitFork,
  SquarePen,
  X,
} from 'lucide-react';
import { connectionLabels, type ReconnectLoop } from './transport/reconnect';
import type { ConnectionState } from './transport/reconnect';
const TaskProgress = deferred<
  React.ComponentProps<typeof import('./features/TaskProgress').TaskProgress>
>(() => import('./features/TaskProgress').then((m) => ({ default: m.TaskProgress })));
const MessageEditor = deferred<
  React.ComponentProps<typeof import('./features/MessageEditor').MessageEditor>
>(() => import('./features/MessageEditor').then((module) => ({ default: module.MessageEditor })));
import { answerActions } from './features/answer-actions';

const HostUpdates = deferred<
  React.ComponentProps<typeof import('./features/HostUpdates').HostUpdates>
>(
  () => import('./features/HostUpdates').then((module) => ({ default: module.HostUpdates })),
  () => null,
);
const FileWorkspace = deferred<
  React.ComponentProps<typeof import('./features/files/FileWorkspace').FileWorkspace>
>(
  () =>
    import('./features/files/FileWorkspace').then((module) => ({ default: module.FileWorkspace })),
  () => (
    <aside className="file-workspace module-status" role="status">
      {t('加载文件工作区…')}
    </aside>
  ),
);
import './features/files/file-workspace.css';
import { ToolsButton, ToolHeader, ToolLauncher, type Tool } from './features/tools/ToolsNavigation';
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

export function App() {
  useLocale();
  const [bubbleColor, setBubbleColor] = usePreference(
    'agentdeck.web.bubble-color',
    'default',
    (value): value is string =>
      typeof value === 'string' && ['default', 'blue', 'green', 'purple', 'gray'].includes(value),
  );
  useEffect(() => {
    document.documentElement.dataset.bubbleColor = bubbleColor;
  }, [bubbleColor]);
  const [mode, setMode] = usePreference<WorkMode>(
    'agentdeck.web.work-mode',
    'codex',
    (value): value is WorkMode => value === 'codex' || value === 'api',
  );
  const modeControl = <ModeSwitcher mode={mode} onChange={setMode} />;
  return mode === 'api' ? (
    <ApiChatGate modeControl={modeControl} />
  ) : (
    <CodexApp modeControl={modeControl} bubbleColor={bubbleColor} setBubbleColor={setBubbleColor} />
  );
}
function ApiChatGate({ modeControl }: { modeControl: React.ReactNode }) {
  useLocale();
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
  if (identity === undefined) return <main className="center">{t('加载中…')}</main>;
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
function CodexApp({
  modeControl,
  bubbleColor,
  setBubbleColor,
}: {
  modeControl: React.ReactNode;
  bubbleColor: string;
  setBubbleColor: (value: string) => void;
}) {
  useLocale();
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
  const {
    entries: history,
    current: historyRef,
    revision: viewRevision,
    update: setHistory,
  } = useHistory();
  const renderedHistory = history;
  const [historyCursor, setHistoryCursor] = useState<string | undefined>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFailure, setHistoryFailure] = useState('');
  const [historyReady, setHistoryReady] = useState(false);
  const [drafts, setDrafts] = usePageDrafts(scope);
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width:760px)').matches);
  const conversationElement = useSidebarMotion(sidebarOpen);
  const [panel, setPanel] = useState('');
  const [manageSession, setManageSession] = useState<Session>();
  const [menuLoaded, setMenuLoaded] = useState(false);
  const [menu, setMenu] = useState(false),
    [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all');
  const [find, setFind] = useState(''),
    [findIndex, setFindIndex] = useState(0);
  const [theme, setTheme] = useState(() => localStorage.getItem('agentdeck.web.theme') || 'dark');
  const [preferences, setPreferences] = useState<Record<string, ComposerPreferences>>({});
  const [modelPreferences, setModelPreferences] = useState<
    Record<string, ComposerModelPreferences>
  >({});
  const [receiptBlocked, setReceiptBlocked] = useState(false);
  const [receiptNotice, setReceiptNotice] = useState('');
  const [messageAction, setMessageAction] = useState<{
    entry: HistoryEntry;
    kind: 'revise' | 'read' | 'fork';
  }>();
  const [editText, setEditText] = useState('');
  const [editError, setEditError] = useState('');
  const messageActionPending = useRef(false);
  const [notification, setNotification] = usePreference(
    'agentdeck.web.notifications',
    false,
    (value): value is boolean => typeof value === 'boolean',
  );
  const attention = useTaskAttention(scope, host?.hostId, snapshot, notification);
  const attentionRef = useRef(attention);
  attentionRef.current = attention;
  useEffect(() => {
    if (!historyReady || !connected || !session) return;
    for (const entry of history) {
      const questions = messageQuestions(entry);
      if (
        !entry.item?.id ||
        !questions.length ||
        confirmedAnswers(history, entry.item.id).size >= questions.length
      )
        continue;
      attention.receive({
        action: 'upstream.progress',
        sessionId: session,
        payload: { method: 'item/completed', item: entry.item },
      });
    }
  }, [history, historyReady, connected, session, attention.receive]);
  const [statusRevision, setStatusRevision] = useState(0);
  const [queueRevision, setQueueRevision] = useState(0);
  const [observedUsage, setObservedUsage] =
    useState<Parameters<typeof ComposerStatus>[0]['observedUsage']>();
  const [fileWorkspaceOpen, setFileWorkspaceOpen] = useState(false);
  const toolsVisible = fileWorkspaceOpen && !!host;
  const retainTools = useMotionRetention(toolsVisible, 320);
  const [fileWorkspaceWide, setFileWorkspaceWide] = useState(false);
  const toolTabs = useToolTabs(JSON.stringify([scope, host?.hostId]));
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
  const draftProjectRef = useRef<string | undefined>(undefined);
  if (!session && draftProjectRef.current !== undefined) draftProjectRef.current = selectedProject;
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
    draftProjectRef.current = !id && persist ? selectedProject : undefined;
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
        id || `new:${selectedProject}`,
      );
  }

  useEffect(() => {
    if (host && !session && draftProjectRef.current !== undefined)
      localStorage.setItem(
        `agentdeck.web.selection.${scope}.${host.hostId}`,
        `new:${selectedProject}`,
      );
  }, [host, session, selectedProject, scope]);

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
        throw new Error(t('电脑连接已变化，请重新打开'));
      try {
        const result = await connection.request<T>(action, payload);
        if (epoch !== connectionEpoch.current) throw new Error(t('电脑已经切换'));
        return result;
      } finally {
        if (epoch === connectionEpoch.current) setReceiptBlocked(connection.awaitingReceipt);
      }
    };
  }, [connected, host?.hostId]);
  useEffect(() => {
    const media = matchMedia('(max-width:760px)');
    const changed = (event: MediaQueryListEvent) => {
      setMobile(event.matches);
      setSidebarOpen(!event.matches);
    };
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
            migrationFailure = t('旧电脑名称尚未同步到服务器，正在重试；本地名称已保留。');
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
                ? t('云端电脑列表刷新超时，显示的是上次状态；正在重试。')
                : t('云端电脑列表暂时无法刷新，显示的是上次状态；正在重试。'),
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
        } else setError(t('状态同步失败：{{p0}}', { p0: String(error) }));
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
    setReceiptNotice('');
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
    try {
      const { startHostConnection } = await import('./transport/host-connection');
      if (epoch !== connectionEpoch.current) return;
      startHostConnection(next, epoch, {
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
      });
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
              ? t('请继续调整以下计划：\n\n{{p0}}\n\n调整要求：{{p1}}', {
                  p0: planText,
                  p1: revision,
                })
              : t('请按照以下计划开始开发：\n\n{{p0}}', { p0: planText }),
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
        throw new Error(t('文件引用的项目已变化或 Host 需要升级，请重新引用'));
      source = { ...source, ...resolveComposerModelPreferences(source, models) };
      let id = session;
      if (!id) {
        const created = await connection.request<{ session?: Session }>('sessions.create', {
          projectId: selectedProject,
          title: source.text.trim().slice(0, 80) || t('New conversation'),
        });
        if (epoch !== connectionEpoch.current) return;
        id = created.session?.sessionId;
        if (!id) throw new Error(t('电脑没有返回会话标识'));
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
            throw new Error(t('带资源的消息请加入待发送队列'));
          const active = await connection.request<{ upstreamTurnId?: string }>('turn.active', {
            sessionId: id,
          });
          if (!active.upstreamTurnId) throw new Error(t('当前任务已变化，请刷新核对'));
          await connection.request('turn.steer', {
            sessionId: id,
            expectedTurnId: active.upstreamTurnId,
            text: source.text.trim(),
          });
        } else {
          if (!supports('nativeQueue'))
            throw new Error(t('当前电脑不支持待发送队列，请等待任务完成或选择立即补充'));
          if (
            (source.attachments.length && !supports('nativeQueueAttachments')) ||
            (source.skills.length && !supports('nativeQueueSkills')) ||
            (source.references?.length && !supports('fileReferenceInputs'))
          )
            throw new Error(t('当前电脑不支持队列中的这些资源'));
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
          ...turnOptions(
            chat ? { ...source, mode: 'default', skills: [] } : source,
            permission,
            supports('turnResponseSpeed'),
          ),
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
        if (!active.upstreamTurnId) throw new Error(t('任务已变化，请刷新核对'));
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
    if (!bridge.current) throw new Error(t('电脑连接已断开，请重新连接后核对审批'));
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
    attention.read(item.sessionId);
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
      setError(t('该文件不在当前授权项目中，无法预览'));
      return;
    }
    showFiles(relative);
  }
  function showFiles(
    path?: string,
    view: 'files' | 'changes' = 'files',
    projectId = selectedProject,
  ) {
    toolTabs.openTool(view, projectId, path);
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
    toolTabs.openTool(tool, selectedProject);
    setFileWorkspaceOpen(true);
    setPanel('');
    setMenu(false);
    setWorkspaceMenu(false);
    if (matchMedia('(max-width:1300px)').matches) setSidebarOpen(false);
  }
  function openTools() {
    if (!toolTabs.tabs.length) toolTabs.newTab();
    setFileWorkspaceOpen(true);
    if (matchMedia('(max-width:1300px)').matches) setSidebarOpen(false);
  }
  function openAgent(id: string) {
    const item = snapshot.sessions?.find((s) => s.upstreamThreadId === id);
    if (item) chooseSession(item);
    else setError(t('此代理会话尚未同步或不在授权项目中'));
  }
  function openPanel(name: string) {
    if (chat && ['files', 'git', 'skills', 'goal'].includes(name)) {
      setError(t('普通聊天不使用项目文件、技能或任务目标。请先切换到项目。'));
      return;
    }
    if (name === 'files' || name === 'git') {
      showFiles(undefined, name === 'git' ? 'changes' : 'files');
      return;
    }
    setMenu(false);
    setWorkspaceMenu(false);
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
      messageAction.kind === 'read' ||
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
          throw new Error(t('请先停止或核对当前任务'));
        await request('sessions.revise', {
          sessionId: id,
          beforeTurnId: entry.turnId,
          expectedLastTurnId: latest.turn.upstreamTurnId,
          itemId: entry.item?.id,
          text: editText.trim(),
          permissionMode: permission,
          mode: draft.mode,
          ...(supports('turnResponseSpeed') && draft.responseSpeed
            ? { responseSpeed: draft.responseSpeed }
            : {}),
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
          .querySelector<HTMLElement>(
            `[data-history-key="${CSS.escape(historyKey(entry))}"] .message-content[tabindex]`,
          )
          ?.focus({ preventScroll: true }),
      );
  }
  const [settingsTab, setSettingsTab] = usePreference(
    'agentdeck.web.settingsTab',
    'general',
    (value): value is string =>
      typeof value === 'string' && ['general', 'conversations', 'computers'].includes(value),
  );
  const titles: Record<string, string> = {
    settings: t('设置'),
    manage: t('管理会话'),
    goal: t('会话目标'),
    files: t('项目文件'),
    git: t('工作区改动'),
    skills: t('技能'),
    queue: t('待发送消息'),
    projects: t('项目'),
    find: t('在会话中查找'),
    search: t('搜索会话'),
    history: t('会话历史'),
  };
  const targetSession =
    snapshot.sessions?.find((s) => s.sessionId === manageSession?.sessionId) || current;
  const entriesByTurn = useMemo(() => {
    const turns = new Map<string | undefined, HistoryEntry[]>();
    for (const entry of renderedHistory) {
      const entries = turns.get(entry.turnId);
      if (entries) entries.push(entry);
      else turns.set(entry.turnId, [entry]);
    }
    return turns;
  }, [renderedHistory]);
  const answers = answerActions(
    renderedHistory,
    snapshot.turns?.find((turn) => turn.turnId === activeTurn)?.upstreamTurnId || activeTurn,
    contentText,
  );
  const canEditUserMessage =
    connected &&
    !busy &&
    !receiptBlocked &&
    !activeTurn &&
    historyReady &&
    current?.archived !== 1 &&
    canManage(current) &&
    supports('sessionHistoryRevert');
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
      const stage = node?.closest<HTMLDetailsElement>('.activity-stage');
      if (stage) stage.open = true;
      node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      node?.classList.add('search-highlight');
      setTimeout(() => node?.classList.remove('search-highlight'), 2000);
    });
  }

  if (signedIn === null) return <main className="center">{t('加载中…')}</main>;
  if (!signedIn) return <Login onLogin={() => location.reload()} />;
  if (mustChangePassword) return <AccountPassword />;
  const filesAvailable = connected && !!selectedProject && selectedProject !== chatProject;
  const filesVisible =
    toolsVisible && ['files', 'changes'].includes(toolTabs.activeTab?.tool || '');
  return (
    <div
      className={`shell ${sidebarOpen ? 'with-sidebar' : ''} ${toolsVisible ? 'has-file-workspace' : ''}`}
    >
      <Sidebar
        key={JSON.stringify([scope, host?.hostId])}
        brand={modeControl}
        hosts={hosts.map((item) => ({ ...item, displayName: hostName(item) }))}
        onHost={(item) => {
          if (item.hostId !== host?.hostId) void connect(item);
        }}
        sessions={snapshot.sessions || []}
        unread={attention.unread}
        connected={connected}
        loading={
          !!host &&
          !snapshot.sessions &&
          (busy || ['connecting', 'retrying', 'syncing'].includes(connectionState))
        }
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
            throw new Error(t('请先等待任务结束或核对当前状态'));
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
        className={`conversation-layout ${retainTools ? 'with-file-workspace' : ''} ${fileWorkspaceWide ? 'file-workspace-wide' : ''}`}
        ref={conversationElement}
        style={{ '--file-pane-width': `${filePaneWidth}%` } as React.CSSProperties}
      >
        <section
          className={`conversation${!session ? ' is-new-conversation' : ''}`}
          inert={mobile && toolsVisible}
          onPointerDownCapture={(event) => {
            if (session && (event.target as Element).closest('.timeline, .composer-wrap'))
              attention.read(session);
          }}
          onFocusCapture={(event) => {
            if (
              session &&
              document.visibilityState === 'visible' &&
              (event.target as Element).closest('.timeline, .composer-wrap')
            )
              attention.read(session);
          }}
          onInputCapture={() => {
            if (session) attention.read(session);
          }}
        >
          <header className="topbar">
            <IconButton
              icon={session || matchMedia('(max-width:760px)').matches ? ChevronLeft : Menu}
              label={t('打开会话列表')}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={`conversation-back${sidebarOpen ? ' rail-toggle' : ''}`}
              badge={Object.keys(attention.unread).length ? t('有未读任务提醒') : undefined}
            />
            <div className="workspace-anchor">
              <button
                className="workspace-title"
                aria-label={t('切换项目')}
                aria-expanded={workspaceMenu}
                onClick={() => setWorkspaceMenu(!workspaceMenu)}
              >
                <span>
                  {current
                    ? current.title || t('未命名会话')
                    : chat
                      ? t('普通聊天')
                      : projects.find((p) => p.projectId === selectedProject)?.name ||
                        t('选择项目')}
                </span>
                <ChevronDown size={16} />
              </button>
              <button className="conversation-subtitle" onClick={() => openPanel('computers')}>
                <span>
                  {chat
                    ? t('普通聊天')
                    : projects.find((p) => p.projectId === selectedProject)?.name}
                </span>
                {host && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{hostName(host)}</span>
                  </>
                )}
              </button>
              <MotionPresence>
                {workspaceMenu && (
                  <>
                    <button
                      className="menu-scrim"
                      aria-label={t('关闭项目菜单')}
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
                          {t('管理项目')}
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
              title={connectionLabels[connectionState]}
              aria-label={connectionLabels[connectionState]}
              role="status"
            >
              <span
                className={`dot ${connected || connectionState === 'syncing' ? 'online' : ''}`}
              />
              {connectionState !== 'connected' && connectionLabels[connectionState]}
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
                    history={renderedHistory}
                    draft={draft}
                    connection={bridge.current}
                    sessionId={session || ''}
                    onEntry={jumpTo}
                    onAddSources={
                      !busy &&
                      !receiptBlocked &&
                      supports('attachments') &&
                      draft.attachments.length < 4 &&
                      (!session || historyReady) &&
                      current?.archived !== 1
                        ? () =>
                            document
                              .querySelector<HTMLInputElement>(
                                '.conversation .composer input[type="file"]',
                              )
                              ?.click()
                        : undefined
                    }
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
                onOpen={() => (toolsVisible ? setFileWorkspaceOpen(false) : openTools())}
                open={toolsVisible}
              />
            )}
            <IconButton
              icon={Computer}
              className="header-computers"
              label={t('切换电脑')}
              onClick={() => openPanel('computers')}
            />
            <IconButton
              icon={SquarePen}
              label={t('新建会话')}
              className="header-new-conversation"
              onClick={newChat}
            />
            <div className="menu-anchor">
              <IconButton
                icon={MoreHorizontal}
                label={t('更多操作')}
                onClick={() => {
                  setMenuLoaded(true);
                  setMenu(!menu);
                }}
              />
              {menuLoaded && (
                <ConversationMenu
                  key={JSON.stringify([scope, host?.hostId, session])}
                  open={menu}
                  onClose={() => setMenu(false)}
                  session={current}
                  connected={connected}
                  blocked={busy || receiptBlocked}
                  capabilities={capabilities}
                  request={request}
                  directory={
                    !chat
                      ? projects.find((p) => p.projectId === selectedProject)?.canonicalPath
                      : undefined
                  }
                  onPanel={openPanel}
                  onTools={
                    host
                      ? () => {
                          setMenu(false);
                          openTools();
                        }
                      : undefined
                  }
                  onChanged={() => refresh(false)}
                  onSelect={chooseSession}
                  onError={setError}
                  onSideChat={(sessionId) => {
                    toolTabs.openTool('chat', selectedProject, undefined, false, sessionId);
                    setFileWorkspaceOpen(true);
                    setPanel('');
                    if (matchMedia('(max-width:1300px)').matches) setSidebarOpen(false);
                  }}
                />
              )}
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
                  ? t('连接已恢复，正在同步最新进度…')
                  : connectionFailure || t('正在重新连接电脑；现有消息和草稿已保留。')}
              </div>
            )}
          </MotionPresence>
          <MotionPresence>
            {upstreamRetry && (
              <div className="connection-recovery" role="status">
                {t('Codex 正在重试 · ')}
                {upstreamRetry}
              </div>
            )}
          </MotionPresence>
          <MotionPresence>
            {error && (
              <div className="connection-error" role="status">
                <span>{errorText(error)}</span>
                <IconButton icon={X} label={t('关闭提示')} onClick={() => setError('')} />
              </div>
            )}
          </MotionPresence>
          <MotionPresence>
            {(receiptBlocked || receiptNotice) && (
              <ReceiptRecovery
                key={`${scope}:${host?.hostId}`}
                connection={bridge.current}
                connected={connected}
                blocked={receiptBlocked}
                notice={receiptNotice}
                onChecked={(message) => {
                  setReceiptBlocked(bridge.current?.awaitingReceipt === true);
                  setReceiptNotice(message || '');
                  void refresh();
                }}
                onDismiss={() => setReceiptNotice('')}
              />
            )}
          </MotionPresence>
          <MotionPresence>
            {historyFailure && (
              <div className="history-error" role="alert">
                {historyFailure}
                <button onClick={() => void refresh()}>{t('重试读取')}</button>
              </div>
            )}
          </MotionPresence>
          {activeTurn && (
            <TaskProgress
              entries={renderedHistory}
              active={!!activeTurn}
              turnId={
                snapshot.turns?.find((turn) => turn.turnId === activeTurn)?.upstreamTurnId ||
                activeTurn
              }
              stale={!connected}
            />
          )}
          {renderedHistory.length > 0 && (
            <SelectionQuote
              key={draftKey}
              container={conversationElement}
              onQuote={(text) => {
                updateDraft({ text: appendQuote(draft.text, text) });
                requestAnimationFrame(() => {
                  const input =
                    conversationElement.current?.querySelector<HTMLTextAreaElement>(
                      '.composer textarea',
                    );
                  input?.focus();
                  if (input) input.setSelectionRange(input.value.length, input.value.length);
                });
              }}
            />
          )}
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
                  {historyLoading ? t('加载中…') : t('加载更早记录')}
                </button>
              )}
              {renderedHistory.length > 0 && (
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
                      actionText = assistant ? answers.get(entry) : undefined,
                      separateLocalImages = mobile && user && supports('sessionMessageImages'),
                      onlyLocalImages =
                        separateLocalImages &&
                        !text &&
                        Array.isArray(item.content) &&
                        item.content.length > 0 &&
                        item.content.every((part) => part?.type === 'localImage'),
                      editing =
                        messageAction?.kind === 'revise' &&
                        historyKey(messageAction.entry) === historyKey(entry);
                    return (
                      <article
                        className={`turn ${user ? 'user-turn' : assistant ? 'assistant-turn' : 'activity-turn'}`}
                        key={historyKey(entry)}
                        data-history-key={historyKey(entry)}
                      >
                        {separateLocalImages && !editing && (
                          <UserMessageImages
                            entry={entry}
                            connection={connected ? bridge.current : undefined}
                            sessionId={session || ''}
                          />
                        )}
                        {(!onlyLocalImages || editing) && (
                          <MessageBubble
                            className={`message-content${editing ? ' editing-message' : ''}`}
                            onEdit={
                              user && text && canEditUserMessage && !editing
                                ? () => editMessage(entry)
                                : undefined
                            }
                          >
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
                                separateLocalImages={separateLocalImages}
                                connection={bridge.current}
                                sessionId={session || ''}
                                onFile={supports('projectTextPreview') ? openFile : undefined}
                                onAgent={openAgent}
                              />
                            )}
                          </MessageBubble>
                        )}
                        {actionText && !editing && (
                          <div className="message-actions answer-actions">
                            <IconButton
                              icon={Copy}
                              className="answer-copy"
                              label={t('复制消息')}
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText(actionText)
                                  .catch((e) => setError(String(e)))
                              }
                            />
                            {mobile && (
                              <AnswerFeedback
                                answerKey={JSON.stringify([
                                  scope,
                                  host?.hostId,
                                  session,
                                  historyKey(entry),
                                ])}
                              />
                            )}
                            <IconButton
                              icon={Quote}
                              className="answer-action-desktop"
                              label={t('引用消息')}
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
                              className="answer-action-desktop"
                              label={t('阅读完整消息')}
                              onClick={() => {
                                setMessageAction({
                                  entry: { ...entry, item: { ...item, text: actionText } },
                                  kind: 'read',
                                });
                              }}
                            />
                            {supports('sessionHistoryRevert') && (
                              <IconButton
                                icon={RotateCcw}
                                className="answer-action-desktop"
                                label={t('重试此回答')}
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
                                    setError(t('此轮用户消息尚未加载，请先加载更早记录'));
                                    return;
                                  }
                                  editMessage(before);
                                }}
                              />
                            )}
                            {supports('sessionForkAtTurn') && (
                              <IconButton
                                icon={mobile ? ForkAnswerIcon : GitFork}
                                label={t('从此处分叉')}
                                disabled={busy || receiptBlocked || !!activeTurn}
                                onClick={() => setMessageAction({ entry, kind: 'fork' })}
                              />
                            )}
                            {mobile && (
                              <AnswerTime timestamp={entry.completedAtMs ?? entry.startedAtMs} />
                            )}
                          </div>
                        )}
                        {!user &&
                          !activeTurn &&
                          renderedHistory[entryIndex + 1]?.turnId !== entry.turnId && (
                            <TurnChanges
                              entries={entriesByTurn.get(entry.turnId)!}
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
              )}
              {!renderedHistory.length &&
                !historyFailure &&
                session &&
                !historyReady &&
                (connected ||
                  busy ||
                  ['connecting', 'retrying', 'syncing'].includes(connectionState)) && (
                  <LoadingPlaceholder conversation />
                )}
              {!renderedHistory.length && !historyFailure && !(session && !historyReady) && (
                <div className="empty">
                  <div
                    className="empty-symbol"
                    aria-hidden="true"
                    style={{
                      maskImage: `url("${agentDeckMark}")`,
                      WebkitMaskImage: `url("${agentDeckMark}")`,
                    }}
                  />
                  <h1>{chat ? t('聊点什么？') : t('What can we build?')}</h1>
                  <p>
                    {connected
                      ? chat
                        ? t('无需选择项目，直接开始对话。')
                        : t('选择项目，开始一段 Codex 对话。')
                      : t('连接你的电脑，随时继续工作。')}
                  </p>
                  {!connected && (
                    <button onClick={() => openPanel('computers')}>
                      <Computer size={17} />
                      {t('连接电脑')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </Timeline>
          {!session && (
            <div className="new-conversation-context">
              <div className="new-context-row">
                <LaptopMinimal size={20} aria-hidden="true" />
                {hosts.length ? (
                  <Select
                    aria-label={t('切换电脑')}
                    chevron={ChevronsUpDown}
                    value={host?.hostId || ''}
                    onValueChange={(id) => {
                      const next = hosts.find((item) => item.hostId === id);
                      if (next && next.hostId !== host?.hostId) void connect(next);
                    }}
                  >
                    {!host && <option value="">{t('选择电脑')}</option>}
                    {hosts.map((item) => (
                      <option key={item.hostId} value={item.hostId}>
                        {hostName(item)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <button onClick={() => openPanel('computers')}>{t('连接电脑')}</button>
                )}
              </div>
              <div className="new-context-row">
                <Folder size={20} aria-hidden="true" />
                <Select
                  aria-label={t('切换项目')}
                  chevron={ChevronsUpDown}
                  value={selectedProject}
                  disabled={!connected}
                  onValueChange={(id) => {
                    setSelectedProject(id);
                    selectSession(undefined);
                  }}
                >
                  {!selectedProject && <option value="">{t('选择项目')}</option>}
                  {supports('projectlessChat') && (
                    <option value={chatProject}>{t('普通聊天')}</option>
                  )}
                  {projects.map((item) => (
                    <option key={item.projectId} value={item.projectId}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}
          {selectedProject && (
            <Composer
              key={draftKey}
              draft={draft}
              placeholder={
                activeTurn
                  ? t('跟进')
                  : host
                    ? t('在 {{p0}} 上工作', { p0: hostName(host) })
                    : undefined
              }
              contextControl={
                session && host && supports('sessionTokenUsage') ? (
                  <ComposerStatus
                    key={`usage-${session}`}
                    compact
                    request={request}
                    sessionId={session}
                    goalSupported={false}
                    usageSupported
                    revision={statusRevision}
                    observedUsage={observedUsage}
                    onGoal={() => openPanel('goal')}
                    enabled={connected}
                  />
                ) : undefined
              }
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
                <>
                  <AgentTray
                    entries={renderedHistory}
                    sessions={snapshot.sessions || []}
                    onSelect={openAgent}
                  />
                  {session && host ? (
                    <ComposerStatus
                      key={session}
                      request={request}
                      sessionId={session}
                      goalSupported={!chat && supports('sessionGoalView')}
                      usageSupported={false}
                      revision={statusRevision}
                      observedUsage={observedUsage}
                      onGoal={() => openPanel('goal')}
                      enabled={connected}
                    />
                  ) : undefined}
                </>
              }
              onChange={updateDraft}
              models={models}
              supports={composerSupports}
              attachmentTotalBytes={capabilities.limits?.attachmentTotalBytes}
              chat={chat}
              disabledReason={
                !connected
                  ? connectionState === 'syncing'
                    ? t('正在同步会话历史，请稍候…')
                    : t('连接尚未恢复，请稍候…')
                  : receiptBlocked
                    ? t('操作结果待核对，请先查看上方提示')
                    : session && !historyReady
                      ? historyFailure
                        ? t('历史读取失败，请点击上方重试')
                        : t('正在同步会话历史，请稍候…')
                      : current?.archived === 1
                        ? t('会话已归档，请先恢复会话')
                        : !selectedProject
                          ? t('请选择项目后开始')
                          : undefined
              }
              disabled={
                !connected ||
                !selectedProject ||
                receiptBlocked ||
                !!(session && !historyReady) ||
                current?.archived === 1
              }
              feedback={
                receiptBlocked
                  ? t('发送结果尚未确认，请先核对任务状态，避免重复发送。')
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
          )}
        </section>
        {toolsVisible && (
          <div
            className="file-pane-resizer"
            role="separator"
            aria-label={t('调整对话与工具栏宽度')}
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
        {toolTabs.tabs.length > 0 && host && (
          <aside
            key={JSON.stringify([scope, host.hostId])}
            className="file-workspace tools-workspace"
            hidden={!toolsVisible}
            inert={!toolsVisible}
            aria-label={t('工作区工具栏')}
          >
            <ToolHeader
              tabs={toolTabs.tabs}
              active={toolTabs.active}
              onSelect={toolTabs.selectTab}
              onNew={toolTabs.newTab}
              onCloseTab={toolTabs.closeTab}
              expanded={fileWorkspaceWide}
              onExpand={() => setFileWorkspaceWide((value) => !value)}
              onClose={() => setFileWorkspaceOpen(false)}
            />
            {toolTabs.tabs.map((tab) => {
              const visible = retainTools && tab.id === toolTabs.active;
              const fileProject = tab.projectId;
              const tabFilesAvailable = connected && !!fileProject && fileProject !== chatProject;
              return (
                <div
                  key={tab.id}
                  className="tool-tab-panel"
                  role="tabpanel"
                  id={`tool-panel-${tab.id}`}
                  aria-labelledby={`tool-tab-${tab.id}`}
                  hidden={!visible}
                  inert={!visible}
                >
                  {!tab.tool && (
                    <ToolLauncher
                      fileAvailable={filesAvailable}
                      onOpen={(tool) => toolTabs.openTool(tool, selectedProject, undefined, false)}
                    />
                  )}
                  {(tab.tool === 'files' || tab.tool === 'changes') &&
                    connected &&
                    tabFilesAvailable && (
                      <FileWorkspace
                        embedded
                        key={JSON.stringify([connectionEpoch.current, host?.hostId, fileProject])}
                        request={request}
                        projectId={fileProject}
                        projectName={
                          projects.find((project) => project.projectId === fileProject)?.name ||
                          t('项目')
                        }
                        storageKey={`agentdeck.web.files.${tab.id}.${JSON.stringify([scope, host?.hostId, fileProject])}`}
                        visible={visible}
                        initialPath={tab.path}
                        initialView={tab.tool === 'changes' ? 'changes' : 'files'}
                        openToken={tab.openToken}
                        imagePreview={supports('projectImagePreview')}
                        gitRead={supports('gitRead')}
                        gitBranchCompare={supports('gitBranchCompare')}
                        referenceAllowed={
                          fileProject === selectedProject && supports('fileReferenceInputs')
                        }
                        expanded={fileWorkspaceWide}
                        onExpand={() => setFileWorkspaceWide((value) => !value)}
                        onClose={() => toolTabs.closeTab(tab.id)}
                        onReference={(reference) => {
                          const refs = draft.references || [];
                          if (reference.projectId !== selectedProject) return;
                          if (refs.length >= 32) {
                            setError(t('最多引用 32 个文件'));
                            return;
                          }
                          if (!refs.some((ref) => ref.path === reference.path))
                            updateDraft({ references: [...refs, reference] });
                          requestAnimationFrame(() =>
                            document
                              .querySelector<HTMLTextAreaElement>('.composer textarea')
                              ?.focus(),
                          );
                          if (matchMedia('(max-width:760px)').matches) setFileWorkspaceOpen(false);
                        }}
                      />
                    )}
                  {(tab.tool === 'files' || tab.tool === 'changes') && !tabFilesAvailable && (
                    <p className="tool-unavailable">
                      {connected
                        ? t('请先选择一个项目以浏览文件和改动。')
                        : t('电脑连接已断开，恢复后可继续浏览文件。')}
                    </p>
                  )}
                  {tab.tool === 'chat' && (
                    <div className="workspace-tool-body" hidden={!visible} inert={!visible}>
                      <SideChat
                        request={request}
                        connection={bridge.current}
                        connected={connected}
                        snapshot={snapshot}
                        models={models}
                        capabilities={capabilities}
                        initialProject={tab.projectId}
                        initialSession={tab.sessionId}
                        instanceId={tab.id}
                        scope={JSON.stringify([scope, host.hostId])}
                        blocked={receiptBlocked}
                        drafts={drafts}
                        setDrafts={setDrafts}
                        onChanged={() => void refresh(false)}
                        onFile={(projectId, path) => {
                          const relative = projectRelativePath(
                            path,
                            snapshot.projects?.find((p) => p.projectId === projectId)
                              ?.canonicalPath,
                          );
                          if (!relative) {
                            setError(t('该文件不在当前授权项目中，无法预览'));
                            return;
                          }
                          showFiles(relative, 'files', projectId);
                        }}
                      />
                    </div>
                  )}
                  {tab.tool === 'terminal' && (
                    <div className="workspace-tool-body" hidden={!visible} inert={!visible}>
                      {!supports('projectTerminal') || !tab.projectId ? (
                        <p className="tool-unavailable">
                          {!tab.projectId
                            ? t('请先选择项目，再启动终端。')
                            : connected
                              ? t('当前 Host 尚不支持项目终端，请升级 Host 后使用。')
                              : t('请先连接电脑，再启动终端。')}
                        </p>
                      ) : null}
                      {tab.projectId && (
                        <SshTerminal
                          request={request}
                          visible={toolsVisible && visible}
                          connected={connected && supports('projectTerminal')}
                          projectId={tab.projectId}
                          directory={
                            snapshot.projects?.find((p) => p.projectId === tab.projectId)
                              ?.canonicalPath || tab.projectId
                          }
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </aside>
        )}
      </section>
      <MotionPresence>
        {messageAction && messageAction.kind !== 'revise' && (
          <Modal
            wide={messageAction.kind === 'read'}
            compact={messageAction.kind !== 'read'}
            title={messageAction.kind === 'read' ? t('消息') : t('从此处分叉')}
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
                <p>{t('从该原生轮次创建独立会话？')}</p>
                <div className="button-row">
                  <button disabled={busy} onClick={() => setMessageAction(undefined)}>
                    {t('取消')}
                  </button>
                  <button
                    disabled={busy || receiptBlocked || !canManage(current)}
                    onClick={() => void runMessageAction()}
                  >
                    {busy ? t('处理中…') : t('创建分叉')}
                  </button>
                </div>
                {error && <p className="error">{errorText(error)}</p>}
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
            className={panel === 'settings' ? 'settings-modal' : ''}
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
              {panel === 'settings' && (
                <SettingsContents
                  settingsTab={settingsTab}
                  setSettingsTab={setSettingsTab}
                  theme={theme}
                  setTheme={setTheme}
                  bubbleColor={bubbleColor}
                  setBubbleColor={setBubbleColor}
                  notification={notification}
                  setNotification={setNotification}
                  setError={setError}
                  connected={connected}
                  request={request}
                  supports={supports}
                  setPanel={setPanel}
                  host={host}
                  projects={projects}
                  hostName={hostName}
                  selectedProject={selectedProject}
                  refresh={refresh}
                  setSelectedProject={setSelectedProject}
                  selectSession={selectSession}
                  directoryFailure={directoryFailure}
                  connectionFailure={connectionFailure}
                  hosts={hosts}
                  connect={connect}
                  setHosts={setHosts}
                  busy={busy}
                  scope={scope}
                  hostNameSaved={hostNameSaved}
                />
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
                <p className="muted">{t('请先连接电脑并选择项目。')}</p>
              )}
              {['manage', 'goal', 'queue', 'projects'].includes(panel) && !connected && (
                <p className="muted">{t('请先连接电脑。')}</p>
              )}
              {['goal', 'queue', 'manage'].includes(panel) && connected && !session && (
                <p className="muted">{t('请先选择会话。')}</p>
              )}
              {panel === 'search' && (
                <div className="panel-stack">
                  <input
                    autoFocus
                    id="session-search"
                    aria-label={t('搜索会话')}
                    placeholder={t('搜索会话名称或项目')}
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
                      <strong>{s.title || t('未命名会话')}</strong>
                      <span>
                        {snapshot.projects?.find((p) => p.projectId === s.projectId)?.name}
                        {s.archived === 1 ? t(' · 已归档') : ''}
                      </span>
                    </button>
                  ))}
                  {!matchingSessions.length && <p className="muted">{t('没有匹配的会话')}</p>}
                </div>
              )}
              {panel === 'find' && (
                <div className="panel-stack">
                  <input
                    autoFocus
                    aria-label={t('查找消息')}
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
                    placeholder={t('查找已加载的消息')}
                  />
                  <p className="muted">{t('search.matches', { count: matches.length })}</p>
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
                      {t('加载更早记录')}
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

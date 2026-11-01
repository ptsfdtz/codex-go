import { Select } from '../components/Select';
import { useRef, useState, type ReactNode, type MouseEvent } from 'react';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Computer,
  FolderClosed,
  FolderOpen,
  LoaderCircle,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  SquarePen,
} from 'lucide-react';
import { IconButton, Modal } from '../ui';
import { Collapse, MotionList } from '../motion';
import type { Host, Project, Session } from '../workspace';
import { canManage, isSessionWorking } from '../workspace';
import './Sidebar.css';

type SessionAction = 'pin' | 'archive' | 'restore';
export function Sidebar({
  brand,
  sessions,
  projects,
  host,
  connected,
  sessionId,
  projectId,
  open,
  onClose,
  onNew,
  chatAvailable,
  onChat,
  onSelect,
  onProject,
  onRefresh,
  onSettings,
  onComputers,
  onManage,
  onSearch,
  filter,
  setFilter,
  onSessionAction,
  actionsBlocked = false,
}: {
  brand?: ReactNode;
  sessions: Session[];
  projects: Project[];
  host?: Host;
  connected: boolean;
  sessionId?: string;
  projectId: string;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  chatAvailable: boolean;
  onChat: () => void;
  onSelect: (session: Session) => void;
  onProject: (id: string) => void;
  onRefresh: () => void;
  onSettings: () => void;
  onComputers: () => void;
  onManage: (session: Session) => void;
  onSearch: () => void;
  filter: string;
  setFilter: (s: string) => void;
  onSessionAction: (action: SessionAction, session: Session) => Promise<void>;
  actionsBlocked?: boolean;
}) {
  const [sort, setSort] = useState('recent');
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [closedProjects, setClosedProjects] = useState(new Set<string>());
  const [fullProjects, setFullProjects] = useState(new Set<string>());
  const [recentLimit, setRecentLimit] = useState(20);
  const [filters, setFilters] = useState(false);
  const [menuSession, setMenuSession] = useState<Session>();
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 8 });
  const menu = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const [confirmation, setConfirmation] = useState<Session>();
  const [pending, setPending] = useState('');
  const pendingRef = useRef(false);
  const [error, setError] = useState('');
  const toggle = (update: typeof setClosedProjects, id: string) =>
    update((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const byRecent = (a: Session, b: Session) =>
    sort === 'title'
      ? (a.title || '').localeCompare(b.title || '')
      : (b.updatedAt || '').localeCompare(a.updatedAt || '');
  // Recents spans all projects, including projectless chats. Projects retain native order.
  const visible = sessions
    .filter((s) =>
      filter === 'archived'
        ? s.archived === 1
        : s.archived !== 1 &&
          (filter === 'pinned'
            ? s.pinned === 1
            : filter === 'active'
              ? isSessionWorking(s) ||
                ['queued', 'waitingApproval', 'unknown'].includes(s.status || '')
              : true),
    )
    .sort(byRecent);
  const manageable = (s: Session) =>
    connected && !actionsBlocked && !pending && canManage(s) && !isSessionWorking(s);
  const act = async (action: SessionAction, s: Session) => {
    if (pendingRef.current || !manageable(s)) return;
    pendingRef.current = true;
    setPending(s.sessionId);
    setError('');
    try {
      await onSessionAction(action, s);
      setConfirmation(undefined);
    } catch (e) {
      setError(String(e));
    } finally {
      pendingRef.current = false;
      setPending('');
    }
  };
  const closeMenu = () => menu.current?.hidePopover();
  const showMenu = (s: Session, target: HTMLElement, x: number, y: number) => {
    setMenuSession(s);
    setMenuPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - 212)),
      top: Math.max(8, Math.min(y, window.innerHeight - 170)),
    });
    menuTrigger.current = target;
    menu.current?.showPopover();
    requestAnimationFrame(() =>
      menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(),
    );
  };
  const contextMenu = (event: MouseEvent<HTMLElement>, s: Session) => {
    event.preventDefault();
    showMenu(
      s,
      event.currentTarget.querySelector<HTMLElement>('.session') || event.currentTarget,
      event.clientX,
      event.clientY,
    );
  };
  const row = (s: Session) => (
    <div
      data-motion-item
      className={`session-row desktop-session-row ${s.sessionId === sessionId ? 'selected' : ''}`}
      key={s.sessionId}
      onContextMenu={(event) => contextMenu(event, s)}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          showMenu(s, event.target as HTMLElement, box.left + 20, box.bottom);
        }
      }}
    >
      <button
        className="session"
        onClick={() => onSelect(s)}
        title={s.title || '未命名会话'}
        aria-current={s.sessionId === sessionId ? 'page' : undefined}
      >
        <span className="session-title">{s.title || '未命名会话'}</span>
        {isSessionWorking(s) && (
          <span
            className={`session-working ${connected ? '' : 'is-stale'}`}
            role="img"
            aria-label={connected ? '正在工作' : '连接中断，上次状态为正在工作'}
          >
            <LoaderCircle size={14} strokeWidth={1.6} aria-hidden="true" />
          </span>
        )}
      </button>
      <div className="sidebar-session-actions">
        <IconButton
          icon={s.pinned === 1 ? PinOff : Pin}
          label={`${s.pinned === 1 ? '取消置顶' : '置顶'} ${s.title || '未命名会话'}`}
          className={s.pinned === 1 ? 'is-pinned' : ''}
          pressed={s.pinned === 1}
          disabled={!manageable(s)}
          onClick={() => void act('pin', s)}
        />
        <IconButton
          icon={s.archived === 1 ? ArchiveRestore : Archive}
          label={`${s.archived === 1 ? '恢复' : '归档'} ${s.title || '未命名会话'}`}
          disabled={!manageable(s)}
          onClick={() => {
            setError('');
            setConfirmation(s);
          }}
        />
        <IconButton
          icon={MoreHorizontal}
          label={`管理会话 ${s.title || '未命名会话'}`}
          className="sidebar-touch-menu"
          onClick={() => onManage(s)}
        />
      </div>
    </div>
  );
  return (
    <>
      <button
        className={`sidebar-scrim ${open ? 'visible' : ''}`}
        aria-label="关闭侧栏"
        onClick={onClose}
      />
      <aside
        className={`sidebar desktop-sidebar ${open ? 'open' : ''}`}
        inert={!open}
        aria-hidden={!open}
      >
        <div className="sidebar-brand">
          {brand || <strong>AgentDeck</strong>}
          <IconButton icon={Menu} label="收起会话列表" onClick={onClose} />
        </div>
        <div className="sidebar-primary">
          <button onClick={onNew}>
            <SquarePen size={16} />
            新对话
          </button>
          <IconButton
            icon={MessageCircle}
            label="普通聊天"
            className={`chat-entry ${projectId === 'agentdeck-chat' ? 'active' : ''}`}
            onClick={onChat}
            disabled={!chatAvailable}
          />
          <IconButton icon={Search} label="搜索会话" onClick={onSearch} />
        </div>
        <div className="sidebar-scroll">
          <section className="sidebar-projects" aria-label="项目">
            <button
              className="desktop-rail-heading"
              aria-expanded={projectsOpen}
              onClick={() => setProjectsOpen(!projectsOpen)}
            >
              项目
              <ChevronDown size={13} className={projectsOpen ? '' : 'is-collapsed'} />
            </button>
            <Collapse open={projectsOpen}>
              {projects.map((p) => {
                const projectSessions = visible.filter((s) => s.projectId === p.projectId);
                const expanded = !closedProjects.has(p.projectId);
                const selectedIndex = projectSessions.findIndex((s) => s.sessionId === sessionId);
                const count = fullProjects.has(p.projectId)
                  ? projectSessions.length
                  : Math.max(3, selectedIndex + 1);
                return (
                  <div className="sidebar-project" key={p.projectId}>
                    <div className="sidebar-project-heading">
                      <button
                        className="sidebar-project-toggle"
                        aria-expanded={expanded}
                        title={p.canonicalPath || p.name}
                        onClick={() => toggle(setClosedProjects, p.projectId)}
                      >
                        <span className="sidebar-folder-icon">
                          {expanded ? <FolderOpen size={15} /> : <FolderClosed size={15} />}
                          <ChevronRight size={14} className={expanded ? 'is-expanded' : ''} />
                        </span>
                        <span>{p.name}</span>
                      </button>
                      <IconButton
                        icon={Plus}
                        label={`在 ${p.name} 中新建对话`}
                        onClick={() => onProject(p.projectId)}
                      />
                    </div>
                    <Collapse open={expanded}>
                      <MotionList
                        as="nav"
                        label={`${p.name} 的对话`}
                        className="sidebar-project-sessions"
                      >
                        {projectSessions.slice(0, count).map(row)}
                        {!projectSessions.length && (
                          <button
                            className="sidebar-project-empty"
                            onClick={() => onProject(p.projectId)}
                          >
                            新建对话
                          </button>
                        )}
                        {projectSessions.length > 3 &&
                          (projectSessions.length > count || fullProjects.has(p.projectId)) && (
                            <button
                              className="sidebar-show-more"
                              onClick={() => toggle(setFullProjects, p.projectId)}
                            >
                              {fullProjects.has(p.projectId)
                                ? '收起'
                                : `显示更多（${Math.max(0, projectSessions.length - count)}）`}
                            </button>
                          )}
                      </MotionList>
                    </Collapse>
                  </div>
                );
              })}
              {!projects.length && <p className="rail-empty">暂无项目</p>}
            </Collapse>
          </section>
          <section className="sidebar-recents" aria-label="最近对话">
            <div className="sidebar-recents-heading">
              <button
                className="desktop-rail-heading"
                aria-expanded={recentsOpen}
                onClick={() => setRecentsOpen(!recentsOpen)}
              >
                {filter === 'archived'
                  ? '归档对话'
                  : filter === 'pinned'
                    ? '置顶对话'
                    : filter === 'active'
                      ? '活动任务'
                      : '最近对话'}
                <ChevronDown size={13} className={recentsOpen ? '' : 'is-collapsed'} />
              </button>
              <div className="sidebar-heading-actions">
                <IconButton icon={RefreshCw} label="同步电脑已有对话" onClick={onRefresh} />
                <IconButton
                  icon={SlidersHorizontal}
                  label="筛选和排序会话"
                  pressed={filters}
                  onClick={() => setFilters(!filters)}
                />
              </div>
            </div>
            <Collapse open={filters}>
              <div className="rail-filters">
                <Select
                  aria-label="会话筛选"
                  value={filter}
                  onValueChange={(value) => setFilter(value)}
                >
                  {[
                    ['all', '全部对话'],
                    ['active', '活动任务'],
                    ['pinned', '置顶'],
                    ['archived', '归档'],
                  ].map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="会话排序"
                  value={sort}
                  onValueChange={(value) => setSort(value)}
                >
                  <option value="recent">最近更新</option>
                  <option value="title">按名称</option>
                </Select>
              </div>
            </Collapse>
            <Collapse open={recentsOpen}>
              <MotionList as="nav" label="最近对话列表">
                {visible.slice(0, recentLimit).map(row)}
                {!visible.length && <p className="rail-empty">暂无会话</p>}
                {visible.length > recentLimit && (
                  <button
                    className="sidebar-show-more"
                    onClick={() => setRecentLimit((n) => n + 20)}
                  >
                    显示更多
                  </button>
                )}
              </MotionList>
            </Collapse>
          </section>
        </div>
        {error && !confirmation && (
          <p className="sidebar-action-error error" role="alert">
            {error}
          </p>
        )}
        <div className="sidebar-footer">
          <button onClick={onComputers}>
            <Computer size={17} />
            <span>{host?.displayName || '连接电脑'}</span>
          </button>
          <IconButton icon={Settings} label="设置" onClick={onSettings} />
        </div>
        <div
          ref={menu}
          popover="auto"
          className="sidebar-context-menu"
          role="menu"
          aria-label="会话操作"
          style={menuPosition}
          onToggle={(event) => {
            if (
              !event.currentTarget.matches(':popover-open') &&
              (event.currentTarget.contains(document.activeElement) ||
                document.activeElement === document.body)
            )
              menuTrigger.current?.focus();
          }}
          onKeyDown={(event) => {
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
            ];
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (i + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
              buttons[next]?.focus();
            }
          }}
        >
          <button
            role="menuitem"
            onClick={() => {
              closeMenu();
              if (menuSession) onManage(menuSession);
            }}
          >
            <SquarePen size={15} />
            重命名及更多操作
          </button>
          <button
            role="menuitem"
            disabled={!menuSession || !manageable(menuSession)}
            onClick={() => {
              closeMenu();
              if (menuSession) void act('pin', menuSession);
            }}
          >
            <Pin size={15} />
            {menuSession?.pinned === 1 ? '取消置顶' : '置顶'}
          </button>
          <button
            role="menuitem"
            disabled={!menuSession || !manageable(menuSession)}
            onClick={() => {
              closeMenu();
              setError('');
              setConfirmation(menuSession);
            }}
          >
            <Archive size={15} />
            {menuSession?.archived === 1 ? '恢复会话' : '归档会话'}
          </button>
        </div>
        {confirmation && (
          <Modal
            title={confirmation.archived === 1 ? '恢复会话' : '归档会话'}
            onClose={() => {
              if (!pending) setConfirmation(undefined);
            }}
            compact
          >
            <p>
              {confirmation.archived === 1 ? '恢复' : '归档'}“{confirmation.title || '未命名会话'}
              ”？
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="button-row">
              <button disabled={!!pending} onClick={() => setConfirmation(undefined)}>
                取消
              </button>
              <button
                disabled={!manageable(confirmation)}
                onClick={() =>
                  void act(confirmation.archived === 1 ? 'restore' : 'archive', confirmation)
                }
              >
                {pending ? '处理中…' : '确认'}
              </button>
            </div>
          </Modal>
        )}
      </aside>
    </>
  );
}

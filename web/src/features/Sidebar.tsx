import { errorText, t, useLocale } from '../i18n';
import { Select } from '../components/Select';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from 'react';
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
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  SquarePen,
  X,
} from 'lucide-react';
import { IconButton } from '../ui';
import { Collapse, MotionList } from '../motion';
import type { Host, Project, Session } from '../workspace';
import { canManage, isSessionWorking } from '../workspace';
import './Sidebar.css';
import { attentionLabels, type AttentionKind } from './notifications/task-attention';

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
  unread = {},
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
  unread?: Record<string, AttentionKind>;
}) {
  useLocale();
  const [sort, setSort] = useState('recent');
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [markedOpen, setMarkedOpen] = useState(true);
  const [closedProjects, setClosedProjects] = useState(new Set<string>());
  const [fullProjects, setFullProjects] = useState(new Set<string>());
  const [recentLimit, setRecentLimit] = useState(20);
  const [filters, setFilters] = useState(false);
  const [menuSession, setMenuSession] = useState<Session>();
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef({ left: 8, top: 8, bottom: 8, right: 8 });
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
  const marked = visible.filter((s) => s.pinned === 1 && s.archived !== 1);
  const unmarked = visible.filter((s) => s.pinned !== 1 || s.archived === 1);
  const latestMenuSession = sessions.find((s) => s.sessionId === menuSession?.sessionId);
  const manageable = (s: Session) =>
    connected && !actionsBlocked && !pending && canManage(s) && !isSessionWorking(s);
  const act = async (action: SessionAction, s: Session) => {
    if (pendingRef.current || !manageable(s)) return;
    pendingRef.current = true;
    setPending(s.sessionId);
    setError('');
    try {
      await onSessionAction(action, s);
      closeMenu();
    } catch (e) {
      setError(String(e));
    } finally {
      pendingRef.current = false;
      setPending('');
    }
  };
  const closeMenu = () => menu.current?.hidePopover();
  const positionMenu = () => {
    const node = menu.current;
    if (!node) return;
    const viewport = window.visualViewport;
    const left = (viewport?.offsetLeft || 0) + 12;
    const top = (viewport?.offsetTop || 0) + 12;
    const right = left + (viewport?.width || window.innerWidth) - 24;
    const bottom = top + (viewport?.height || window.innerHeight) - 24;
    const width = Math.min(confirmation ? 304 : 216, right - left);
    node.style.width = `${width}px`;
    node.style.maxHeight = `${bottom - top}px`;
    const anchor = menuAnchor.current;
    const height = node.offsetHeight;
    const up = bottom - anchor.bottom - 6 < height && anchor.top - top > bottom - anchor.bottom;
    node.style.left = `${Math.max(left, Math.min(anchor.right - width, right - width))}px`;
    node.style.top = `${Math.max(top, Math.min(up ? anchor.top - height - 6 : anchor.bottom + 6, bottom - height))}px`;
    node.style.transformOrigin = up ? 'bottom right' : 'top right';
  };
  useLayoutEffect(() => {
    if (menuOpen) positionMenu();
  });
  useLayoutEffect(() => {
    if (confirmation) menu.current?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
  }, [confirmation]);
  useEffect(() => {
    if (!menuOpen) return;
    const update = () => positionMenu();
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      closeMenu();
    };
    const focus = (event: FocusEvent) => {
      if (event.target !== menuTrigger.current) dismiss(event);
    };
    const observer = new ResizeObserver(update);
    if (menu.current) observer.observe(menu.current);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    document.addEventListener('scroll', dismiss, true);
    document.addEventListener('focusin', focus);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      document.removeEventListener('scroll', dismiss, true);
      document.removeEventListener('focusin', focus);
    };
  });
  useEffect(() => {
    if (!open) closeMenu();
  }, [open]);
  const showMenu = (s: Session, target: HTMLElement, point?: { x: number; y: number }) => {
    if (pendingRef.current) return;
    const box = target.getBoundingClientRect();
    menuAnchor.current = point
      ? { left: point.x, right: point.x + 216, top: point.y, bottom: point.y }
      : box;
    setConfirmation(undefined);
    setError('');
    setMenuSession(s);
    menuTrigger.current = target;
    menu.current?.showPopover();
    setMenuOpen(true);
    requestAnimationFrame(() =>
      menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(),
    );
  };
  const contextMenu = (event: MouseEvent<HTMLElement>, s: Session) => {
    event.preventDefault();
    showMenu(s, event.currentTarget.querySelector<HTMLElement>('.session') || event.currentTarget, {
      x: event.clientX,
      y: event.clientY,
    });
  };
  const row = (s: Session, area: string) => (
    <div
      data-motion-item
      className={`session-row desktop-session-row ${s.sessionId === sessionId ? 'selected' : ''} ${menuOpen && menuTrigger.current?.id === `${menuId}-${area}-${s.sessionId}` ? 'has-open-menu' : ''}`}
      data-session-id={s.sessionId}
      key={s.sessionId}
      onContextMenu={(event) => contextMenu(event, s)}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          showMenu(s, event.target as HTMLElement);
        }
      }}
    >
      <button
        className="session"
        onClick={() => onSelect(s)}
        title={s.title || t('未命名会话')}
        aria-current={s.sessionId === sessionId ? 'page' : undefined}
        aria-description={
          unread[s.sessionId]
            ? t('{{p0}}，有未读提醒', { p0: attentionLabels[unread[s.sessionId]!] })
            : undefined
        }
      >
        <span className="session-title">{s.title || t('未命名会话')}</span>
        {unread[s.sessionId] && (
          <span className="notification-dot session-unread-dot" aria-hidden="true" />
        )}
        {isSessionWorking(s) && (
          <span
            className={`session-working ${connected ? '' : 'is-stale'}`}
            role="img"
            aria-label={connected ? t('正在工作') : t('连接中断，上次状态为正在工作')}
          >
            <LoaderCircle size={14} strokeWidth={1.6} aria-hidden="true" />
          </span>
        )}
      </button>
      <div className="sidebar-session-actions">
        <button
          type="button"
          className="icon-button sidebar-more"
          id={`${menuId}-${area}-${s.sessionId}`}
          aria-label={t('更多操作 {{p0}}', { p0: s.title || t('未命名会话') })}
          title={t('更多操作')}
          disabled={!!pending}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-expanded={menuOpen && menuTrigger.current?.id === `${menuId}-${area}-${s.sessionId}`}
          onClick={(event) => {
            if (menuOpen && menuTrigger.current === event.currentTarget) closeMenu();
            else showMenu(s, event.currentTarget);
          }}
        >
          <MoreHorizontal size={15} aria-hidden="true" />
        </button>
        <IconButton
          icon={SquarePen}
          label={t('编辑会话 {{p0}}', { p0: s.title || t('未命名会话') })}
          onClick={() => onManage(s)}
        />
      </div>
    </div>
  );
  return (
    <>
      <button
        className={`sidebar-scrim ${open ? 'visible' : ''}`}
        aria-label={t('关闭侧栏')}
        onClick={onClose}
      />
      <aside
        className={`sidebar desktop-sidebar ${open ? 'open' : ''}`}
        inert={!open}
        aria-hidden={!open}
      >
        <div className="sidebar-brand">
          {brand || <strong>AgentDeck</strong>}
          <IconButton
            icon={Menu}
            label={t('收起会话列表')}
            onClick={onClose}
            badge={Object.keys(unread).length ? t('有未读任务提醒') : undefined}
          />
        </div>
        <div className="sidebar-primary">
          <button onClick={onNew}>
            <SquarePen size={16} />
            {t('新对话')}
          </button>
          <IconButton
            icon={MessageCircle}
            label={t('普通聊天')}
            className={`chat-entry ${projectId === 'agentdeck-chat' ? 'active' : ''}`}
            onClick={onChat}
            disabled={!chatAvailable}
          />
          <IconButton icon={Search} label={t('搜索会话')} onClick={onSearch} />
        </div>
        <div className="sidebar-scroll">
          {marked.length > 0 && (
            <section className="sidebar-marked" aria-label={t('已标记')}>
              <button
                className="desktop-rail-heading"
                aria-expanded={markedOpen}
                onClick={() => setMarkedOpen(!markedOpen)}
              >
                <Pin size={13} />
                {t('已标记')}
                <ChevronDown size={13} className={markedOpen ? '' : 'is-collapsed'} />
              </button>
              <Collapse open={markedOpen}>
                <MotionList as="nav" label={t('已标记对话列表')}>
                  {marked.map((s) => row(s, 'marked'))}
                </MotionList>
              </Collapse>
            </section>
          )}
          <section className="sidebar-projects" aria-label={t('项目')}>
            <button
              className="desktop-rail-heading"
              aria-expanded={projectsOpen}
              onClick={() => setProjectsOpen(!projectsOpen)}
            >
              {t('项目')}
              <ChevronDown size={13} className={projectsOpen ? '' : 'is-collapsed'} />
            </button>
            <Collapse open={projectsOpen}>
              {projects.map((p) => {
                const projectSessions = unmarked.filter((s) => s.projectId === p.projectId);
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
                        icon={SquarePen}
                        label={t('在 {{p0}} 中新建对话', { p0: p.name })}
                        onClick={() => onProject(p.projectId)}
                      />
                    </div>
                    <Collapse open={expanded}>
                      <MotionList
                        as="nav"
                        label={t('{{p0}} 的对话', { p0: p.name })}
                        className="sidebar-project-sessions"
                      >
                        {projectSessions
                          .slice(0, count)
                          .map((s) => row(s, `project-${p.projectId}`))}
                        {!projectSessions.length && (
                          <button
                            className="sidebar-project-empty"
                            onClick={() => onProject(p.projectId)}
                          >
                            {t('新建对话')}
                          </button>
                        )}
                        {projectSessions.length > 3 &&
                          (projectSessions.length > count || fullProjects.has(p.projectId)) && (
                            <button
                              className="sidebar-show-more"
                              onClick={() => toggle(setFullProjects, p.projectId)}
                            >
                              {fullProjects.has(p.projectId)
                                ? t('收起')
                                : t('显示更多（{{p0}}）', {
                                    p0: Math.max(0, projectSessions.length - count),
                                  })}
                            </button>
                          )}
                      </MotionList>
                    </Collapse>
                  </div>
                );
              })}
              {!projects.length && <p className="rail-empty">{t('暂无项目')}</p>}
            </Collapse>
          </section>
          <section className="sidebar-recents" aria-label={t('最近对话')}>
            <div className="sidebar-recents-heading">
              <button
                className="desktop-rail-heading"
                aria-expanded={recentsOpen}
                onClick={() => setRecentsOpen(!recentsOpen)}
              >
                {filter === 'archived'
                  ? t('归档对话')
                  : filter === 'pinned'
                    ? t('最近对话')
                    : filter === 'active'
                      ? t('活动任务')
                      : t('最近对话')}
                <ChevronDown size={13} className={recentsOpen ? '' : 'is-collapsed'} />
              </button>
              <div className="sidebar-heading-actions">
                <IconButton icon={RefreshCw} label={t('同步电脑已有对话')} onClick={onRefresh} />
                <IconButton
                  icon={SlidersHorizontal}
                  label={t('筛选和排序会话')}
                  pressed={filters}
                  onClick={() => setFilters(!filters)}
                />
              </div>
            </div>
            <Collapse open={filters}>
              <div className="rail-filters">
                <Select
                  aria-label={t('会话筛选')}
                  value={filter}
                  onValueChange={(value) => setFilter(value)}
                >
                  {[
                    ['all', t('全部对话')],
                    ['active', t('活动任务')],
                    ['archived', t('归档')],
                  ].map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label={t('会话排序')}
                  value={sort}
                  onValueChange={(value) => setSort(value)}
                >
                  <option value="recent">{t('最近更新')}</option>
                  <option value="title">{t('按名称')}</option>
                </Select>
              </div>
            </Collapse>
            <Collapse open={recentsOpen}>
              <MotionList as="nav" label={t('最近对话列表')}>
                {unmarked.slice(0, recentLimit).map((s) => row(s, 'recent'))}
                {!unmarked.length && <p className="rail-empty">{t('暂无会话')}</p>}
                {unmarked.length > recentLimit && (
                  <button
                    className="sidebar-show-more"
                    onClick={() => setRecentLimit((n) => n + 20)}
                  >
                    {t('显示更多')}
                  </button>
                )}
              </MotionList>
            </Collapse>
          </section>
        </div>
        {error && !confirmation && (
          <p className="sidebar-action-error error" role="alert">
            {errorText(error)}
          </p>
        )}
        <div className="sidebar-footer">
          <button onClick={onComputers}>
            <Computer size={17} />
            <span>{host?.displayName || t('连接电脑')}</span>
          </button>
          <IconButton icon={Settings} label={t('设置')} onClick={onSettings} />
        </div>
        <div
          id={menuId}
          ref={menu}
          popover="auto"
          className={`sidebar-context-menu ${confirmation ? 'is-confirming' : ''}`}
          role={confirmation ? 'dialog' : 'menu'}
          aria-label={
            confirmation
              ? confirmation.archived === 1
                ? t('恢复会话')
                : t('归档会话')
              : t('会话操作')
          }
          aria-describedby={confirmation ? `${menuId}-description` : undefined}
          aria-busy={!!pending}
          onToggle={(event) => {
            const isOpen = event.newState === 'open';
            setMenuOpen(isOpen);
            if (isOpen) return;
            setConfirmation(undefined);
            if (
              event.currentTarget.contains(document.activeElement) ||
              document.activeElement === document.body
            ) {
              const sidebar = event.currentTarget.closest('aside');
              requestAnimationFrame(() => {
                const replacement = [
                  ...(sidebar?.querySelectorAll<HTMLElement>('.session-row') || []),
                ]
                  .find((el) => el.dataset.sessionId === menuSession?.sessionId)
                  ?.querySelector<HTMLButtonElement>('.sidebar-more');
                const target = menuTrigger.current?.isConnected ? menuTrigger.current : replacement;
                (
                  target || sidebar?.querySelector<HTMLButtonElement>('.desktop-rail-heading')
                )?.focus({ preventScroll: true });
              });
            }
          }}
          onKeyDown={(event) => {
            if (confirmation) return;
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
          {confirmation ? (
            <div className="sidebar-archive-confirmation">
              <div className="sidebar-confirmation-heading">
                {confirmation.archived === 1 ? <ArchiveRestore size={17} /> : <Archive size={17} />}
                <h3>{confirmation.archived === 1 ? t('恢复会话') : t('归档会话')}</h3>
                <IconButton
                  icon={X}
                  label={t('关闭确认')}
                  onClick={closeMenu}
                  disabled={!!pending}
                />
              </div>
              <p className="sidebar-confirmation-name">{confirmation.title || t('未命名会话')}</p>
              <p id={`${menuId}-description`} className="sidebar-confirmation-description">
                {confirmation.archived === 1
                  ? t('恢复后会重新显示在对话列表中。')
                  : t('归档后将从列表收起，可在归档对话中恢复。')}
              </p>
              {error && (
                <p className="error" role="alert">
                  {errorText(error)}
                </p>
              )}
              <div className="button-row">
                <button data-cancel disabled={!!pending} onClick={closeMenu}>
                  {t('取消')}
                </button>
                <button
                  disabled={!latestMenuSession || !manageable(latestMenuSession)}
                  onClick={() => {
                    if (latestMenuSession)
                      void act(
                        confirmation.archived === 1 ? 'restore' : 'archive',
                        latestMenuSession,
                      );
                  }}
                >
                  {pending ? t('处理中…') : confirmation.archived === 1 ? t('恢复') : t('归档')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  if (menuSession) onManage(menuSession);
                }}
              >
                <SquarePen size={15} />
                {t('编辑会话')}
              </button>
              <button
                role="menuitem"
                disabled={!latestMenuSession || !manageable(latestMenuSession)}
                onClick={() => {
                  if (latestMenuSession) void act('pin', latestMenuSession);
                }}
              >
                {latestMenuSession?.pinned === 1 ? <PinOff size={15} /> : <Pin size={15} />}
                {latestMenuSession?.pinned === 1 ? t('取消标记') : t('标记会话')}
              </button>
              <button
                role="menuitem"
                disabled={!latestMenuSession || !manageable(latestMenuSession)}
                onClick={() => {
                  setError('');
                  setConfirmation(latestMenuSession);
                }}
              >
                {latestMenuSession?.archived === 1 ? (
                  <ArchiveRestore size={15} />
                ) : (
                  <Archive size={15} />
                )}
                {latestMenuSession?.archived === 1 ? t('恢复会话') : t('归档会话')}
              </button>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

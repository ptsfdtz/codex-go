import { useState } from 'react';
import {
  Archive,
  ChevronDown,
  Computer,
  Folder,
  Menu,
  MessageSquarePlus,
  MessageCircle,
  MoreHorizontal,
  Pin,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import { IconButton } from '../ui';
import { Collapse } from '../motion';
import type { Host, Project, Session } from '../workspace';
export function Sidebar({
  sessions,
  projects,
  host,
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
}: {
  sessions: Session[];
  projects: Project[];
  host?: Host;
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
}) {
  const [sort, setSort] = useState('recent');
  const [expanded, setExpanded] = useState(true);
  const [filters, setFilters] = useState(false);
  const visible = sessions
    .filter(
      (s) =>
        (!projectId || s.projectId === projectId) &&
        (filter === 'archived'
          ? s.archived === 1
          : s.archived !== 1 &&
            (filter === 'pinned'
              ? s.pinned === 1
              : filter === 'active'
                ? ['running', 'queued', 'waitingApproval', 'unknown'].includes(s.status || '')
                : true)),
    )
    .sort(
      (a, b) =>
        (b.pinned || 0) - (a.pinned || 0) ||
        (sort === 'title'
          ? (a.title || '').localeCompare(b.title || '')
          : (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    );
  return (
    <>
      <button
        className={`sidebar-scrim ${open ? 'visible' : ''}`}
        aria-label="关闭侧栏"
        onClick={onClose}
      />
      <aside className={`sidebar ${open ? 'open' : ''}`} inert={!open} aria-hidden={!open}>
        <div className="sidebar-brand">
          <strong>AgentDeck</strong>
          <IconButton icon={Menu} label="收起会话列表" onClick={onClose} />
        </div>
        <div className="sidebar-primary">
          <button onClick={onNew}>
            <MessageSquarePlus size={19} />
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
          <button
            className="rail-heading"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <Folder size={18} />
            <span>项目</span>
            <ChevronDown size={15} className={expanded ? 'rotate' : ''} />
          </button>
          <Collapse open={expanded}>
            <div className="project-list">
              {projects.map((p) => (
                <button
                  className={p.projectId === projectId ? 'active' : ''}
                  key={p.projectId}
                  onClick={() => onProject(p.projectId)}
                >
                  <Folder size={15} />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </Collapse>
          <div className="rail-heading">
            <span>
              {filter === 'archived'
                ? '归档对话'
                : filter === 'pinned'
                  ? '置顶对话'
                  : filter === 'active'
                    ? '活动任务'
                    : '对话'}
            </span>
            <IconButton icon={RefreshCw} label="同步电脑已有对话" onClick={onRefresh} />
            <IconButton
              icon={SlidersHorizontal}
              label="筛选和排序会话"
              onClick={() => setFilters(!filters)}
            />
          </div>
          <Collapse open={filters}>
            <div className="rail-filters">
              <select
                aria-label="会话筛选"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
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
              </select>
              <select aria-label="会话排序" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="recent">最近更新</option>
                <option value="title">按名称</option>
              </select>
            </div>
          </Collapse>
          <nav aria-label="会话">
            {visible.map((s) => (
              <div
                className={`session-row ${s.sessionId === sessionId ? 'selected' : ''}`}
                key={s.sessionId}
              >
                <button className="session" onClick={() => onSelect(s)} title={s.title}>
                  {s.title || '未命名会话'}
                  {s.pinned === 1 && <Pin size={12} />}
                  {s.archived === 1 && <Archive size={12} />}
                </button>
                <IconButton
                  icon={MoreHorizontal}
                  label={`管理会话 ${s.title}`}
                  onClick={() => onManage(s)}
                />
              </div>
            ))}
            {!visible.length && <p className="rail-empty">暂无会话</p>}
          </nav>
        </div>
        <div className="sidebar-footer">
          <button onClick={onComputers}>
            <Computer size={19} />
            <span>{host?.displayName || '连接电脑'}</span>
          </button>
          <IconButton icon={Settings} label="设置" onClick={onSettings} />
        </div>
      </aside>
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Copy,
  FileDiff,
  FolderOpen,
  GitFork,
  MessageSquarePlus,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  Search,
  Settings,
  PanelsTopLeft,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { errorText, t, useLocale } from '../i18n';
import { Modal } from '../ui';
import {
  canManage,
  isSessionWorking,
  type Capabilities,
  type Request,
  type Session,
} from '../workspace';

export function ConversationMenu({
  open,
  onClose,
  session,
  connected,
  blocked,
  capabilities,
  request,
  directory,
  onPanel,
  onTools,
  onSideChat,
  onChanged,
  onSelect,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  session?: Session;
  connected: boolean;
  blocked: boolean;
  capabilities: Capabilities;
  request: Request;
  directory?: string;
  onPanel: (name: string) => void;
  onTools?: () => void;
  onSideChat: (sessionId?: string) => void;
  onChanged: () => Promise<unknown>;
  onSelect: (session: Session) => void;
  onError: (error: string) => void;
}) {
  useLocale();
  const [dialog, setDialog] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [extended, setExtended] = useState(false);
  const pending = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const [error, setError] = useState('');
  const menu = useRef<HTMLDivElement>(null);
  const supports = (key: string) => capabilities.features?.[key] === true;
  const safe =
    !!session && connected && !blocked && !busy && canManage(session) && !isSessionWorking(session);
  function availableButtons() {
    return Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [],
    )
      .filter((button) => button.getClientRects().length > 0)
      .sort((a, b) => Number(getComputedStyle(a).order) - Number(getComputedStyle(b).order));
  }
  useEffect(() => {
    if (!open) setExtended(false);
    if (open) availableButtons()[0]?.focus();
  }, [open, extended]);
  function confirm(kind: string) {
    setTitle(session?.title || '');
    setError('');
    setDialog(kind);
    onClose();
  }
  async function mutate(kind: string) {
    if (!safe || !session || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await request<{ session?: Session }>(`sessions.${kind}`, {
        sessionId: session.sessionId,
        ...(kind === 'rename' ? { title: title.trim() } : {}),
        ...(kind === 'pin' ? { pinned: session.pinned !== 1 } : {}),
      });
      if (!live.current) return;
      await onChanged();
      if (!live.current) return;
      if (kind === 'fork' && result.session) onSelect(result.session);
      setDialog('');
      onClose();
    } catch (e) {
      if (!live.current) return;
      if (dialog) setError(String(e));
      else {
        onClose();
        onError(String(e));
      }
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function copy(value: string) {
    onClose();
    try {
      await navigator.clipboard.writeText(value);
    } catch (e) {
      onError(String(e));
    }
  }
  return (
    <>
      {open && (
        <>
          <button className="menu-scrim" aria-label={t('关闭更多菜单')} onClick={onClose} />
          <div
            className={`popover top-menu${extended ? ' is-extended' : ''}`}
            role="menu"
            aria-label={t('更多操作')}
            ref={menu}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const buttons = availableButtons();
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }}
          >
            {session && (
              <div className="conversation-menu-caption">{session.title || t('未命名会话')}</div>
            )}
            {session && supports('sessionManagement') && (
              <>
                <button
                  className="menu-primary menu-rename"
                  role="menuitem"
                  disabled={!safe}
                  onClick={() => confirm('rename')}
                >
                  <Pencil size={18} />
                  {t('重命名会话')}
                </button>
                <button
                  className="menu-primary menu-pin"
                  role="menuitem"
                  disabled={!safe}
                  onClick={() => void mutate('pin')}
                >
                  {session.pinned === 1 ? <PinOff size={18} /> : <Pin size={18} />}
                  {session.pinned === 1 ? t('取消置顶') : t('置顶会话')}
                </button>
              </>
            )}
            {connected && (
              <button
                className="menu-secondary"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onSideChat();
                }}
              >
                <MessageSquarePlus size={18} />
                {t('新建侧边对话')}
              </button>
            )}
            {session && (
              <>
                {supports('sessionFork') && (
                  <button
                    className="menu-secondary"
                    role="menuitem"
                    disabled={!safe}
                    onClick={() => confirm('fork')}
                  >
                    <GitFork size={18} />
                    {t('分叉会话')}
                  </button>
                )}
                <button
                  className="menu-secondary"
                  role="menuitem"
                  disabled={!connected}
                  onClick={() => {
                    onClose();
                    onSideChat(session.sessionId);
                  }}
                >
                  <PanelRight size={18} />
                  {t('在右侧打开当前会话')}
                </button>
                <hr />
                <button
                  className="menu-secondary"
                  role="menuitem"
                  onClick={() => void copy(session.title || t('未命名会话'))}
                >
                  <Copy size={18} />
                  {t('复制会话标题')}
                </button>
                <button
                  className="menu-primary menu-copy-id"
                  role="menuitem"
                  onClick={() => void copy(session.upstreamThreadId || session.sessionId)}
                >
                  <Copy size={18} />
                  {t('复制会话 ID')}
                </button>
                <button className="menu-secondary" role="menuitem" onClick={() => onPanel('find')}>
                  <Search size={18} />
                  {t('在会话中查找')}
                </button>
              </>
            )}
            {connected && directory && (
              <>
                <hr />
                <button
                  className="menu-secondary"
                  role="menuitem"
                  onClick={() => void copy(directory)}
                >
                  <Copy size={18} />
                  {t('复制工作目录')}
                </button>
                {supports('gitRead') && (
                  <button
                    className="menu-primary menu-changes"
                    role="menuitem"
                    onClick={() => onPanel('git')}
                  >
                    <FileDiff size={18} />
                    {t('审查工作区改动')}
                  </button>
                )}
                {supports('projectFileBrowser') && (
                  <button
                    className="menu-primary menu-files"
                    role="menuitem"
                    onClick={() => onPanel('files')}
                  >
                    <FolderOpen size={18} />
                    {t('浏览项目文件')}
                  </button>
                )}
              </>
            )}
            {session && supports('sessionManagement') && (
              <>
                <hr />
                <button
                  className="menu-primary menu-archive danger"
                  role="menuitem"
                  disabled={!safe}
                  onClick={() => confirm(session.archived === 1 ? 'restore' : 'archive')}
                >
                  {session.archived === 1 ? <ArchiveRestore size={18} /> : <Archive size={18} />}
                  {session.archived === 1 ? t('恢复会话') : t('归档会话')}
                </button>
              </>
            )}
            <hr />
            {onTools && (
              <button className="menu-secondary" role="menuitem" onClick={onTools}>
                <PanelsTopLeft size={18} />
                {t('工具')}
              </button>
            )}
            <button className="menu-secondary" role="menuitem" onClick={() => onPanel('settings')}>
              <Settings size={18} />
              {t('设置')}
            </button>
            <button
              className="menu-extended-toggle"
              role="menuitem"
              onClick={() => setExtended(!extended)}
            >
              {extended ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
              {extended ? t('返回') : t('更多操作')}
            </button>
          </div>
        </>
      )}
      {dialog && (
        <Modal
          compact
          title={
            dialog === 'rename'
              ? t('重命名会话')
              : dialog === 'fork'
                ? t('分叉会话')
                : dialog === 'archive'
                  ? t('归档会话')
                  : t('恢复会话')
          }
          onClose={() => {
            if (!busy) setDialog('');
          }}
        >
          <form
            className="panel-stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (dialog !== 'rename' || title.trim()) void mutate(dialog);
            }}
          >
            {dialog === 'rename' ? (
              <input
                autoFocus
                aria-label={t('对话名称')}
                value={title}
                maxLength={200}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
              />
            ) : (
              <p>
                {dialog === 'fork'
                  ? t('基于当前会话创建分叉，原会话保留。')
                  : dialog === 'archive'
                    ? t('归档此会话？稍后可从归档列表恢复。')
                    : t('恢复此归档会话？')}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {errorText(error)}
              </p>
            )}
            <div className="button-row">
              <button type="button" disabled={busy} onClick={() => setDialog('')}>
                {t('取消')}
              </button>
              <button
                type="submit"
                disabled={
                  !safe ||
                  (dialog === 'rename' && (!title.trim() || title.trim() === session?.title))
                }
              >
                {busy
                  ? t('处理中…')
                  : dialog === 'rename'
                    ? t('保存名称')
                    : dialog === 'fork'
                      ? t('创建分叉')
                      : dialog === 'archive'
                        ? t('归档')
                        : t('恢复')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

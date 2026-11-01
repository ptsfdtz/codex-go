import { t, useLocale } from '../../i18n';
import { useEffect, useRef, useState } from 'react';
import {
  FileDiff,
  FolderOpen,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  PanelRight,
  TerminalSquare,
  X,
} from 'lucide-react';
import { IconButton } from '../../ui';
import './tools.css';

export type Tool = 'files' | 'changes' | 'terminal' | 'chat';
const tools = [
  {
    id: 'changes',
    get name() {
      return t('改动');
    },
    icon: FileDiff,
    shortcut: 'Ctrl+Shift+G',
  },
  {
    id: 'terminal',
    get name() {
      return t('SSH 终端');
    },
    icon: TerminalSquare,
    shortcut: 'Ctrl+`',
  },
  {
    id: 'chat',
    get name() {
      return t('侧边对话');
    },
    icon: MessageSquarePlus,
    shortcut: 'Ctrl+Alt+S',
  },
  {
    id: 'files',
    get name() {
      return t('文件');
    },
    icon: FolderOpen,
    shortcut: 'Ctrl+P',
  },
] as const;
export function ToolsButton({
  onOpen,
  fileAvailable,
}: {
  onOpen: (tool: Tool) => void;
  fileAvailable: boolean;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        anchor.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className="menu-anchor tools-anchor" ref={anchor}>
      <button
        className="icon-button"
        aria-label={t('打开工具')}
        title={t('工具')}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <PanelRight size={19} aria-hidden="true" />
      </button>
      {open && (
        <section className="popover tools-menu" aria-label={t('工具')}>
          <h3>{t('工具')}</h3>
          <div className="tools-grid">
            {tools.map(({ id, name, icon: Icon, shortcut }) => (
              <button
                key={id}
                disabled={(id === 'files' || id === 'changes') && !fileAvailable}
                onClick={() => {
                  setOpen(false);
                  onOpen(id);
                }}
              >
                <Icon size={18} />
                <span>{name}</span>
                <kbd>{shortcut}</kbd>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
export function ToolHeader({
  active,
  onChange,
  fileAvailable,
  expanded,
  onExpand,
  onClose,
}: {
  active: Tool;
  onChange: (tool: Tool) => void;
  fileAvailable: boolean;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
}) {
  useLocale();
  return (
    <header className="tools-header">
      <nav aria-label={t('工作区工具')}>
        {tools.map(({ id, name, icon: Icon }) => (
          <button
            key={id}
            aria-pressed={active === id}
            disabled={(id === 'files' || id === 'changes') && !fileAvailable}
            title={name}
            onClick={() => onChange(id)}
          >
            <Icon size={16} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      <IconButton
        icon={expanded ? Minimize2 : Maximize2}
        label={expanded ? t('恢复并排工具') : t('扩大工具栏')}
        onClick={onExpand}
      />
      <IconButton icon={X} label={t('关闭工具栏')} onClick={onClose} />
    </header>
  );
}

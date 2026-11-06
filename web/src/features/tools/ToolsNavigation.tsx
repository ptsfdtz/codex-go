import { t, useLocale } from '../../i18n';
import { useLayoutEffect, useRef } from 'react';
import type { ToolTab } from './tool-tabs';
import {
  FileDiff,
  FolderOpen,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  PanelRight,
  Plus,
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
      return t('终端');
    },
    icon: TerminalSquare,
    shortcut: 'Ctrl+`',
  },
  {
    id: 'files',
    get name() {
      return t('文件');
    },
    icon: FolderOpen,
    shortcut: 'Ctrl+P',
  },
  {
    id: 'chat',
    get name() {
      return t('侧边对话');
    },
    icon: MessageSquarePlus,
    shortcut: 'Ctrl+Alt+S',
  },
] as const;
export function ToolsButton({ onOpen, open = false }: { onOpen: () => void; open?: boolean }) {
  useLocale();
  return (
    <IconButton
      className="header-tools"
      icon={PanelRight}
      label={t('打开工具')}
      onClick={onOpen}
      pressed={open}
    />
  );
}

export function ToolLauncher({
  onOpen,
  fileAvailable,
}: {
  onOpen: (tool: Tool) => void;
  fileAvailable: boolean;
}) {
  useLocale();
  return (
    <section className="tool-launcher" aria-label={t('工具')}>
      <h3>{t('工具')}</h3>
      <div className="tools-grid">
        {tools.map(({ id, name, icon: Icon, shortcut }) => (
          <button
            type="button"
            key={id}
            disabled={(id === 'files' || id === 'changes') && !fileAvailable}
            onClick={() => onOpen(id)}
          >
            <Icon size={17} />
            <span>{name}</span>
            <kbd>{shortcut}</kbd>
          </button>
        ))}
      </div>
    </section>
  );
}

export function ToolHeader({
  tabs,
  active,
  onSelect,
  onNew,
  onCloseTab,
  expanded,
  onExpand,
  onClose,
}: {
  tabs: ToolTab[];
  active: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onCloseTab: (id: string) => void;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
}) {
  useLocale();
  const tabList = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    tabList.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  return (
    <header className="tools-header">
      <nav
        ref={tabList}
        role="tablist"
        aria-label={t('工作区工具')}
        onKeyDown={(event) => {
          if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab')
            return;
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = tabs.findIndex((tab) => tab.id === active);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          const tab = tabs[next];
          if (tab) {
            onSelect(tab.id);
            document.getElementById(`tool-tab-${tab.id}`)?.focus();
          }
        }}
      >
        {tabs.map((tab) => {
          const tool = tools.find((tool) => tool.id === tab.tool);
          const Icon = tool?.icon || PanelRight;
          const label = tool?.name || t('新标签页');
          return (
            <div key={tab.id} className="tool-tab" data-selected={active === tab.id}>
              <button
                type="button"
                role="tab"
                id={`tool-tab-${tab.id}`}
                aria-controls={`tool-panel-${tab.id}`}
                aria-selected={active === tab.id}
                tabIndex={active === tab.id ? 0 : -1}
                onClick={() => onSelect(tab.id)}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
              <button
                type="button"
                className="tool-tab-close"
                aria-label={t('关闭标签页：{{name}}', { name: label })}
                onClick={() => {
                  onCloseTab(tab.id);
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLElement>(
                        '.tools-header [role="tab"][aria-selected="true"]',
                      )
                      ?.focus(),
                  );
                }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </nav>
      <IconButton icon={Plus} label={t('新建工具标签页')} onClick={onNew} />
      <IconButton
        icon={expanded ? Minimize2 : Maximize2}
        label={expanded ? t('恢复并排工具') : t('扩大工具栏')}
        onClick={onExpand}
      />
      <IconButton icon={X} label={t('关闭工具栏')} onClick={onClose} />
    </header>
  );
}

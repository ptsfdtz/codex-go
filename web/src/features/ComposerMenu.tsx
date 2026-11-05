import { useState, type RefObject } from 'react';
import {
  Camera,
  Image,
  Paperclip,
  Sparkles,
  ListChecks,
  Target,
  MoreHorizontal,
  ChevronLeft,
  FolderOpen,
  Expand,
  Minimize2,
  CornerDownLeft,
} from 'lucide-react';
import { t, useLocale } from '../i18n';
import type { Draft } from '../workspace';

export function ComposerMenu({
  id,
  menu,
  disabled,
  addingAttachments,
  supports,
  mode,
  execution,
  expanded,
  steering,
  onCamera,
  onPhotos,
  onFiles,
  onPanel,
  onMode,
  onExpand,
  onSteer,
  onClose,
  onToggle,
}: {
  id: string;
  menu: RefObject<HTMLDivElement | null>;
  disabled: boolean;
  addingAttachments: boolean;
  supports: (capability: string) => boolean;
  mode: Draft['mode'];
  execution: boolean;
  expanded: boolean;
  steering: 'hidden' | 'disabled' | 'ready';
  onCamera: () => void;
  onPhotos: () => void;
  onFiles: () => void;
  onPanel: (panel: string) => void;
  onMode: (mode: Draft['mode']) => void;
  onExpand: () => void;
  onSteer: () => void;
  onClose: (focus?: boolean) => void;
  onToggle: (open: boolean) => void;
}) {
  useLocale();
  const [more, setMore] = useState(false);
  const action = (run: () => void) => {
    onClose(false);
    run();
  };
  return (
    <div
      id={id}
      ref={menu}
      className="popover composer-menu"
      popover="auto"
      role="menu"
      aria-label={t('添加附件和操作')}
      onBeforeToggle={(event) => {
        if (event.newState === 'open') setMore(false);
      }}
      onToggle={(event) => onToggle(event.newState === 'open')}
      onKeyDown={(event) => {
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        );
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus({ preventScroll: true });
          items[next]?.scrollIntoView({ block: 'nearest' });
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {!more ? (
        <>
          {supports('attachments') && (
            <>
              <button
                role="menuitem"
                disabled={disabled || addingAttachments}
                onClick={() => action(onCamera)}
              >
                <Camera size={21} />
                {t('相机')}
              </button>
              <button
                role="menuitem"
                disabled={disabled || addingAttachments}
                onClick={() => action(onPhotos)}
              >
                <Image size={21} />
                {t('照片')}
              </button>
              <button
                role="menuitem"
                disabled={disabled || addingAttachments}
                onClick={() => action(onFiles)}
              >
                <Paperclip size={21} />
                {t('文件')}
              </button>
            </>
          )}
          {supports('composerSkills') && (
            <button
              role="menuitem"
              disabled={disabled}
              onClick={() => action(() => onPanel('skills'))}
            >
              <Sparkles size={21} />
              {t('技能')}
            </button>
          )}
          {execution && supports('plan') && (
            <button
              role="menuitemcheckbox"
              aria-checked={mode === 'plan'}
              disabled={disabled}
              onClick={() => {
                onMode(mode === 'plan' ? 'default' : 'plan');
                onClose();
              }}
            >
              <ListChecks size={21} />
              {t('方案模式')}
              {mode === 'plan' && <span className="composer-menu-check">✓</span>}
            </button>
          )}
          {execution && supports('goal') && (
            <button
              role="menuitemcheckbox"
              aria-checked={mode === 'goal'}
              disabled={disabled}
              onClick={() => {
                onMode(mode === 'goal' ? 'default' : 'goal');
                onClose();
              }}
            >
              <Target size={21} />
              {t('追求目标')}
              {mode === 'goal' && <span className="composer-menu-check">✓</span>}
            </button>
          )}
          <button
            role="menuitem"
            className="composer-menu-secondary"
            aria-label={t('更多操作')}
            onClick={() => {
              setMore(true);
              requestAnimationFrame(() =>
                menu.current
                  ?.querySelector<HTMLButtonElement>('button')
                  ?.focus({ preventScroll: true }),
              );
            }}
          >
            <MoreHorizontal size={18} />
            {t('更多操作')}
          </button>
        </>
      ) : (
        <>
          <button
            role="menuitem"
            className="composer-menu-secondary"
            onClick={() => {
              setMore(false);
              requestAnimationFrame(() =>
                menu.current
                  ?.querySelector<HTMLButtonElement>('button')
                  ?.focus({ preventScroll: true }),
              );
            }}
          >
            <ChevronLeft size={18} />
            {t('返回')}
          </button>
          {supports('projectFileBrowser') && (
            <button
              role="menuitem"
              disabled={disabled}
              onClick={() => action(() => onPanel('files'))}
            >
              <FolderOpen size={21} />
              {t('浏览项目文件')}
            </button>
          )}
          <button role="menuitem" disabled={disabled} onClick={() => action(onExpand)}>
            {expanded ? <Minimize2 size={21} /> : <Expand size={21} />}
            {expanded ? t('收起编辑器') : t('展开编辑器')}
          </button>
          {steering !== 'hidden' && (
            <button
              role="menuitem"
              disabled={disabled || steering !== 'ready'}
              onClick={() => action(onSteer)}
            >
              <CornerDownLeft size={21} />
              {t('立即补充到当前任务')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

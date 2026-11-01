import { t, useLocale } from '../i18n';
import { useId } from 'react';
import { usePopoverMotion } from '../motion';
import { Check, ChevronDown, Code2, MessageCircle } from 'lucide-react';
export type WorkMode = 'codex' | 'api';
export function ModeSwitcher({
  mode,
  onChange,
}: {
  mode: WorkMode;
  onChange: (mode: WorkMode) => void;
}) {
  useLocale();
  const id = useId();
  const menu = usePopoverMotion();
  return (
    <div className="mode-switcher">
      <button
        className="mode-trigger"
        popoverTarget={id}
        aria-label={t('切换工作模式')}
        onClick={(event) => {
          const node = menu.current;
          if (!node) return;
          const box = event.currentTarget.getBoundingClientRect();
          const width = Math.min(264, window.innerWidth - 24);
          const below = window.innerHeight - box.bottom - 18;
          const above = box.top - 18;
          const up = below < 120 && above > below;
          node.style.width = `${width}px`;
          node.style.left = `${Math.max(12, Math.min(box.left, window.innerWidth - width - 12))}px`;
          node.style.top = up ? 'auto' : `${box.bottom + 6}px`;
          node.style.bottom = up ? `${window.innerHeight - box.top + 6}px` : 'auto';
          node.style.maxHeight = `${Math.max(60, up ? above : below)}px`;
        }}
      >
        {mode === 'codex' ? 'Codex' : 'AgentChat'}
        <ChevronDown size={14} />
      </button>
      <div id={id} ref={menu} popover="auto" className="mode-menu" aria-label={t('工作模式')}>
        {(
          [
            ['api', 'AgentChat', MessageCircle],
            ['codex', 'Codex', Code2],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            aria-current={mode === value ? 'true' : undefined}
            onClick={() => {
              menu.current?.hidePopover();
              onChange(value);
            }}
          >
            <Icon size={18} />
            <span>{label}</span>
            {mode === value && <Check size={16} />}
          </button>
        ))}
      </div>
    </div>
  );
}

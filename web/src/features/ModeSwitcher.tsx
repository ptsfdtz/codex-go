import { positionPopover, useMenuPopover } from '../components/popover';
import { t, useLocale } from '../i18n';
import { useId } from 'react';
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
  const menu = useMenuPopover();
  return (
    <div className="mode-switcher">
      <button
        type="button"
        className="mode-trigger"
        popoverTarget={id}
        aria-label={t('切换工作模式')}
        onClick={(event) => {
          const node = menu.current;
          if (!node) return;
          positionPopover(event.currentTarget, node, { width: 264 });
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
            type="button"
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

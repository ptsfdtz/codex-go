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
  const id = useId();
  const menu = usePopoverMotion();
  return (
    <div className="mode-switcher">
      <button className="mode-trigger" popoverTarget={id} aria-label="切换工作模式">
        {mode === 'codex' ? 'Codex' : 'AgentChat'}
        <ChevronDown size={14} />
      </button>
      <div id={id} ref={menu} popover="auto" className="mode-menu" aria-label="工作模式">
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

import { t, useLocale } from '../i18n';
import { useId } from 'react';
import { usePopoverMotion } from '../motion';
import { Check, Shield, ShieldAlert } from 'lucide-react';

export function PermissionPicker({
  permission,
  onConfirm,
  disabled,
}: {
  permission: string;
  onConfirm: (permission: string) => void;
  disabled: boolean;
}) {
  useLocale();
  const id = useId();
  const popup = usePopoverMotion();
  const close = () => popup.current?.hidePopover();
  return (
    <div className="permission-picker">
      <button
        className="permission"
        disabled={disabled}
        popoverTarget={id}
        title={t('选择执行权限')}
        aria-label={t('执行权限：{{p0}}', {
          p0: permission === 'full' ? t('完整访问') : t('工作区权限'),
        })}
        data-permission={permission}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          if (popup.current) {
            const width = Math.min(200, window.innerWidth - 24);
            popup.current.style.left = `${Math.max(12, Math.min(box.right - width, window.innerWidth - width - 12))}px`;
            popup.current.style.bottom = `${window.innerHeight - box.top + 10}px`;
            popup.current.style.maxHeight = `${Math.max(120, box.top - 24)}px`;
          }
        }}
      >
        {permission === 'full' ? <ShieldAlert size={16} /> : <Shield size={16} />}
        <span>{permission === 'full' ? t('完整访问') : t('工作区')}</span>
      </button>
      <div
        id={id}
        ref={popup}
        popover="auto"
        role="group"
        aria-label={t('执行权限')}
        className="permission-popup"
      >
        {[
          { value: 'workspace', title: t('工作区权限'), icon: Shield },
          { value: 'full', title: t('完整访问'), icon: ShieldAlert },
        ].map(({ value, title, icon: Icon }) => (
          <button
            key={value}
            className="permission-option"
            data-selected={permission === value}
            aria-pressed={permission === value}
            disabled={disabled}
            onClick={() => {
              onConfirm(value);
              close();
            }}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{title}</span>
            {permission === value && <Check size={16} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}

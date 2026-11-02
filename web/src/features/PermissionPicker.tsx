import { positionPopover, useMenuPopover } from '../components/popover';
import { t, useLocale } from '../i18n';
import { useId } from 'react';
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
  const popup = useMenuPopover();
  const close = () => popup.current?.hidePopover();
  return (
    <div className="permission-picker">
      <button
        type="button"
        className="permission"
        disabled={disabled}
        popoverTarget={id}
        title={t('选择执行权限')}
        aria-label={t('执行权限：{{p0}}', {
          p0: permission === 'full' ? t('完整访问') : t('工作区权限'),
        })}
        data-permission={permission}
        onClick={(event) => {
          if (popup.current)
            positionPopover(event.currentTarget, popup.current, { width: 220, preferAbove: true });
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
            type="button"
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

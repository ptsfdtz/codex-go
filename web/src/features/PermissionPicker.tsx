import { t, useLocale } from '../i18n';
import { useState } from 'react';
import { Check, Hand, ShieldAlert } from 'lucide-react';
import { Modal } from '../ui';
import { MotionPresence } from '../motion';

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
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className="permission-picker">
      <button
        type="button"
        className="permission"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('选择执行权限')}
        aria-label={t('执行权限：{{p0}}', {
          p0: permission === 'full' ? t('完整访问') : t('工作区权限'),
        })}
        data-permission={permission}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setOpen(true);
        }}
      >
        {permission === 'full' ? <ShieldAlert size={23} /> : <Hand size={23} />}
        <span>{permission === 'full' ? t('完整访问') : t('工作区')}</span>
      </button>
      <MotionPresence duration={280}>
        {open && (
          <Modal title={t('应如何批准 Codex 操作？')} className="permission-sheet" onClose={close}>
            <div className="permission-options" role="group" aria-label={t('执行权限')}>
              {[
                {
                  value: 'workspace',
                  title: t('工作区权限'),
                  description: t('在已授权项目内工作，按需请求操作批准'),
                  icon: Hand,
                },
                {
                  value: 'full',
                  title: t('完整访问'),
                  description: t('完全访问计算机（风险较高）'),
                  icon: ShieldAlert,
                },
              ].map(({ value, title, description, icon: Icon }) => (
                <button
                  type="button"
                  key={value}
                  className="permission-option"
                  data-selected={permission === value}
                  data-permission={value}
                  aria-pressed={permission === value}
                  disabled={disabled}
                  onClick={() => {
                    onConfirm(value);
                    close();
                  }}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </span>
                  {permission === value && <Check size={16} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </Modal>
        )}
      </MotionPresence>
    </div>
  );
}

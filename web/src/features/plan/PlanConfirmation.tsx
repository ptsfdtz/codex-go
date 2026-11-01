import { errorText, t, useLocale } from '../../i18n';
import { useState } from 'react';
import { ArrowRight, Pencil, X } from 'lucide-react';
import { IconButton } from '../../ui';
import './plan-confirmation.css';

export function PlanConfirmation({
  disabled,
  error,
  onImplement,
  onRevise,
  onDismiss,
}: {
  disabled: boolean;
  error?: string;
  onImplement: () => void;
  onRevise: (text: string) => void;
  onDismiss: () => void;
}) {
  useLocale();
  const [revision, setRevision] = useState('');
  return (
    <section className="plan-decision" aria-label={t('是否按照此计划开发')}>
      <div className="plan-decision-heading">
        <strong>{t('是否按照此计划开发？')}</strong>
        <IconButton icon={X} label={t('关闭计划确认')} disabled={disabled} onClick={onDismiss} />
      </div>
      <button className="plan-decision-implement" disabled={disabled} onClick={onImplement}>
        <span className="plan-decision-checkbox" aria-hidden="true" />
        <span>{t('是，按照此计划开发')}</span>
        <ArrowRight size={17} aria-hidden="true" />
      </button>
      <form
        className="plan-decision-revise"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && revision.trim()) onRevise(revision.trim());
        }}
      >
        <Pencil size={16} aria-hidden="true" />
        <input
          aria-label={t('计划调整要求')}
          placeholder={t('不，告诉 Codex 需要如何调整')}
          value={revision}
          disabled={disabled}
          onChange={(event) => setRevision(event.target.value)}
        />
        {revision.trim() ? (
          <button type="submit" disabled={disabled} aria-label={t('发送计划调整要求')}>
            <ArrowRight size={16} />
          </button>
        ) : (
          <button type="button" disabled={disabled} onClick={onDismiss}>
            {t('跳过')}
          </button>
        )}
      </form>
      {error && (
        <p className="error" role="alert">
          {errorText(error)}
        </p>
      )}
    </section>
  );
}

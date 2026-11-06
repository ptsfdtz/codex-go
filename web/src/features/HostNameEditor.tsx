import { errorText, t, useLocale } from '../i18n';
import { useEffect, useState, useId } from 'react';
import { Save, LoaderCircle, Check } from 'lucide-react';
import { api } from '../cloud';
import type { Host } from '../workspace';
import type { HostName } from './host-names';

export function HostNameEditor({
  host,
  onSaved,
}: {
  host: Host;
  onSaved: (name: HostName) => void;
}) {
  useLocale();
  const id = useId();
  const [value, setValue] = useState(host.customName || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!dirty) setValue(host.customName || '');
  }, [host.customName, dirty]);
  async function save() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const result = await api<HostName>(`/api/v1/hosts/${encodeURIComponent(host.hostId)}/name`, {
        method: 'PUT',
        body: JSON.stringify({ customName: value.trim() }),
      });
      onSaved(result);
      setValue(result.customName || '');
      setDirty(false);
      setSaved(true);
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="host-name-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving && dirty) void save();
      }}
    >
      <div className="settings-control-row host-name-row">
        <label htmlFor={id}>{t('电脑显示名称')}</label>
        <input
          id={id}
          aria-label={t('电脑显示名称')}
          title={t('电脑显示名称')}
          value={value}
          maxLength={80}
          placeholder={host.displayName}
          disabled={saving}
          onChange={(event) => {
            setValue(event.target.value);
            setDirty(true);
            setSaved(false);
          }}
        />
        <button
          type="submit"
          className="icon-button settings-save"
          title={t('保存名称')}
          aria-label={t('保存名称')}
          aria-busy={saving}
          disabled={saving || !dirty}
        >
          {saving ? (
            <LoaderCircle size={18} className="pending-icon" />
          ) : saved ? (
            <Check size={18} />
          ) : (
            <Save size={18} />
          )}
        </button>
      </div>
      {saved && (
        <span className="visually-hidden" role="status">
          {t('已保存')}
        </span>
      )}
      {error && (
        <p className="error" role="alert">
          {errorText(error)}
        </p>
      )}
    </form>
  );
}

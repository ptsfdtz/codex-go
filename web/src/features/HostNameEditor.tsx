import { errorText, t, useLocale } from '../i18n';
import { useEffect, useState } from 'react';
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
  const [value, setValue] = useState(host.customName || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!dirty) setValue(host.customName || '');
  }, [host.customName, dirty]);
  async function save() {
    setSaving(true);
    setError('');
    try {
      const result = await api<HostName>(`/api/v1/hosts/${encodeURIComponent(host.hostId)}/name`, {
        method: 'PUT',
        body: JSON.stringify({ customName: value.trim() }),
      });
      onSaved(result);
      setValue(result.customName || '');
      setDirty(false);
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="panel-stack">
      <label className="host-label">
        {t('电脑显示名称')}
        <input
          value={value}
          maxLength={80}
          placeholder={host.displayName}
          disabled={saving}
          onChange={(event) => {
            setValue(event.target.value);
            setDirty(true);
          }}
        />
      </label>
      <div>
        <button disabled={saving || !dirty} onClick={() => void save()}>
          {saving ? t('保存中…') : t('保存名称')}
        </button>
      </div>
      <small className="muted">{t('留空恢复默认名称')}</small>
      {error && (
        <p className="error" role="alert">
          {errorText(error)}
        </p>
      )}
    </div>
  );
}

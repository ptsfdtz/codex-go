import { errorText, t, useLocale } from '../i18n';
import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { MotionPresence } from '../motion';
import { IconButton } from '../ui';

export function AppUpdates() {
  useLocale();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD || !checking) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    void fetch(`${import.meta.env.BASE_URL}version.json`, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(t('Update check failed'));
        const value: unknown = await response.json();
        if (
          !value ||
          typeof value !== 'object' ||
          !('version' in value) ||
          typeof value.version !== 'string' ||
          !/^[a-f0-9]{64}$/.test(value.version)
        )
          throw new Error(t('Invalid release'));
        const next = value.version !== __AGENTDECK_WEB_VERSION__;
        setAvailable(next);
        setChecked(true);
        setMessage(
          next
            ? t('发现新版本，可重新加载更新。请先发送或保存未发送的草稿。')
            : t('当前已是最新版本'),
        );
      })
      .catch(() => setMessage(t('检查更新失败，请稍后重试')))
      .finally(() => {
        clearTimeout(timeout);
        setBusy(false);
        setChecking(false);
      });
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [checking]);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    // Passive checks only show availability; never interrupt a conversation or discard a draft.
    const check = () => {
      if (document.visibilityState === 'visible') setChecking(true);
    };
    check();
    const timer = setInterval(check, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return (
    <div className="panel-stack app-updates">
      <h3>{t('应用更新')}</h3>
      {message && <p role="status">{errorText(message)}</p>}
      <button
        disabled={busy || !import.meta.env.PROD}
        onClick={() => {
          setBusy(true);
          setChecking(true);
        }}
      >
        {!import.meta.env.PROD ? t('开发版') : busy ? t('正在检查…') : t('检查更新')}
      </button>
      {checked && available && (
        <button onClick={() => setConfirmReload(true)}>{t('重新加载更新')}</button>
      )}
      <MotionPresence>
        {confirmReload && (
          <div className="confirmation">
            <p>{t('重新加载以更新？未发送的草稿可能丢失，请先保存。')}</p>
            <IconButton icon={X} label={t('取消更新')} onClick={() => setConfirmReload(false)} />
            <IconButton
              icon={RefreshCw}
              label={t('确认重新加载')}
              onClick={() => window.location.reload()}
            />
          </div>
        )}
      </MotionPresence>
    </div>
  );
}

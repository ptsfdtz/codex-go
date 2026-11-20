import { useEffect, useState } from 'react';
import { api, CloudError } from '../../cloud';
import { t } from '../../i18n';
import {
  markSubscription,
  pushConfig,
  pushKey,
  pushOwner,
  subscriptionMatches,
} from './background-push';

export function BackgroundNotifications({ scope, oldHost }: { scope: string; oldHost: boolean }) {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [key, setKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [completions, setCompletions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [ready, setReady] = useState(false);
  const supported =
    'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
  useEffect(() => {
    let active = true;
    setReady(false);
    setKey('');
    setEnabled(false);
    setError('');
    if (!supported) {
      setReady(true);
      return;
    }
    void Promise.all([
      navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL),
      pushConfig(),
    ])
      .then(async ([worker, config]) => {
        const matches = await subscriptionMatches(config, worker);
        if (!active) return;
        setRegistration(worker);
        setKey(config.publicKey || '');
        setEnabled(matches);
        setCompletions(matches && !!config.includeCompletion);
        markSubscription(scope, matches);
      })
      .catch((e: unknown) => {
        if (active && !(e instanceof CloudError && e.status === 404))
          setError(t('push.settingsUnavailable'));
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [scope, supported, retry]);

  async function toggle(on: boolean, includeCompletion = false) {
    if (!registration || !key || busy) return;
    setBusy(true);
    setError('');
    try {
      if (on) {
        // Ask for permission directly from the user gesture (iOS).
        if (
          Notification.permission !== 'granted' &&
          (await Notification.requestPermission()) !== 'granted'
        )
          throw new Error(t('浏览器尚未允许通知，请在系统或网站设置中开启。'));
        const previous = await registration.pushManager.getSubscription();
        // A live subscription may belong to a different login or VAPID key.
        if (!enabled && previous && !(await previous.unsubscribe()))
          throw new Error(t('push.subscriptionFailed'));
        const sub =
          enabled && previous
            ? previous
            : await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: pushKey(key),
              });
        const keys = sub.toJSON().keys;
        if (!keys?.auth || !keys.p256dh) throw new Error(t('push.subscriptionFailed'));
        await api('/api/v1/web/push', {
          method: 'PUT',
          body: JSON.stringify({
            ...pushOwner(scope),
            includeCompletion,
            subscription: { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth },
          }),
        });
      } else {
        await api('/api/v1/web/push', { method: 'DELETE', body: JSON.stringify(pushOwner(scope)) });
        const sub = await registration.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      setEnabled(on);
      setCompletions(on && includeCompletion);
      markSubscription(scope, on);
    } catch (e) {
      setError(
        e instanceof Error && e.message === t('浏览器尚未允许通知，请在系统或网站设置中开启。')
          ? e.message
          : t('push.subscriptionFailed'),
      );
    } finally {
      setBusy(false);
    }
  }
  const hint = !supported
    ? t('push.unsupported')
    : !key || !registration
      ? t('push.unavailable')
      : oldHost
        ? t('push.hostUpdate')
        : '';
  return (
    <div>
      <label className="setting-row">
        <span>{t('push.approvals')}</span>
        <input
          type="checkbox"
          checked={enabled}
          disabled={!ready || busy || !key || !registration || !!error}
          onChange={(e) => void toggle(e.target.checked)}
        />
      </label>
      {enabled && (
        <label className="setting-row">
          <span>{t('push.taskResults')}</span>
          <input
            type="checkbox"
            checked={completions}
            disabled={busy || !!error}
            onChange={(e) => void toggle(true, e.target.checked)}
          />
        </label>
      )}
      {ready &&
        (error ? (
          <p role="status">
            {error} <button onClick={() => setRetry((v) => v + 1)}>{t('重试')}</button>
          </p>
        ) : (
          hint && <p className="muted">{hint}</p>
        ))}
    </div>
  );
}

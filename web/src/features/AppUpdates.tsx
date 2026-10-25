import { useEffect, useState } from 'react';

export function AppUpdates() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
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
        if (!response.ok) throw new Error('Update check failed');
        const value: unknown = await response.json();
        if (
          !value ||
          typeof value !== 'object' ||
          !('version' in value) ||
          typeof value.version !== 'string' ||
          !/^[a-f0-9]{64}$/.test(value.version)
        )
          throw new Error('Invalid release');
        const next = value.version !== __AGENTDECK_WEB_VERSION__;
        setAvailable(next);
        setChecked(true);
        setMessage(
          next ? '发现新版本，可重新加载更新。请先发送或保存未发送的草稿。' : '当前已是最新版本',
        );
      })
      .catch(() => setMessage('检查更新失败，请稍后重试'))
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
    <div className="panel-stack">
      <h3>网页与 PWA 更新</h3>
      <small>更新由 AgentDeck 服务器提供，重新加载后生效。</small>
      {message && <p role="status">{message}</p>}
      <button
        disabled={busy || !import.meta.env.PROD}
        onClick={() => {
          setBusy(true);
          setChecking(true);
        }}
      >
        {busy ? '正在检查…' : '检查更新'}
      </button>
      {!import.meta.env.PROD && <small>开发模式使用热更新。</small>}
      {checked && available && (
        <button
          onClick={() => {
            if (window.confirm('重新加载以更新？未发送的草稿可能丢失，请先保存。'))
              window.location.reload();
          }}
        >
          重新加载更新
        </button>
      )}
    </div>
  );
}

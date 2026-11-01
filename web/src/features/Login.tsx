import type React from 'react';
import { useState } from 'react';
import { useLocale, t, errorText } from '../i18n';
import { api, installationId } from '../cloud';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { InstallApp } from './InstallApp';
export function Login({ onLogin }: { onLogin: () => void }) {
  useLocale();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(
        '/api/v1/web/login',
        {
          method: 'POST',
          body: JSON.stringify({
            username,
            password,
            installationId: installationId(),
            deviceName: `Web ${navigator.platform}`,
            kind: 'web',
          }),
        },
        false,
      );
      onLogin();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="center">
      <form className="card login" onSubmit={submit}>
        <div className="brand">
          AGENT<span>DECK</span>
        </div>
        <h1>{t('登录')}</h1>
        <input
          aria-label={t('用户名')}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder={t('用户名')}
          autoComplete="username"
        />
        <input
          aria-label={t('密码')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t('密码')}
          type="password"
          autoComplete="current-password"
        />
        <button disabled={busy || !username || !password}>{busy ? t('登录中…') : t('登录')}</button>
        {error && <p className="error">{errorText(error)}</p>}
        <LanguageSelect />
        <InstallApp />
      </form>
    </main>
  );
}

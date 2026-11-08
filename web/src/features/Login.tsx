import type React from 'react';
import { useState } from 'react';
import { useLocale, t, errorText } from '../i18n';
import { api, installationId } from '../cloud';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { InstallApp } from './InstallApp';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import agentDeckMark from '../../../assets/branding/agentdeck-mark.svg';
import './login.css';
export function Login({ onLogin }: { onLogin: () => void }) {
  useLocale();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !username || !password) return;
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
    <main className="login-page">
      <div className="login-utilities">
        <LanguageSelect iconOnly />
        <InstallApp />
      </div>
      <section className="login-panel" aria-label={t('登录')}>
        <div className="login-brand">
          <span
            className="login-mark"
            aria-hidden="true"
            style={{ maskImage: `url("${agentDeckMark}")` }}
          />
          <span>AgentDeck</span>
        </div>
        <form className="login-form" onSubmit={submit} aria-busy={busy}>
          <label className="login-field">
            <span>{t('用户名')}</span>
            <input
              aria-label={t('用户名')}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t('用户名')}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>
          <label className="login-field">
            <span>{t('密码')}</span>
            <input
              aria-label={t('密码')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('密码')}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="error login-error" role="alert">
              {errorText(error)}
            </p>
          )}
          <button className="login-submit" type="submit" disabled={busy || !username || !password}>
            {busy ? <LoaderCircle size={18} className="pending-icon" aria-hidden="true" /> : null}
            {busy ? t('登录中…') : t('登录')}
            {!busy && <ArrowRight size={18} strokeWidth={1.7} aria-hidden="true" />}
          </button>
        </form>
      </section>
    </main>
  );
}

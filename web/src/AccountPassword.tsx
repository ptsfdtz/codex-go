import { errorText, t, useLocale } from './i18n';
import { useState, type FormEvent } from 'react';
import { api } from './cloud';

export function AccountPassword() {
  useLocale();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/v1/web/password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : t('密码修改失败'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="center">
      <form className="card login" onSubmit={submit}>
        <h1>{t('修改初始密码')}</h1>
        <p>{t('首次登录需要先设置自己的密码。')}</p>
        <input
          aria-label={t('当前密码')}
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={(event) => setOldPassword(event.target.value)}
          placeholder={t('当前密码')}
        />
        <input
          aria-label={t('新密码')}
          type="password"
          autoComplete="new-password"
          minLength={12}
          aria-describedby="new-password-length"
          aria-invalid={newPassword.length > 0 && newPassword.length < 12}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder={t('新密码（至少 12 个字符）')}
        />
        <p
          id="new-password-length"
          className={newPassword.length > 0 && newPassword.length < 12 ? 'error' : 'muted'}
          role="status"
        >
          {t('新密码至少需要 12 个字符')}
          {newPassword.length > 0 && newPassword.length < 12
            ? t('，还需输入 {{p0}} 个字符。', { p0: 12 - newPassword.length })
            : '。'}
        </p>
        <input
          aria-label={t('确认新密码')}
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={t('确认新密码')}
        />
        <button
          disabled={busy || !oldPassword || newPassword.length < 12 || confirmation !== newPassword}
        >
          {t('保存并重新登录')}
        </button>
        {error && <p className="error">{errorText(error)}</p>}
      </form>
    </main>
  );
}

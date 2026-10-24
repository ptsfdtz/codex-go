import { useState } from 'react';
import type { Action, CloudState } from '../../bridge/host';

export function CloudSettings({
  state,
  busy,
  available,
  send,
}: {
  state?: CloudState;
  busy: boolean;
  available: boolean;
  send: (action: Action) => Promise<boolean>;
}) {
  const [origin, setOrigin] = useState(state?.origin || 'https://agent.ptsfdtz.top');
  const [username, setUsername] = useState(state?.username ?? '');
  const [password, setPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || !available;
  if (!state?.signedIn)
    return (
      <section className="cloud-settings">
        <h3>公网连接</h3>
        <p>使用普通账户登录后，可以在其他网络连接这台电脑。网页管理后台使用管理员账户。</p>
        {state?.error && <p role="status">{state.error}</p>}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void (async () => {
              const value = password;
              setPassword('');
              await send({ action: 'cloud.login', origin, username, password: value });
            })();
          }}
        >
          <label>
            服务器地址
            <input
              type="url"
              required
              placeholder="https://agent.ptsfdtz.top"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
              disabled={disabled}
            />
          </label>
          <label>
            用户名
            <input
              autoComplete="username"
              required
              maxLength={80}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={disabled}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={1024}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={disabled}
            />
          </label>
          <button className="button primary" disabled={disabled}>
            登录
          </button>
        </form>
        <p className="modal-hint">局域网配对可以独立使用，无需账户或互联网。</p>
      </section>
    );
  return (
    <section className="cloud-settings">
      <h3>公网连接</h3>
      <p>
        {state.username} · {state.origin}
      </p>
      <p role="status">
        {state.mustChangePassword
          ? '请先修改初始密码'
          : state.online
            ? '已连接，可从其他网络访问'
            : (state.error ?? '正在连接服务器…')}
      </p>
      {(changing || state.mustChangePassword) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (newPassword !== confirm) {
              setError('两次输入的新密码不同。');
              return;
            }
            setError(null);
            const action: Action = { action: 'cloud.password', oldPassword, newPassword };
            setOldPassword('');
            setNewPassword('');
            setConfirm('');
            void send(action).then((ok) => {
              if (ok) setChanging(false);
            });
          }}
        >
          <label>
            原密码
            <input
              type="password"
              autoComplete="current-password"
              required
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
              disabled={disabled}
            />
          </label>
          <label>
            新密码（至少 12 字节）
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              disabled={disabled}
            />
          </label>
          <label>
            再次输入新密码
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              disabled={disabled}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={disabled}>
            修改密码并重新登录
          </button>
        </form>
      )}
      <div className="modal-actions">
        {!state.mustChangePassword && (
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() => setChanging(!changing)}
          >
            修改密码
          </button>
        )}
        <button
          className="button secondary"
          disabled={disabled}
          onClick={() => void send({ action: 'cloud.logout', unbind: false })}
        >
          退出账户
        </button>
        {!state.mustChangePassword && (
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() => {
              if (
                window.confirm('解绑并退出这台电脑的云端账户？公网连接将关闭，局域网配对继续保留。')
              )
                void send({ action: 'cloud.logout', unbind: true });
            }}
          >
            解绑电脑
          </button>
        )}
      </div>
    </section>
  );
}

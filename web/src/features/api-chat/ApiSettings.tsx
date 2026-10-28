import { useState } from 'react';
import { Plus, Trash2, KeyRound, ChevronLeft } from 'lucide-react';
import { Modal, IconButton } from '../../ui';
import { chatApi, type Provider } from './client';
import { api } from '../../cloud';
export function ApiSettings({
  providers,
  enabled,
  onClose,
  onChanged,
}: {
  providers: Provider[];
  enabled: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [providerId, setProviderId] = useState<string>(() => crypto.randomUUID());
  const [editing, setEditing] = useState<Provider>(),
    [creating, setCreating] = useState(!providers.length);
  const [name, setName] = useState(''),
    [base, setBase] = useState('https://api.openai.com/v1'),
    [key, setKey] = useState(''),
    [models, setModels] = useState('');
  const [modelEfforts, setModelEfforts] = useState<Record<string, string>>({});
  const modelNames = [
    ...new Set(
      models
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [removing, setRemoving] = useState('');
  function edit(provider?: Provider) {
    setProviderId(provider?.id || crypto.randomUUID());
    setEditing(provider);
    setCreating(true);
    setName(provider?.name || '');
    setBase(provider?.baseUrl || 'https://api.openai.com/v1');
    setKey('');
    setModels(provider?.models.join('\n') || '');
    setModelEfforts(
      Object.fromEntries(
        Object.entries(provider?.modelEfforts || {}).map(([model, values]) => [
          model,
          values.join(', '),
        ]),
      ),
    );
    setError('');
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const values = [
        ...new Set(
          models
            .split(/[\n,]/)
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ];
      await chatApi(`/providers/${editing?.id || providerId}`, 'PUT', {
        name: name.trim(),
        baseUrl: base.trim(),
        ...(key ? { apiKey: key } : {}),
        models: values,
        modelEfforts: Object.fromEntries(
          values.map((model) => [
            model,
            (modelEfforts[model] || '').split(/[,，\s]+/).filter(Boolean),
          ]),
        ),
      });
      setKey('');
      await onChanged();
      setCreating(false);
      setEditing(undefined);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="设置" wide onClose={onClose} className="api-settings">
      {!enabled && (
        <p className="api-feedback" role="status">
          AgentChat 尚未启用，请联系管理员完成服务端配置。
        </p>
      )}
      {creating ? (
        <form
          className="api-provider-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {!!providers.length && (
            <button
              className="text-button api-settings-back"
              type="button"
              disabled={busy}
              onClick={() => {
                setCreating(false);
                setKey('');
              }}
            >
              <ChevronLeft size={15} />
              所有接口
            </button>
          )}
          <label>
            名称
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：我的 API"
              maxLength={80}
              required
              disabled={busy}
            />
          </label>
          <label>
            Base URL
            <input
              value={base}
              onChange={(event) => setBase(event.target.value)}
              placeholder="https://api.example.com/v1"
              type="url"
              required
              disabled={busy}
            />
          </label>
          <label>
            API Key
            <input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={editing ? '已保存，留空保持原密钥' : '输入 API Key'}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              required={!editing}
              maxLength={4096}
              disabled={busy}
            />
          </label>
          <label>
            模型
            <textarea
              value={models}
              onChange={(event) => setModels(event.target.value)}
              placeholder="每行一个模型名称，按接口提供的名称填写"
              rows={3}
              required
              disabled={busy}
            />
          </label>
          {!!modelNames.length && (
            <details className="api-effort-settings">
              <summary>思考强度</summary>
              <div className="api-effort-fields">
                <p className="muted">填写接口支持的档位，按从低到高排列。留空使用接口默认值。</p>
                {modelNames.map((model) => (
                  <label key={model}>
                    {model} 的思考强度
                    <input
                      value={modelEfforts[model] || ''}
                      onChange={(event) =>
                        setModelEfforts((values) => ({ ...values, [model]: event.target.value }))
                      }
                      placeholder="例如 low, medium, high"
                      disabled={busy}
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                  </label>
                ))}
              </div>
            </details>
          )}
          <p className="muted">密钥加密保存在账户中，不会在网页回显。聊天通过此接口产生用量。</p>
          <div className="api-settings-save">
            <button type="button" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button
              className="primary"
              disabled={!enabled || busy || !name.trim() || !models.trim()}
            >
              {' '}
              {busy ? '保存中…' : '保存接口'}
            </button>
          </div>
        </form>
      ) : (
        <div className="api-provider-list">
          {providers.map((provider) => (
            <div key={provider.id} className="api-provider-row">
              <button className="api-provider-name" onClick={() => edit(provider)}>
                <KeyRound size={18} />
                <span>
                  {provider.name}
                  <small>
                    {provider.models.length} 个模型 · {new URL(provider.baseUrl).host}
                  </small>
                </span>
              </button>
              <IconButton
                icon={Trash2}
                label={`删除接口 ${provider.name}`}
                disabled={busy}
                onClick={() => setRemoving(provider.id)}
              />
              {removing === provider.id && (
                <div className="confirmation">
                  <p>删除此接口？已有聊天记录会保留。</p>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void chatApi(`/providers/${provider.id}`, 'DELETE')
                        .then(onChanged)
                        .then(() => setRemoving(''))
                        .catch((error) => setError(String(error)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    确认删除
                  </button>
                  <button onClick={() => setRemoving('')}>取消</button>
                </div>
              )}
            </div>
          ))}
          <button className="api-add-provider" disabled={!enabled} onClick={() => edit()}>
            <Plus size={17} />
            添加接口
          </button>
        </div>
      )}
      <button
        className="text-button api-logout"
        disabled={busy}
        onClick={() => {
          void api('/api/v1/web/logout', { method: 'POST' }).catch((error) =>
            setError(String(error)),
          );
        }}
      >
        退出登录
      </button>
      {error && (
        <p className="api-feedback" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

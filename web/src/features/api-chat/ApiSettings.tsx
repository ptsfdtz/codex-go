import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2, KeyRound, ChevronLeft, RefreshCw } from 'lucide-react';
import { Modal, IconButton } from '../../ui';
import { discoverModels, saveProvider, deleteProvider, type Provider } from './client';
import { api } from '../../cloud';
export function ApiSettings({
  scope,
  providers,
  enabled,
  onClose,
  onChanged,
}: {
  scope: string;
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
  const [fetching, setFetching] = useState(false);
  const request = useRef<AbortController | null>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [effortModel, setEffortModel] = useState('');
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
  const fetchModels = useCallback(async () => {
    if (!enabled || !creating || !base.trim() || (!key.trim() && !editing)) return;
    clearTimeout(fetchTimer.current);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setFetching(true);
    setError('');
    try {
      const models = await discoverModels(base.trim(), key.trim(), editing, controller.signal);
      if (!controller.signal.aborted) setModels(models.join('\n'));
    } catch (error) {
      if (!controller.signal.aborted) setError(String(error));
    } finally {
      if (!controller.signal.aborted) setFetching(false);
    }
  }, [enabled, creating, base, key, editing]);
  useEffect(() => {
    request.current?.abort();
    setFetching(false);
    setError('');
    fetchTimer.current =
      creating && key.trim() && base.trim() ? setTimeout(() => void fetchModels(), 700) : undefined;
    return () => {
      clearTimeout(fetchTimer.current);
      request.current?.abort();
    };
  }, [creating, base, key, fetchModels]);
  const selectedEffortModel = modelNames.includes(effortModel) ? effortModel : modelNames[0] || '';
  function edit(provider?: Provider) {
    request.current?.abort();
    setFetching(false);
    setEffortModel('');
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
    if (busy || fetching) return;
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
      await saveProvider(
        scope,
        {
          id: editing?.id || providerId,
          name: name.trim() || new URL(base.trim()).hostname,
          baseUrl: base.trim(),
          models: values,
          hasKey: true,
          modelEfforts: Object.fromEntries(
            values.map((model) => [
              model,
              (modelEfforts[model] || '').split(/[,，\s]+/).filter(Boolean),
            ]),
          ),
        },
        key.trim(),
        editing,
      );
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
    <Modal title="设置" onClose={onClose} className="api-settings">
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
          <div className="api-model-field">
            <div className="api-model-label">
              <label htmlFor="provider-models">
                模型{modelNames.length ? ` · ${modelNames.length}` : ''}
              </label>
              <button
                type="button"
                className="text-button"
                disabled={busy || fetching || !enabled || (!key.trim() && !editing)}
                onClick={() => void fetchModels()}
              >
                <RefreshCw size={13} className={fetching ? 'spinning' : ''} />
                {fetching ? '获取中…' : '获取模型'}
              </button>
            </div>
            <textarea
              id="provider-models"
              aria-label="模型"
              value={models}
              onChange={(event) => {
                clearTimeout(fetchTimer.current);
                request.current?.abort();
                setFetching(false);
                setModels(event.target.value);
              }}
              placeholder="自动获取，也可手动填写"
              rows={2}
              required
              disabled={busy}
            />
          </div>
          <details className="api-effort-settings">
            <summary>高级设置</summary>
            <div className="api-effort-fields">
              <label>
                名称
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：我的 API"
                  maxLength={80}
                  disabled={busy}
                />
              </label>
              {!!modelNames.length && (
                <>
                  <label>
                    思考强度
                    <select
                      aria-label="配置思考强度的模型"
                      value={selectedEffortModel}
                      onChange={(event) => setEffortModel(event.target.value)}
                      disabled={busy}
                    >
                      {modelNames.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    aria-label={`${selectedEffortModel} 的思考强度`}
                    value={modelEfforts[selectedEffortModel] || ''}
                    onChange={(event) =>
                      setModelEfforts((values) => ({
                        ...values,
                        [selectedEffortModel]: event.target.value,
                      }))
                    }
                    placeholder="默认；或填写 low, medium, high"
                    disabled={busy}
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </>
              )}
            </div>
          </details>
          <div className="api-settings-save">
            <button type="button" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button className="primary" disabled={!enabled || busy || fetching || !models.trim()}>
              {' '}
              {busy ? '保存中…' : '保存'}
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
                      void deleteProvider(scope, provider.id)
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
      {!creating && (
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
      )}
      {error && (
        <p className="api-feedback" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

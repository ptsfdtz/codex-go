import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Copy,
  Menu,
  MessageSquarePlus,
  Search,
  Settings,
  Trash2,
  MessageCircle,
} from 'lucide-react';
import { IconButton, Modal } from '../../ui';
import { Markdown } from '../../RichContent';
import { CloudError } from '../../cloud';
import { ApiSettings } from './ApiSettings';
import { chatApi, watchChat, type Provider, type ChatSummary, type ChatDetail } from './client';
import './api-chat.css';
import { Composer } from '../Composer';
import type { Draft, Model } from '../../workspace';

type Choice = { providerId: string; model: string; effort?: string };
type Submission = Choice & {
  requestId: string;
  text: string;
  target: string;
  original: string;
  expectedLastMessageId: string | null;
};
function saved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') || fallback;
  } catch {
    return fallback;
  }
}
function persist(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* In-memory state remains usable. */
  }
}
export function ApiChat({ scope, modeControl }: { scope: string; modeControl: ReactNode }) {
  const [providers, setProviders] = useState<Provider[]>([]),
    [enabled, setEnabled] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]),
    [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<ChatDetail>();
  const [sidebar, setSidebar] = useState(() => matchMedia('(min-width:761px)').matches),
    [settings, setSettings] = useState(false),
    [search, setSearch] = useState('');
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
      saved(`agentdeck.api.choices.${scope}`, {}),
    ),
    [drafts, setDrafts] = useState<Record<string, string>>(() =>
      saved(`agentdeck.api.drafts.${scope}`, {}),
    );
  const [receipt, setReceipt] = useState<Submission | undefined>(() =>
    saved(`agentdeck.api.pending.${scope}`, undefined),
  );
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0),
    [deleting, setDeleting] = useState('');
  const selectedRef = useRef(selected),
    epoch = useRef(0),
    sending = useRef(false),
    mounted = useRef(true);
  selectedRef.current = selected;
  const timeline = useRef<HTMLDivElement>(null),
    stick = useRef(true);
  const text = drafts[selected || 'new'] || '';
  const choice =
    choices[selected || 'new'] ||
    (detail && detail.id === selected
      ? { providerId: detail.providerId, model: detail.model, effort: detail.effort || '' }
      : { providerId: providers[0]?.id || '', model: providers[0]?.models[0] || '' });
  const available = providers.some(
    (provider) => provider.id === choice.providerId && provider.models.includes(choice.model),
  );
  const models: Model[] = providers.flatMap((provider) =>
    provider.models.map((model) => ({
      id: JSON.stringify([provider.id, model]),
      displayName: `${model} · ${provider.name}`,
      supportedReasoningEfforts: provider.modelEfforts?.[model] || [],
    })),
  );
  const pickerModel = JSON.stringify([choice.providerId, choice.model]);
  const draft: Draft = {
    text,
    model: pickerModel,
    effort: choice.effort || '',
    mode: 'default',
    attachments: [],
    skills: [],
  };
  function changeDraft(change: Partial<Draft>) {
    if (change.text !== undefined) updateText(change.text);
    if (change.model !== undefined || change.effort !== undefined) {
      const [providerId, model] = JSON.parse(change.model || pickerModel) as [string, string];
      setChoices((values) => ({
        ...values,
        [selected || 'new']: {
          providerId,
          model,
          effort: change.effort ?? (change.model ? '' : choice.effort || ''),
        },
      }));
    }
  }
  const active =
    detail?.id === selected
      ? detail.messages.find((message) => message.status === 'running')
      : undefined;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, []);
  const refresh = useCallback(async () => {
    const value = await chatApi<{ data: Provider[]; enabled: boolean }>('/providers');
    if (!mounted.current) return;
    setProviders(value.data);
    setEnabled(value.enabled);
    const list = await chatApi<{ data: ChatSummary[] }>('/conversations');
    if (mounted.current) setChats(list.data);
  }, []);
  useEffect(() => {
    void refresh()
      .catch((error) => {
        if (mounted.current) setError(String(error));
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
  }, [refresh]);
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'visible') {
        setReload((value) => value + 1);
        void refresh().catch(() => {});
      }
    };
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    return () => {
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    };
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController(),
      generation = ++epoch.current;
    setDetail(undefined);
    setError('');
    stick.current = true;
    if (!selected) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    void chatApi<ChatDetail>(`/conversations/${selected}`, 'GET', undefined, controller.signal)
      .then(async (value) => {
        if (epoch.current !== generation) return;
        setDetail(value);
        setLoading(false);
        if (value.messages.some((message) => message.status === 'running')) {
          await watchChat(selected, controller.signal, (value) => {
            if (epoch.current === generation) {
              setDetail(value);
              if (!value.messages.some((message) => message.status === 'running'))
                void refresh().catch(() => {});
            }
          });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && epoch.current === generation) setError(String(error));
      })
      .finally(() => {
        if (epoch.current === generation) setLoading(false);
      });
    return () => controller.abort();
  }, [selected, reload, refresh]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      const node = document.querySelector<HTMLElement>('.api-chat');
      node?.style.setProperty('--app-height', `${viewport?.height || window.innerHeight}px`);
    };
    viewport?.addEventListener('resize', resize);
    resize();
    document.documentElement.dataset.theme =
      localStorage.getItem('agentdeck.web.theme') || 'system';
    return () => viewport?.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (stick.current) timeline.current?.scrollTo({ top: timeline.current.scrollHeight });
  }, [detail?.messages]);
  function select(id: string) {
    setSelected(id);
    if (matchMedia('(max-width:760px)').matches) setSidebar(false);
  }
  function updateText(value: string) {
    setDrafts((drafts) => ({ ...drafts, [selected || 'new']: value }));
  }
  useEffect(() => {
    persist(`agentdeck.api.drafts.${scope}`, drafts);
  }, [scope, drafts]);
  useEffect(() => {
    persist(`agentdeck.api.choices.${scope}`, choices);
  }, [scope, choices]);
  function remember(value?: Submission) {
    persist(`agentdeck.api.pending.${scope}`, value);
    setReceipt(value);
  }
  async function submit(value: Submission) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    const accepted = () => {
      remember();
      setDrafts((drafts) =>
        drafts[value.original || 'new'] === value.text
          ? { ...drafts, [value.original || 'new']: '' }
          : drafts,
      );
      if (selectedRef.current === value.original || selectedRef.current === value.target) {
        setSelected(value.target);
        setReload((version) => version + 1);
      }
    };
    try {
      if (!value.original)
        await chatApi('/conversations', 'POST', {
          id: value.target,
          providerId: value.providerId,
          model: value.model,
        });
      await chatApi(`/conversations/${value.target}/messages`, 'POST', {
        requestId: value.requestId,
        text: value.text,
        providerId: value.providerId,
        model: value.model,
        effort: value.effort || '',
        expectedLastMessageId: value.expectedLastMessageId,
      });
      if (!mounted.current) return;
      accepted();
      void refresh().catch((error) => {
        if (mounted.current) setError(String(error));
      });
    } catch (error) {
      if (!mounted.current) return;
      try {
        const current = await chatApi<ChatDetail>(`/conversations/${value.target}`);
        if (!mounted.current) return;
        if (current.messages.some((message) => message.requestId === value.requestId)) {
          accepted();
          void refresh().catch(() => {});
          return;
        }
      } catch {
        /* Keep the same idempotency key until an acknowledgement is read. */
      }
      if (error instanceof CloudError && error.status >= 400 && error.status < 500) remember();
      setError(String(error));
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function send() {
    if (sending.current || busy || loading || active || receipt || !available || !text.trim())
      return;
    if (new TextEncoder().encode(text).length > 12000) {
      setError('单条消息最多 12,000 字节，请缩短后发送');
      return;
    }
    const value: Submission = {
      ...choice,
      requestId: crypto.randomUUID(),
      text,
      target: selected || crypto.randomUUID(),
      original: selected,
      expectedLastMessageId: detail?.id === selected ? detail.messages.at(-1)?.id || null : null,
    };
    remember(value);
    void submit(value);
  }
  async function stop() {
    if (!active || busy) return;
    setBusy(true);
    try {
      await chatApi(`/conversations/${selected}/stop`, 'POST', { messageId: active.id });
      setReload((value) => value + 1);
    } catch (error) {
      setError(String(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className={`shell api-chat ${sidebar ? 'with-sidebar' : ''}`}>
      <button
        className={`sidebar-scrim ${sidebar ? 'visible' : ''}`}
        aria-label="关闭侧栏"
        onClick={() => setSidebar(false)}
      />
      <aside className={`sidebar ${sidebar ? 'open' : ''}`} inert={!sidebar} aria-hidden={!sidebar}>
        <div className="sidebar-brand">
          {modeControl}
          <IconButton icon={Menu} label="收起会话列表" onClick={() => setSidebar(false)} />
        </div>
        <div className="sidebar-primary">
          <button disabled={busy} onClick={() => select('')}>
            <MessageSquarePlus size={19} />
            新对话
          </button>
          <IconButton
            icon={Search}
            label="搜索对话"
            onClick={() => document.getElementById('api-chat-search')?.focus()}
          />
        </div>
        <div className="api-search">
          <Search size={15} />
          <input
            id="api-chat-search"
            aria-label="搜索对话"
            placeholder="搜索对话"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <nav className="sidebar-scroll api-chat-list" aria-label="AgentChat 记录">
          {chats
            .filter((chat) => chat.title.toLowerCase().includes(search.toLowerCase()))
            .map((chat) => (
              <div key={chat.id} className={`api-chat-row ${selected === chat.id ? 'active' : ''}`}>
                <button disabled={busy} onClick={() => select(chat.id)}>
                  {chat.title}
                </button>
                <IconButton
                  icon={Trash2}
                  label={`删除对话 ${chat.title}`}
                  disabled={busy}
                  onClick={() => setDeleting(chat.id)}
                />
              </div>
            ))}
          {!chats.length && <p className="api-list-empty">对话会保存在这里</p>}
        </nav>
        <div className="sidebar-footer">
          <button onClick={() => setSettings(true)}>
            <Settings size={18} />
            设置
          </button>
        </div>
      </aside>
      <section className="conversation-layout">
        <section className="conversation">
          <header className="topbar">
            <IconButton
              icon={Menu}
              label="打开会话列表"
              onClick={() => setSidebar(!sidebar)}
              className={sidebar ? 'rail-toggle' : ''}
            />
            {!sidebar && modeControl}
            <span className="api-top-title">
              {selected ? detail?.title || 'AgentChat' : '新对话'}
            </span>
            <IconButton icon={Settings} label="设置" onClick={() => setSettings(true)} />
          </header>
          <div
            className="timeline api-timeline"
            ref={timeline}
            onScroll={() => {
              const node = timeline.current;
              if (node)
                stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100;
            }}
          >
            {!selected ? (
              <div className="api-welcome">
                <MessageCircle size={32} strokeWidth={1.3} />
                <h1>有什么想聊的？</h1>
                <p>{providers.length ? '选择模型，开始一段对话' : '添加你的 API，随时开始对话'}</p>
                {!providers.length && (
                  <button onClick={() => setSettings(true)} disabled={loading}>
                    打开设置
                  </button>
                )}
              </div>
            ) : (
              <div className="api-messages">
                {loading && !detail && (
                  <p className="muted" role="status">
                    正在读取对话…
                  </p>
                )}
                {detail?.messages.map((message) => (
                  <article key={message.id} className={`api-message api-message-${message.role}`}>
                    <div className="api-message-body">
                      <Markdown
                        text={
                          message.content ||
                          (message.status === 'running' ? '正在思考…' : '未收到回复')
                        }
                      />
                    </div>
                    {message.role === 'assistant' && (
                      <div className="api-message-actions">
                        <IconButton
                          icon={Copy}
                          label="复制回复"
                          disabled={!message.content}
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(message.content)
                              .catch(() => setError('复制失败，请手动选择文字'));
                          }}
                        />
                        {message.status === 'running' ? (
                          <span role="status">生成中</span>
                        ) : message.status === 'stopped' ? (
                          <span>已停止</span>
                        ) : null}
                      </div>
                    )}
                    {message.error && <p className="api-feedback">{message.error}</p>}
                  </article>
                ))}
              </div>
            )}
          </div>
          <div className="api-composer-area">
            {error && (
              <div className="api-feedback" role="alert">
                {error}
                <button
                  className="text-button"
                  onClick={() => {
                    setReload((value) => value + 1);
                    void refresh().catch((error) => setError(String(error)));
                  }}
                >
                  刷新会话
                </button>
              </div>
            )}
            {receipt && !busy && (
              <div className="api-feedback" role="status">
                这条消息尚未确认，草稿已保留。
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void submit(receipt)}
                >
                  重试同一请求
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setSelected(receipt.target);
                    setReload((value) => value + 1);
                  }}
                >
                  查看目标对话
                </button>
              </div>
            )}
            {!available && !!providers.length && (
              <p className="api-feedback">请选择可用模型，或重新配置此对话的 API。</p>
            )}
          </div>
          <Composer
            key={selected || 'new'}
            draft={draft}
            models={models}
            execution={false}
            chat
            supports={() => false}
            disabled={false}
            busy={busy}
            active={!!active}
            sendBlocked={loading || !!receipt || !enabled || !available}
            permission="workspace"
            onPermission={() => {}}
            onChange={changeDraft}
            onSend={() => send()}
            onStop={() => void stop()}
            onPanel={() => {}}
            onNew={() => select('')}
          />
        </section>
      </section>
      {settings && (
        <ApiSettings
          providers={providers}
          enabled={enabled}
          onClose={() => setSettings(false)}
          onChanged={refresh}
        />
      )}
      {deleting && (
        <Modal title="删除对话" onClose={() => setDeleting('')}>
          <p>此对话的聊天记录将从账户中删除。</p>
          <div className="button-row">
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void chatApi(`/conversations/${deleting}`, 'DELETE')
                  .then(async () => {
                    if (selected === deleting) select('');
                    setDeleting('');
                    await refresh();
                  })
                  .catch((error) => setError(String(error)))
                  .finally(() => setBusy(false));
              }}
            >
              删除对话
            </button>
            <button onClick={() => setDeleting('')}>取消</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

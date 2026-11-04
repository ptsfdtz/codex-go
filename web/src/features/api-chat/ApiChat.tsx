import { errorText, t, useLocale } from '../../i18n';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Copy,
  Menu,
  MessageSquarePlus,
  Search,
  Settings,
  Trash2,
  MessageCircle,
  ChevronLeft,
  SquarePen,
  Plus,
} from 'lucide-react';
import { IconButton, Modal } from '../../ui';
import { MotionPresence, MotionList, useSidebarMotion, useContentMotion } from '../../motion';
import { Markdown } from '../../RichContent';
import { ApiSettings } from './ApiSettings';
import {
  keyStatus,
  getKey,
  providerFetch,
  streamCompletion,
  ProviderHttpError,
  type Provider,
  type ChatSummary,
  type ChatDetail,
  type ChatMessage,
} from './client';
import { LocalStore } from './local';
import { SidebarResizer } from '../SidebarResizer';
import './api-chat.css';
import { Composer } from '../Composer';
import type { Draft, Model } from '../../workspace';
type Choice = { providerId: string; model: string; effort?: string };
class DeletedChatError extends Error {}
function saved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') || fallback;
  } catch {
    return fallback;
  }
}
function persist(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}
export function ApiChat({ scope, modeControl }: { scope: string; modeControl: ReactNode }) {
  useLocale();
  const [providers, setProviders] = useState<Provider[]>([]),
    [enabled, setEnabled] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]),
    [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<ChatDetail>();
  const [sidebar, setSidebar] = useState(true),
    [settings, setSettings] = useState(false),
    [search, setSearch] = useState('');
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    saved(`agentdeck.api.choices.${scope}`, {}),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    saved(`agentdeck.api.drafts.${scope}`, {}),
  );
  const [confirmSend, setConfirmSend] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [deleting, setDeleting] = useState('');
  const store = useRef(new LocalStore(scope)).current;
  const memory = useRef(new Map<string, ChatDetail>());
  const deletedIds = useRef(new Set<string>());
  const jobs = useRef(new Map<string, { controller: AbortController; stopped: boolean }>());
  const channel = useRef<BroadcastChannel | null>(null);
  const pending = useRef<string | null>(null);
  const selectedRef = useRef(selected),
    sending = useRef(false),
    mounted = useRef(true);
  selectedRef.current = selected;
  const sidebarMotion = useSidebarMotion(sidebar);
  const contentMotion = useContentMotion<HTMLDivElement>(selected);
  const timeline = useRef<HTMLDivElement>(null),
    stick = useRef(true);
  const text = drafts[selected || 'new'] || '';
  const choice =
    choices[selected || 'new'] ||
    (detail?.id === selected
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
  if (choice.model && !available) models.push({ id: pickerModel, displayName: choice.model });
  const draft: Draft = {
    text,
    model: choice.model ? pickerModel : '',
    effort: choice.effort || '',
    mode: 'default',
    attachments: [],
    skills: [],
  };
  function changeDraft(change: Partial<Draft>) {
    if (change.text !== undefined)
      setDrafts((values) => ({ ...values, [selected || 'new']: change.text! }));
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
  const publish = useCallback((chat: ChatDetail) => {
    if (deletedIds.current.has(chat.id)) return;
    const value = structuredClone(chat);
    memory.current.set(chat.id, value);
    if (!mounted.current) return;
    const summary: ChatSummary = {
      id: value.id,
      title: value.title,
      providerId: value.providerId,
      model: value.model,
      effort: value.effort,
      updatedAt: value.updatedAt,
    };
    setChats((values) =>
      [summary, ...values.filter((value) => value.id !== chat.id)].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    );
    if (selectedRef.current === chat.id) setDetail(value);
  }, []);
  const forgetChat = useCallback((id: string) => {
    deletedIds.current.add(id);
    const job = jobs.current.get(id);
    if (job) {
      job.stopped = true;
      job.controller.abort();
    }
    memory.current.delete(id);
    if (!mounted.current) return;
    setChats((values) => values.filter((chat) => chat.id !== id));
    if (selectedRef.current === id) {
      selectedRef.current = '';
      setSelected('');
      setDetail(undefined);
    }
  }, []);
  const saveChat = useCallback(
    async (chat: ChatDetail) => {
      const value = structuredClone(chat);
      if (!(await store.saveChat(value))) {
        forgetChat(chat.id);
        throw new DeletedChatError();
      }
      publish(value);
      channel.current?.postMessage({ type: 'updated', id: chat.id });
    },
    [forgetChat, publish, store],
  );
  const readChat = useCallback(
    async (id: string) => {
      let chat =
        (jobs.current.has(id) && memory.current.get(id)) ||
        (await store.read<ChatDetail>('chat', id));
      if (!chat) return undefined;
      if (!jobs.current.has(id) && chat.messages.some((message) => message.status === 'running')) {
        const recover = async () => {
          chat = await store.recoverChat(id);
          if (chat) publish(chat);
          channel.current?.postMessage({ type: 'updated', id });
        };
        if (navigator.locks)
          await navigator.locks.request(
            `agentchat:${scope}:${id}`,
            { ifAvailable: true },
            async (lock) => {
              if (lock) await recover();
            },
          );
        // Without Web Locks we cannot distinguish an orphan from another tab's
        // live request. Leave persistent state intact rather than guessing.
      }
      if (chat) memory.current.set(id, chat);
      else memory.current.delete(id);
      return chat;
    },
    [publish, scope, store],
  );
  const refresh = useCallback(async () => {
    const [providers, summaries] = await Promise.all([
      store.list<Provider>('provider'),
      store.list<ChatSummary>('summary'),
    ]);
    if (!mounted.current) return;
    setProviders(providers);
    setChats(summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }, [store]);
  useEffect(() => {
    mounted.current = true;
    const bus =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(`agentdeck-agentchat:${scope}`);
    channel.current = bus;
    if (bus)
      bus.onmessage = (event) => {
        const { type, id } = event.data || {};
        if (typeof id !== 'string') return;
        if (type === 'stop') {
          const job = jobs.current.get(id);
          if (job) {
            job.stopped = true;
            job.controller.abort();
          }
          return;
        }
        if (type === 'deleted') {
          forgetChat(id);
          return;
        }
        if (type === 'updated' && !jobs.current.has(id)) {
          memory.current.delete(id);
          void refresh()
            .then(async () => {
              if (selectedRef.current === id) setDetail(await store.read<ChatDetail>('chat', id));
            })
            .catch((error) => setError(String(error)));
        }
      };
    void Promise.all([
      refresh(),
      keyStatus().then((value) => {
        if (mounted.current) setEnabled(value.enabled);
      }),
    ])
      .catch((error) => {
        if (mounted.current) setError(String(error));
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
      for (const job of jobs.current.values()) job.controller.abort();
      bus?.close();
      channel.current = null;
    };
  }, [forgetChat, refresh, scope, store]);
  useEffect(() => {
    let cancelled = false;
    stick.current = true;
    setDetail(undefined);
    setError('');
    if (!selected) return;
    void readChat(selected)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((error) => {
        if (!cancelled) setError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [selected, readChat]);
  useEffect(() => {
    if (!selected || !active || jobs.current.has(selected)) return;
    const timer = setInterval(() => {
      memory.current.delete(selected);
      void readChat(selected)
        .then((value) => {
          if (mounted.current && selectedRef.current === selected) setDetail(value);
        })
        .catch((error) => {
          if (mounted.current) setError(String(error));
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [selected, active, readChat]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      if (viewport && viewport.scale !== 1) return;
      document
        .querySelector<HTMLElement>('.api-chat')
        ?.style.setProperty('--app-height', `${viewport?.height || window.innerHeight}px`);
    };
    viewport?.addEventListener('resize', resize);
    resize();
    document.documentElement.dataset.theme = localStorage.getItem('agentdeck.web.theme') || 'dark';
    return () => viewport?.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (stick.current) timeline.current?.scrollTo({ top: timeline.current.scrollHeight });
  }, [detail?.messages]);
  function select(id: string) {
    setSelected(id);
    if (matchMedia('(max-width:760px)').matches) setSidebar(false);
  }
  useEffect(() => {
    try {
      persist(`agentdeck.api.drafts.${scope}`, drafts);
    } catch {
      setError(t('草稿无法保存到本地，请检查浏览器空间；请勿关闭页面'));
    }
  }, [scope, drafts]);
  useEffect(() => {
    try {
      persist(`agentdeck.api.choices.${scope}`, choices);
    } catch {
      setError(t('模型选择无法保存到本地，请检查浏览器空间'));
    }
  }, [scope, choices]);
  async function execute(confirmed = false) {
    if (
      sending.current ||
      !navigator.locks ||
      busy ||
      loading ||
      active ||
      !available ||
      !text.trim() ||
      (selected && !detail)
    )
      return;
    if (detail?.uncertain && !confirmed) {
      setConfirmSend(true);
      return;
    }
    if (new TextEncoder().encode(text).length > 12000) {
      setError(t('单条消息最多 12,000 字节，请缩短后发送'));
      return;
    }
    if (jobs.current.size >= 2) {
      setError(t('请先完成或停止正在生成的对话'));
      return;
    }
    const original = selected,
      id = selected || crypto.randomUUID(),
      content = text,
      selectedChoice = { ...choice };
    const provider = providers.find((value) => value.id === choice.providerId)!;
    const controller = new AbortController(),
      job = { controller, stopped: false };
    sending.current = true;
    pending.current = id;
    setBusy(true);
    setError('');
    setConfirmSend(false);
    const run = async () => {
      if (!mounted.current || controller.signal.aborted) return;
      jobs.current.set(id, job);
      let chat: ChatDetail | undefined,
        accepted = false,
        requestStarted = false;
      let flushTimer: ReturnType<typeof setTimeout> | undefined;
      let pendingWrite: Promise<void> = Promise.resolve();
      let storageFailure: unknown;
      const requestId = crypto.randomUUID(),
        timer = setTimeout(() => controller.abort(), 300000);
      try {
        const previous = original ? await readChat(original) : undefined;
        chat = {
          id,
          title: previous?.title || content.slice(0, 40),
          providerId: selectedChoice.providerId,
          model: selectedChoice.model,
          effort: selectedChoice.effort || '',
          updatedAt: new Date().toISOString(),
          messages: [...(previous?.messages || [])],
          uncertain: false,
        };
        const context = chat.messages
          .filter(
            (message) =>
              (message.status === 'complete' ||
                (message.role === 'assistant' && message.status === 'stopped')) &&
              !!message.content,
          )
          .map(({ role, content }) => ({ role, content }));
        if (new TextEncoder().encode(JSON.stringify(context)).length > 512 * 1024)
          throw new Error(t('对话过长，请新建对话'));
        const user = {
          id: crypto.randomUUID(),
          requestId,
          role: 'user' as const,
          content,
          status: 'running' as ChatDetail['messages'][number]['status'],
        };
        const assistant: ChatMessage = {
          id: crypto.randomUUID(),
          requestId,
          role: 'assistant' as const,
          content: '',
          status: 'running' as ChatDetail['messages'][number]['status'],
        };
        chat.messages.push(user, assistant);
        await saveChat(chat);
        if (mounted.current && selectedRef.current === original) {
          setDrafts((values) => ({ ...values, [id]: content }));
          setChoices((values) => ({ ...values, [id]: selectedChoice }));
          selectedRef.current = id;
          setSelected(id);
          setDetail(structuredClone(chat));
        }
        const latest = await store.read<Provider>('provider', provider.id);
        if (
          !latest ||
          latest.baseUrl !== provider.baseUrl ||
          !latest.models.includes(selectedChoice.model)
        )
          throw new Error(t('接口配置已变化，请刷新设置后重试'));
        if (
          selectedChoice.effort &&
          !latest.modelEfforts?.[selectedChoice.model]?.includes(selectedChoice.effort)
        )
          throw new Error(t('此模型不支持当前思考强度，请重新选择'));
        const key = await getKey(latest.keyId || latest.id, controller.signal);
        controller.signal.throwIfAborted();
        requestStarted = true;
        const response = await providerFetch(provider.baseUrl, '/chat/completions', key, {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify({
            model: selectedChoice.model,
            messages: [...context, { role: 'user', content }],
            stream: true,
            ...(selectedChoice.effort ? { reasoning_effort: selectedChoice.effort } : {}),
          }),
        });
        accepted = true;
        user.status = 'complete';
        if (mounted.current) {
          setDrafts((values) => {
            const next = { ...values };
            for (const key of [original || 'new', id]) if (next[key] === content) next[key] = '';
            return next;
          });
          if (pending.current === id) {
            pending.current = null;
            setBusy(false);
            sending.current = false;
          }
        }
        let displayed = 0;
        await streamCompletion(response, controller.signal, (value) => {
          assistant.content = value;
          const now = Date.now();
          if (now - displayed > 50) {
            publish(chat!);
            displayed = now;
          }
          if (!flushTimer)
            flushTimer = setTimeout(() => {
              flushTimer = undefined;
              const snapshot = structuredClone(chat!);
              pendingWrite = pendingWrite
                .then(() => saveChat(snapshot))
                .catch((error) => {
                  storageFailure = error;
                  controller.abort();
                });
            }, 600);
        });
        clearTimeout(flushTimer);
        await pendingWrite;
        if (storageFailure) throw storageFailure;
        assistant.status = job.stopped
          ? 'stopped'
          : controller.signal.aborted
            ? 'interrupted'
            : 'complete';
        if (controller.signal.aborted && !job.stopped) {
          chat.uncertain = true;
          assistant.error = t('生成已中断，已有内容已保留。');
        }
        await saveChat(chat);
      } catch (cause) {
        clearTimeout(flushTimer);
        await pendingWrite;
        if (cause instanceof DeletedChatError) return;
        if (chat?.messages.at(-1)?.requestId === requestId) {
          const user = chat.messages.at(-2)!,
            assistant = chat.messages.at(-1)!;
          const uncertain = requestStarted && !(cause instanceof ProviderHttpError) && !job.stopped;
          chat.uncertain = uncertain;
          user.status = accepted ? 'complete' : uncertain ? 'interrupted' : 'failed';
          assistant.status = job.stopped ? 'stopped' : uncertain ? 'interrupted' : 'failed';
          assistant.error = job.stopped
            ? undefined
            : controller.signal.aborted
              ? t('生成已中断，已有内容已保留。')
              : String(cause);
          try {
            await saveChat(chat);
          } catch (storageError) {
            if (storageError instanceof DeletedChatError) return;
            publish(chat);
            if (mounted.current) setError(String(storageError));
          }
        }
        if (mounted.current && !job.stopped)
          setError(controller.signal.aborted ? t('生成已中断，已有内容已保留。') : String(cause));
      } finally {
        clearTimeout(timer);
        clearTimeout(flushTimer);
        jobs.current.delete(id);
        if (mounted.current) {
          if (pending.current === id) {
            pending.current = null;
            sending.current = false;
            setBusy(false);
          }
        }
      }
    };
    try {
      if (navigator.locks)
        await navigator.locks.request(
          `agentchat:${scope}:${id}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) throw new Error(t('此对话正在其他标签页生成，请稍后再试'));
            await run();
          },
        );
    } catch (error) {
      if (mounted.current) {
        setError(String(error));
        if (pending.current === id) {
          pending.current = null;
          sending.current = false;
          setBusy(false);
        }
      }
    }
  }
  function send() {
    void execute();
  }
  function stop() {
    const job = jobs.current.get(selected);
    if (job) {
      job.stopped = true;
      job.controller.abort();
    } else channel.current?.postMessage({ type: 'stop', id: selected });
  }
  return (
    <div className={`shell api-chat ${sidebar ? 'with-sidebar' : ''}`}>
      <button
        className={`sidebar-scrim ${sidebar ? 'visible' : ''}`}
        aria-label={t('关闭侧栏')}
        onClick={() => setSidebar(false)}
      />
      <aside className={`sidebar ${sidebar ? 'open' : ''}`} inert={!sidebar} aria-hidden={!sidebar}>
        <SidebarResizer open={sidebar} onClose={() => setSidebar(false)} />
        <div className="sidebar-brand">
          <IconButton
            className="sidebar-mobile-settings"
            icon={Menu}
            label={t('设置')}
            onClick={() => setSettings(true)}
          />
          {modeControl}
          <IconButton icon={Menu} label={t('收起会话列表')} onClick={() => setSidebar(false)} />
          <IconButton
            className="sidebar-mobile-search"
            icon={Search}
            label={t('搜索对话')}
            onClick={() => document.getElementById('api-chat-search')?.focus()}
          />
        </div>
        <div className="sidebar-primary">
          <button disabled={busy} onClick={() => select('')}>
            <MessageSquarePlus size={19} />
            {t('新对话')}
          </button>
          <IconButton
            icon={Search}
            label={t('搜索对话')}
            onClick={() => document.getElementById('api-chat-search')?.focus()}
          />
        </div>
        <div className="api-search">
          <Search size={15} />
          <input
            id="api-chat-search"
            aria-label={t('搜索对话')}
            placeholder={t('搜索对话')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <MotionList as="nav" className="sidebar-scroll api-chat-list" label={t('AgentChat 记录')}>
          {chats
            .filter((chat) => chat.title.toLowerCase().includes(search.toLowerCase()))
            .map((chat) => (
              <div
                data-motion-item
                key={chat.id}
                className={`api-chat-row ${selected === chat.id ? 'active' : ''}`}
              >
                <button disabled={busy} onClick={() => select(chat.id)}>
                  {chat.title}
                </button>
                <IconButton
                  icon={Trash2}
                  label={t('删除对话 {{p0}}', { p0: chat.title })}
                  disabled={
                    busy ||
                    memory.current
                      .get(chat.id)
                      ?.messages.some((message) => message.status === 'running')
                  }
                  onClick={() => setDeleting(chat.id)}
                />
              </div>
            ))}
          {!chats.length && <p className="api-list-empty">{t('对话会保存在这里')}</p>}
        </MotionList>
        <div className="sidebar-footer">
          <button onClick={() => setSettings(true)}>
            <Settings size={18} />
            {t('设置')}
          </button>
        </div>
        <button className="sidebar-quick-compose" disabled={busy} onClick={() => select('')}>
          <Plus size={24} aria-hidden="true" />
          <span>{t('新对话')}</span>
          <SquarePen size={22} aria-hidden="true" />
        </button>
      </aside>
      <section ref={sidebarMotion} className="conversation-layout">
        <section className="conversation">
          <header className="topbar">
            <IconButton
              icon={matchMedia('(max-width:760px)').matches ? ChevronLeft : Menu}
              label={t('打开会话列表')}
              onClick={() => setSidebar(!sidebar)}
              className={sidebar ? 'rail-toggle' : ''}
            />
            {!sidebar && <span className="api-desktop-mode">{modeControl}</span>}
            <span className="api-top-title">
              {selected ? detail?.title || 'AgentChat' : t('新对话')}
            </span>
            <IconButton icon={Settings} label={t('设置')} onClick={() => setSettings(true)} />
            <IconButton icon={SquarePen} label={t('新建会话')} onClick={() => select('')} />
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
                <h1>{t('有什么想聊的？')}</h1>
                <p>
                  {providers.length ? t('选择模型，开始一段对话') : t('添加你的 API，随时开始对话')}
                </p>
                {!providers.length && (
                  <button onClick={() => setSettings(true)} disabled={loading}>
                    {t('打开设置')}
                  </button>
                )}
              </div>
            ) : (
              <div ref={contentMotion} className="api-messages">
                {loading && !detail && (
                  <p className="muted" role="status">
                    {t('正在读取对话…')}
                  </p>
                )}
                {detail?.messages.map((message) => (
                  <article key={message.id} className={`api-message api-message-${message.role}`}>
                    <div className="api-message-body">
                      <Markdown
                        text={
                          message.content ||
                          (message.status === 'running' ? t('正在思考…') : t('未收到回复'))
                        }
                      />
                    </div>
                    {message.role === 'assistant' && (
                      <div className="api-message-actions">
                        <IconButton
                          icon={Copy}
                          label={t('复制回复')}
                          disabled={!message.content}
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(message.content)
                              .catch(() => setError(t('复制失败，请手动选择文字')));
                          }}
                        />
                        {message.status === 'running' ? (
                          <span role="status">{t('生成中')}</span>
                        ) : message.status === 'stopped' ? (
                          <span>{t('已停止')}</span>
                        ) : null}
                      </div>
                    )}
                    {message.error && <p className="api-feedback">{errorText(message.error)}</p>}
                  </article>
                ))}
              </div>
            )}
          </div>
          <div className="api-composer-area">
            {!navigator.locks && (
              <p className="api-feedback" role="alert">
                {t('当前浏览器无法安全协调多标签页，请使用支持 Web Locks 的浏览器发送消息。')}
              </p>
            )}
            {error && (
              <div className="api-feedback" role="alert">
                {errorText(error)}
                <button
                  className="text-button"
                  onClick={() => {
                    void refresh().catch((error) => setError(String(error)));
                  }}
                >
                  {t('刷新会话')}
                </button>
              </div>
            )}
            {!available && !!providers.length && (
              <p className="api-feedback">{t('请选择可用模型，或重新配置此对话的 API。')}</p>
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
            busy={busy && !active}
            active={!!active}
            sendBlocked={
              loading || !navigator.locks || !enabled || !available || (!!selected && !detail)
            }
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
      <MotionPresence>
        {settings && (
          <ApiSettings
            scope={scope}
            providers={providers}
            enabled={enabled}
            onClose={() => setSettings(false)}
            onChanged={refresh}
          />
        )}
      </MotionPresence>
      <MotionPresence>
        {confirmSend && (
          <Modal compact title={t('上次请求结果未知')} onClose={() => setConfirmSend(false)}>
            <p>{t('直连请求无法查询发送回执。再次发送可能产生重复用量。')}</p>
            <div className="button-row">
              <button onClick={() => void execute(true)}>{t('仍然发送')}</button>
              <button onClick={() => setConfirmSend(false)}>{t('保留草稿')}</button>
            </div>
          </Modal>
        )}
      </MotionPresence>
      <MotionPresence>
        {deleting && (
          <Modal compact title={t('删除对话')} onClose={() => setDeleting('')}>
            <p>{t('删除此浏览器中的对话记录？')}</p>
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void store
                    .deleteChat(deleting)
                    .then(async () => {
                      forgetChat(deleting);
                      setDrafts((values) => {
                        const next = { ...values };
                        delete next[deleting];
                        return next;
                      });
                      setChoices((values) => {
                        const next = { ...values };
                        delete next[deleting];
                        return next;
                      });
                      if (selected === deleting) select('');
                      channel.current?.postMessage({ type: 'deleted', id: deleting });
                      setDeleting('');
                      await refresh();
                    })
                    .catch((error) => setError(String(error)))
                    .finally(() => setBusy(false));
                }}
              >
                {t('删除对话')}
              </button>
              <button onClick={() => setDeleting('')}>{t('取消')}</button>
            </div>
          </Modal>
        )}
      </MotionPresence>
    </div>
  );
}

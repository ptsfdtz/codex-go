import { errorText, t, useLocale } from '../../i18n';
import { Select } from '../../components/Select';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Timeline } from '../../Timeline';
import { RichContent, contentText } from '../../RichContent';
import { applyProgress, historyError, mergeHistorySnapshot } from '../../conversation';
import { historyKey, mergeHistory, type HistoryEntry } from '../../history';
import { readHistoryPage } from '../../history-page';
import type { Bridge } from '../../transport/bridge';
import { IconButton } from '../../ui';
import {
  chatProject,
  emptyDraft,
  type Approval,
  type Capabilities,
  type Draft,
  type Model,
  type Request,
  type Session,
  type Snapshot,
  type Turn,
} from '../../workspace';
import { Composer } from '../Composer';
import { ApprovalCard, AsyncQuestions } from '../Questions';
import { ActivityStages } from '../activity/ActivityStages';
import { resources, turnOptions } from '../composer-input';
import { resolveComposerModelPreferences } from '../composer-preferences';
import { QueuedMessages } from '../queue/QueuedMessages';

export function SideChat({
  request,
  connection,
  connected,
  snapshot,
  models,
  capabilities,
  initialProject,
  scope,
  blocked,
  onChanged,
  onFile,
  drafts,
  setDrafts,
}: {
  request: Request;
  connection?: Bridge;
  connected: boolean;
  snapshot: Snapshot;
  models: Model[];
  capabilities: Capabilities;
  initialProject: string;
  scope: string;
  drafts: Record<string, Draft>;
  setDrafts: Dispatch<SetStateAction<Record<string, Draft>>>;
  blocked: boolean;
  onChanged: () => void;
  onFile: (projectId: string, path: string) => void;
}) {
  useLocale();
  const [project, setProject] = useState(initialProject);
  const [sessionId, setSessionId] = useState('');
  const [permission, setPermission] = useState('workspace');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const history = useRef(entries);
  history.current = entries;
  const [cursor, setCursor] = useState<string>();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [queueRevision, setQueueRevision] = useState(0);
  const activityVersion = useRef(0);
  const [localTurn, setLocalTurn] = useState<string>();
  const generation = useRef(0),
    pending = useRef(false),
    creating = useRef('');
  const loadMorePending = useRef(false);
  const identity = useRef(sessionId);
  identity.current = sessionId;
  const liveConnection = useRef(connection);
  liveConnection.current = connection;
  const cache = useRef(new Map<string, HistoryEntry>());
  const keyFor = (id: string) => JSON.stringify([scope, 'side', id]);
  const draftKey = keyFor(sessionId || `new:${project}`);
  const current = snapshot.sessions?.find((item) => item.sessionId === sessionId);
  const draft = drafts[draftKey] || {
    ...emptyDraft(),
    model: current?.model || '',
    effort: current?.effort || '',
  };
  const actualProject = current?.projectId || project;
  const chat = actualProject === chatProject;
  const supports = (key: string) => capabilities.features?.[key] === true;
  const active = snapshot.turns?.find(
    (turn) =>
      turn.sessionId === sessionId &&
      ['queued', 'running', 'waitingApproval'].includes(turn.status || ''),
  );
  const activeTurn = active?.turnId || localTurn;
  const uncertain = () => connection?.awaitingReceipt === true;
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  const disabled =
    !connected ||
    blocked ||
    busy ||
    (sessionId !== '' && !ready) ||
    current?.archived === 1 ||
    draft.outcomeUnknown === true;
  function updateDraft(change: Partial<Draft>) {
    setDrafts((items) => ({
      ...items,
      [draftKey]: { ...(items[draftKey] || draft), ...change },
    }));
  }
  function select(id: string, projectId = project) {
    generation.current++;
    activityVersion.current++;
    identity.current = id;
    setSessionId(id);
    setProject(projectId);
    setEntries([]);
    history.current = [];
    setCursor(undefined);
    setReady(false);
    setLocalTurn(undefined);
    setError('');
  }
  useEffect(() => {
    if (
      !sessionId &&
      initialProject &&
      (!project || !snapshot.projects?.some((p) => p.projectId === project))
    )
      setProject(initialProject);
  }, [project, initialProject, sessionId, snapshot.projects]);
  useEffect(() => {
    if (!connected || !sessionId || !capabilities.features?.externalThreadObservation) return;
    let live = true;
    void request('sessions.observe', { sessionId }).catch((e) => {
      if (live) setError(String(e));
    });
    return () => {
      live = false;
    };
  }, [connected, sessionId, capabilities.features?.externalThreadObservation, request]);
  useEffect(() => {
    if (
      !connected ||
      !sessionId ||
      !capabilities.features?.latestUpstreamTurn ||
      creating.current === sessionId
    )
      return;
    let live = true;
    const version = activityVersion.current;
    void request<{ turn?: { upstreamTurnId?: string; status?: string } }>('turn.latest', {
      sessionId,
      contractVersion: 1,
    })
      .then((value) => {
        if (live && version === activityVersion.current)
          setLocalTurn(value.turn?.status === 'inProgress' ? value.turn.upstreamTurnId : undefined);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [connected, sessionId, revision, capabilities.features?.latestUpstreamTurn, request]);
  useEffect(() => {
    if (!connected || !connection || !sessionId) {
      setReady(!sessionId);
      return;
    }
    if (creating.current === sessionId) {
      setReady(true);
      return;
    }
    const epoch = ++generation.current;
    let live = true,
      loadingPage = true;
    let bufferedBytes = 0,
      overflow = false;
    const buffered: Parameters<typeof applyProgress>[1][] = [];
    const refresh = () => {
      if (live) setRevision((value) => value + 1);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = connection.onEvent((packet) => {
      if (packet.type === 'closed') {
        setReady(false);
        return;
      }
      if (
        packet.action === 'sessions.synced' &&
        Array.isArray(packet.payload?.contentSessionIds) &&
        packet.payload.contentSessionIds.includes(sessionId)
      ) {
        if (!timer) timer = setTimeout(refresh, 250);
      }
      if (packet.sessionId !== sessionId) return;
      if (packet.action === 'queue.changed') setQueueRevision((value) => value + 1);
      if (packet.action === 'session.historyChanged') {
        generation.current++;
        setEntries([]);
        history.current = [];
        setCursor(undefined);
        setReady(false);
        if (!timer) timer = setTimeout(refresh, 250);
      }
      if (['turn.progress', 'upstream.progress'].includes(packet.action || '')) {
        if (loadingPage) {
          // A bounded buffer preserves item completions while loading history.
          bufferedBytes += JSON.stringify(packet).length;
          if (buffered.length < 500 && bufferedBytes <= 2 * 1024 * 1024) buffered.push(packet);
          else {
            overflow = true;
            setReady(false);
            if (!timer) timer = setTimeout(refresh, 250);
          }
        } else setEntries((items) => applyProgress(items, packet));
        if (packet.payload?.method === 'turn/started') {
          activityVersion.current++;
          setLocalTurn(packet.turnId || String(packet.payload.upstreamTurnId || ''));
        }
      }
      if (
        /^(?:turn\.(?:completed|failed|interrupted)|upstream\.turn\.completed)$/.test(
          packet.action || '',
        )
      ) {
        activityVersion.current++;
        setLocalTurn(undefined);
        if (!timer) timer = setTimeout(refresh, 250);
      }
      if (packet.action === 'session.contentChanged') {
        if (!timer) timer = setTimeout(refresh, 250);
      }
      if (packet.action === 'session.deleted') select('', actualProject);
    });
    const before = history.current;
    setLoading(true);
    void readHistoryPage(connection, sessionId, undefined, cache.current)
      .then((page) => {
        if (!live || epoch !== generation.current) return;
        const incoming = [...page.data].reverse();
        const baseline = new Set(incoming.map(historyKey));
        setEntries((items) => {
          let next = mergeHistorySnapshot(items, incoming, before);
          for (const packet of buffered) {
            const p = packet.payload || {};
            const turnId = p.upstreamTurnId || p.turnId;
            const itemId = p.itemId || (p.item as { id?: string })?.id;
            const key =
              typeof turnId === 'string' && typeof itemId === 'string'
                ? historyKey({ turnId, item: { id: itemId } })
                : '';
            if (
              baseline.has(key) &&
              (String(p.method).endsWith('Delta') ||
                String(p.method).endsWith('/delta') ||
                p.method === 'item/started')
            )
              continue;
            next = applyProgress(next, packet);
          }
          return next;
        });
        if (!before.length) setCursor(page.nextCursor);
        loadingPage = false;
        setReady(!overflow);
        setError('');
      })
      .catch((e) => {
        if (live) {
          loadingPage = false;
          setReady(false);
          setError(historyError(e));
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    const wake = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      live = false;
      unsubscribe();
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [connection, connected, sessionId, revision]);
  async function older() {
    if (!connection || !cursor || loading || loadMorePending.current) return;
    const epoch = generation.current;
    const id = sessionId;
    loadMorePending.current = true;
    setLoading(true);
    try {
      const page = await readHistoryPage(connection, id, cursor, cache.current);
      if (epoch !== generation.current || id !== identity.current) return;
      setEntries((items) => mergeHistory(items, [...page.data].reverse(), 'older'));
      setCursor(page.nextCursor);
    } catch (e) {
      if (epoch === generation.current) setError(historyError(e));
    } finally {
      loadMorePending.current = false;
      if (epoch === generation.current) setLoading(false);
    }
  }
  async function send(kind?: 'queue' | 'steer') {
    if (pending.current || disabled || !actualProject || !connection || uncertain()) return;
    let source = draft;
    if (!source.text.trim() && !source.attachments.length && !source.references?.length) return;
    const transport = connection;
    const sourceKey = draftKey;
    let target = sessionId,
      targetKey = sourceKey;
    let submitted = false;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      source = { ...draft, ...resolveComposerModelPreferences(draft, models) };
      if (!target) {
        submitted = true;
        const created = await request<{ session: Session }>('sessions.create', {
          projectId: actualProject,
          title: source.text.trim().slice(0, 80) || t('新对话'),
        });
        if (transport !== liveConnection.current) return;
        target = created.session.sessionId;
        targetKey = keyFor(target);
        creating.current = target;
        select(target, actualProject);
        setDrafts((items) => ({ ...items, [targetKey]: source }));
        setReady(true);
      }
      submitted = true;
      if (activeTurn) {
        if (kind === 'steer') {
          if (source.attachments.length || source.references?.length)
            throw new Error(t('带资源的消息请加入待发送队列'));
          const active = await request<{ upstreamTurnId?: string }>('turn.active', {
            sessionId: target,
          });
          if (!active.upstreamTurnId) throw new Error(t('任务状态已变化，请刷新核对'));
          await request('turn.steer', {
            sessionId: target,
            expectedTurnId: active.upstreamTurnId,
            text: source.text.trim(),
          });
        } else {
          if (!supports('nativeQueue')) throw new Error(t('当前电脑不支持队列，请等待任务完成'));
          await request('queue.add', {
            sessionId: target,
            text: source.text.trim(),
            ...resources(source),
          });
        }
      } else {
        const result = await request<{ turn?: Turn }>('turn.start', {
          sessionId: target,
          ...turnOptions(chat ? { ...source, mode: 'default', skills: [] } : source, permission),
        });
        if (transport === liveConnection.current && identity.current === target) {
          activityVersion.current++;
          setLocalTurn(result.turn?.turnId);
        }
      }
      if (transport !== liveConnection.current) return;
      setDrafts((items) => {
        const next = { ...items };
        for (const key of new Set([sourceKey, targetKey])) {
          const saved = next[key];
          if (saved && saved.text === source.text && saved.attachments === source.attachments)
            next[key] = { ...saved, text: '', attachments: [], references: [], skills: [] };
        }
        return next;
      });
    } catch (e) {
      if (submitted && (transport.awaitingReceipt || transport !== liveConnection.current)) {
        setDrafts((items) => {
          const next = { ...items };
          for (const key of new Set([sourceKey, targetKey]))
            next[key] = { ...(next[key] || source), outcomeUnknown: true };
          return next;
        });
      }
      if (transport === liveConnection.current) setError(String(e));
    } finally {
      creating.current = '';
      pending.current = false;
      setBusy(false);
      if (transport === liveConnection.current) {
        setRevision((value) => value + 1);
        changedRef.current();
      }
    }
  }
  async function decide(
    a: Approval,
    decision: string,
    answers?: Record<string, { answers: string[] }>,
  ) {
    await request('approvals.decide', {
      sessionId: a.sessionId,
      turnId: a.turnId,
      approvalId: a.approvalId,
      decision,
      ...(answers ? { answers } : {}),
    });
    changedRef.current();
  }
  const sessionChoices = useMemo(
    () =>
      (snapshot.sessions || []).filter(
        (item) => item.projectId === actualProject && item.archived !== 1,
      ),
    [snapshot.sessions, actualProject],
  );
  return (
    <section className="side-chat conversation" aria-label={t('侧边对话')}>
      <header className="side-chat-header">
        <Select
          aria-label={t('侧边对话项目')}
          value={actualProject}
          disabled={busy}
          onValueChange={(value) => select('', value)}
        >
          <option value="" disabled>
            {t('选择项目')}
          </option>
          {(snapshot.projects || []).map((p) => (
            <option key={p.projectId} value={p.projectId}>
              {p.projectId === chatProject ? t('普通聊天') : p.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('侧边会话')}
          value={sessionId}
          disabled={busy}
          onValueChange={(value) => select(value, actualProject)}
        >
          <option value="">{t('新对话')}</option>
          {sessionChoices.map((item) => (
            <option key={item.sessionId} value={item.sessionId}>
              {item.title || t('未命名会话')}
            </option>
          ))}
        </Select>
        <IconButton
          icon={Plus}
          label={t('新建侧边对话')}
          disabled={busy}
          onClick={() => select('', actualProject)}
        />
        <IconButton
          icon={RefreshCw}
          label={t('刷新侧边对话')}
          disabled={!connected || loading || busy}
          onClick={() => {
            setRevision((value) => value + 1);
            changedRef.current();
          }}
        />
      </header>
      {error && (
        <p className="error side-chat-feedback" role="alert">
          {errorText(error)}
        </p>
      )}
      {draft.outcomeUnknown && (
        <div className="side-chat-feedback" role="alert">
          <p>{t('上一条发送结果曾不确定，请先核对会话中的实际结果。草稿已保留，不会自动重发。')}</p>
          <button
            disabled={!connected || blocked}
            onClick={() => updateDraft({ outcomeUnknown: false })}
          >
            {t('已核对，继续编辑草稿')}
          </button>
        </div>
      )}
      {!connected && (
        <p className="side-chat-feedback" role="status">
          {t('电脑连接已断开；草稿已保留，恢复后先核对发送结果。')}
        </p>
      )}
      <Timeline
        identity={sessionId || draftKey}
        revision={entries.length + revision}
        animateNewItems={ready}
        hasOlder={!!cursor && ready}
        loadingOlder={loading}
        onOlder={() => void older()}
      >
        <div className="timeline-content">
          {cursor && (
            <button
              className="text-button history-more"
              disabled={loading}
              onClick={() => void older()}
            >
              {t('加载更早记录')}
            </button>
          )}
          {!sessionId && (
            <div className="side-chat-empty">
              <h3>{t('侧边对话')}</h3>
              <p>{t('选择已有会话，或发送消息开始新的对话。')}</p>
            </div>
          )}
          {loading && !entries.length && <p role="status">{t('正在读取会话…')}</p>}
          <ActivityStages entries={entries} activeTurn={active?.upstreamTurnId || activeTurn}>
            {(entry) => {
              const user = entry.item?.type === 'userMessage' || entry.item?.role === 'user';
              const assistant = ['agentMessage', 'assistantMessage'].includes(
                String(entry.item?.type),
              );
              if (entry.item?.type === 'reasoning' && !contentText(entry.item)) return null;
              return (
                <article
                  className={`turn ${user ? 'user-turn' : assistant ? 'assistant-turn' : 'activity-turn'}`}
                  key={historyKey(entry)}
                  data-history-key={historyKey(entry)}
                >
                  <div className="message-content">
                    <RichContent
                      entry={entry}
                      connection={connection}
                      sessionId={sessionId}
                      sessionImages={connected && supports('sessionMessageImages')}
                      images={
                        connected && !chat && supports('projectImagePreview')
                          ? {
                              request,
                              projectId: actualProject,
                              root:
                                snapshot.projects?.find((p) => p.projectId === actualProject)
                                  ?.canonicalPath || '',
                            }
                          : undefined
                      }
                      onFile={
                        supports('projectTextPreview')
                          ? (path) => onFile(actualProject, path)
                          : undefined
                      }
                    />
                  </div>
                </article>
              );
            }}
          </ActivityStages>
        </div>
      </Timeline>
      <Composer
        key={draftKey}
        draft={draft}
        onChange={updateDraft}
        models={models}
        supports={(key) =>
          !['composerSkills', 'projectFileBrowser', 'goal'].includes(key) &&
          (!chat || key !== 'plan') &&
          supports(key)
        }
        chat={chat}
        disabled={disabled || !actualProject}
        busy={busy}
        active={!!activeTurn}
        permission={permission}
        onPermission={setPermission}
        attachmentTotalBytes={capabilities.limits?.attachmentTotalBytes}
        feedback={blocked ? t('发送结果尚未确认，请先核对任务状态。') : undefined}
        onSend={(kind) => void send(kind)}
        onNew={() => select('', actualProject)}
        panels={[]}
        onPanel={() => undefined}
        onStop={() => {
          if (!sessionId || disabled || !activeTurn) return;
          void request<{ upstreamTurnId?: string }>('turn.active', { sessionId })
            .then((active) => {
              if (!active.upstreamTurnId) throw new Error(t('任务状态已变化，请刷新核对'));
              return request('turn.interruptActive', {
                sessionId,
                expectedTurnId: active.upstreamTurnId,
              });
            })
            .then(() => changedRef.current())
            .catch((e) => setError(String(e)));
        }}
        prompts={
          <>
            {(snapshot.approvals || [])
              .filter((a) => a.sessionId === sessionId)
              .map((a) => (
                <ApprovalCard
                  key={a.approvalId}
                  approval={a}
                  disabled={!connected || blocked}
                  uncertain={uncertain}
                  onRefresh={onChanged}
                  onDecide={decide}
                />
              ))}
            {entries
              .filter(
                (entry) => Array.isArray(entry.item?.questions) && entry.item.questions.length > 0,
              )
              .map((entry) => (
                <AsyncQuestions
                  key={historyKey(entry)}
                  entry={entry}
                  history={entries}
                  request={request}
                  receiptKey={`agentdeck.web.question.${JSON.parse(scope).join('.')}.${sessionId}.${entry.item?.id}`}
                  disabled={disabled || !supports('activeTurnSteering')}
                  options={{
                    sessionId,
                    permissionMode: permission,
                    mode: draft.mode,
                    ...(draft.model ? { model: draft.model } : {}),
                    ...(draft.effort ? { effort: draft.effort } : {}),
                  }}
                  uncertain={uncertain}
                  onRefresh={onChanged}
                />
              ))}
          </>
        }
        queued={
          sessionId && supports('nativeQueue') ? (
            <QueuedMessages
              request={request}
              sessionId={sessionId}
              revision={revision + queueRevision}
              enabled={connected}
              disabled={disabled}
              active={!!activeTurn}
              canStart={supports('nativeQueueStart')}
              canSteer={supports('nativeQueueSteer')}
              uncertain={uncertain}
              onChanged={onChanged}
            />
          ) : undefined
        }
      />
    </section>
  );
}

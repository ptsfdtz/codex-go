import { errorText, t, useLocale } from '../i18n';
import { useEffect, useState, useRef } from 'react';
import {
  Folder,
  ArrowUp,
  ArrowDown,
  Play,
  Trash2,
  RefreshCw,
  Pin,
  Archive,
  GitFork,
  Minimize2,
  Save,
  Pencil,
  PinOff,
  ArchiveRestore,
} from 'lucide-react';
import { DataFields, IconButton } from '../ui';
import { MotionList, MotionPresence } from '../motion';
import type { Capabilities, Project, Request, Session, Skill } from '../workspace';
import { canManage, statusLabel } from '../workspace';
import { contentText } from '../content-text';

function useRead<T>(
  request: Request,
  action: string,
  payload: Record<string, unknown>,
  enabled = true,
) {
  const [value, setValue] = useState<T>(),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false);
  const key = JSON.stringify(payload);
  useEffect(() => {
    if (!enabled) {
      setValue(undefined);
      setLoading(false);
      setError('');
      return;
    }
    let current = true;
    setLoading(true);
    setError('');
    setValue(undefined);
    void request<T>(action, JSON.parse(key))
      .then((v) => {
        if (current) setValue(v);
      })
      .catch((e) => {
        if (current) setError(String(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [request, action, key, revision, enabled]);
  return { value, error, loading, reload: () => setRevision((n) => n + 1) };
}
function LoadState({
  error,
  loading,
  reload,
}: {
  error: string;
  loading: boolean;
  reload: () => void;
}) {
  useLocale();
  return (
    <>
      {loading && (
        <p className="muted" role="status">
          {t('读取中…')}
        </p>
      )}
      {error && (
        <div className="error" role="alert">
          {errorText(error)}
          <button className="text-button" onClick={reload}>
            {t('重试读取')}
          </button>
        </div>
      )}
    </>
  );
}
function useAction() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return {
    busy,
    run,
    feedback: (
      <MotionPresence>
        {error && (
          <div className="action-feedback" aria-live="polite">
            <p className="error" role="alert">
              {errorText(error)}
            </p>
          </div>
        )}
      </MotionPresence>
    ),
  };
}
export function SessionPanel({
  request,
  session,
  capabilities,
  onChanged,
  onSelect,
}: {
  request: Request;
  session: Session;
  capabilities: Capabilities;
  onChanged: () => void;
  onSelect: (id: string) => void;
}) {
  useLocale();
  const { value, error, loading, reload } = useRead<{
    session: Session;
    turns: unknown[];
    events: unknown[];
  }>(request, 'sessions.detail', { sessionId: session.sessionId, limit: 100 });
  const [title, setTitle] = useState(session.title || ''),
    [confirmation, setConfirmation] = useState('');
  const action = useAction();
  const supports = (key: string) => capabilities.features?.[key] === true;
  const safe = canManage(session) && (!value || canManage(value.session));
  const savedTitle = session.title || '';
  const canRename = !action.busy && safe && !!title.trim() && title.trim() !== savedTitle;
  const mutate = async (name: string, payload: Record<string, unknown> = {}) => {
    return action.run(async () => {
      const result = await request<{ session?: Session }>(name, {
        sessionId: session.sessionId,
        ...payload,
      });
      onChanged();
      reload();
      if (result.session && name === 'sessions.fork') onSelect(result.session.sessionId);
    });
  };
  return (
    <div className="panel-stack session-management">
      <form
        className="session-name"
        onSubmit={(event) => {
          event.preventDefault();
          if (canRename) void mutate('sessions.rename', { title: title.trim() });
        }}
      >
        <input
          aria-label={t('对话名称')}
          value={title}
          disabled={action.busy || !safe}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && title !== savedTitle) {
              event.preventDefault();
              event.stopPropagation();
              setTitle(savedTitle);
            }
          }}
        />
        <button
          className="icon-button"
          type="submit"
          aria-label={t('保存名称')}
          title={t('保存名称')}
          disabled={!canRename}
        >
          <Save size={18} aria-hidden="true" />
        </button>
      </form>
      <div className="compact-actions session-actions" aria-label={t('会话操作')}>
        <IconButton
          icon={session.pinned === 1 ? PinOff : Pin}
          label={session.pinned === 1 ? t('取消置顶') : t('置顶会话')}
          pressed={session.pinned === 1}
          disabled={action.busy || !safe}
          onClick={() => void mutate('sessions.pin', { pinned: session.pinned !== 1 })}
        />
        {supports('sessionFork') && (
          <IconButton
            icon={GitFork}
            label={t('分叉会话')}
            disabled={action.busy || !safe}
            onClick={() => void mutate('sessions.fork')}
          />
        )}
        {supports('sessionCompaction') && (
          <IconButton
            icon={Minimize2}
            label={t('整理上下文')}
            disabled={action.busy || !safe}
            onClick={() => setConfirmation('compact')}
          />
        )}
        <IconButton
          icon={session.archived === 1 ? ArchiveRestore : Archive}
          label={session.archived === 1 ? t('恢复会话') : t('归档会话')}
          disabled={action.busy || !safe}
          onClick={() => setConfirmation(session.archived === 1 ? 'restore' : 'archive')}
        />
        <IconButton
          icon={Trash2}
          label={t('永久删除会话')}
          className="danger"
          disabled={action.busy || !safe}
          onClick={() => setConfirmation('delete')}
        />
      </div>
      <MotionPresence>
        {confirmation && (
          <div className="confirmation">
            <p>
              {confirmation === 'delete'
                ? t('永久删除此会话？此操作无法撤销。')
                : confirmation === 'compact'
                  ? t('整理此会话的上下文？电脑会重新核对最新轮次。')
                  : confirmation === 'archive'
                    ? t('归档此会话？稍后可从归档列表恢复。')
                    : t('恢复此归档会话？')}
            </p>
            <div className="button-row">
              <button
                className={confirmation === 'delete' ? 'danger' : ''}
                disabled={action.busy}
                onClick={async () => {
                  let completed;
                  if (confirmation === 'compact') {
                    completed = await action.run(async () => {
                      const latest = await request<{
                        turn?: { upstreamTurnId?: string };
                        threadStatus?: string;
                      }>('turn.latest', { sessionId: session.sessionId, contractVersion: 1 });
                      if (!latest.turn?.upstreamTurnId || latest.threadStatus !== 'idle')
                        throw new Error(t('请先停止或核对当前任务'));
                      await request('sessions.compact', {
                        sessionId: session.sessionId,
                        expectedLastTurnId: latest.turn.upstreamTurnId,
                      });
                      onChanged();
                    });
                  } else completed = await mutate(`sessions.${confirmation}`);
                  if (completed) setConfirmation('');
                }}
              >
                {action.busy
                  ? t('处理中…')
                  : confirmation === 'delete'
                    ? t('永久删除')
                    : confirmation === 'compact'
                      ? t('整理上下文')
                      : confirmation === 'archive'
                        ? t('归档')
                        : t('恢复')}
              </button>
              <button disabled={action.busy} onClick={() => setConfirmation('')}>
                {t('取消')}
              </button>
            </div>
          </div>
        )}
      </MotionPresence>
      {!safe && <p className="muted">{t('请先停止或核对正在进行的任务，再管理会话。')}</p>}
      {action.feedback}
      <LoadState {...{ error, loading, reload }} />
    </div>
  );
}

type Goal = {
  objective: string;
  status: string;
  tokenBudget?: number;
  tokensUsed?: number;
  [key: string]: unknown;
};
type GoalActivity = { threadStatus: string; turn: { status?: string } | null };
function goalActivityMessage(activity: GoalActivity) {
  if (activity.threadStatus === 'active' || activity.turn?.status === 'inProgress')
    return t('当前会话仍有任务在执行。请先停止任务，再刷新状态。');
  if (
    !['idle', 'notLoaded'].includes(activity.threadStatus) ||
    (activity.turn && !['completed', 'interrupted', 'failed'].includes(activity.turn.status || ''))
  )
    return t('暂时无法确认会话已停止，请刷新状态后重试。');
  return '';
}
export function GoalPanel({
  request,
  sessionId,
  supports,
  onChanged,
}: {
  request: Request;
  sessionId: string;
  supports: (s: string) => boolean;
  onChanged: () => void;
}) {
  useLocale();
  const { value, error, loading, reload } = useRead<{
    goal: Goal | null;
    goalRevision: string | null;
  }>(request, 'sessions.goal', { sessionId });
  const activitySupported = supports('latestUpstreamTurn');
  const activity = useRead<GoalActivity>(
    request,
    'turn.latest',
    { sessionId, contractVersion: 1 },
    activitySupported,
  );
  const [editing, setEditing] = useState(false),
    [objective, setObjective] = useState(''),
    [budget, setBudget] = useState(''),
    [clear, setClear] = useState(false);
  const action = useAction(),
    goal = value?.goal;
  const activityMessage = activitySupported
    ? activity.error
      ? t('未能核对会话状态，请刷新状态后重试。')
      : activity.value
        ? goalActivityMessage(activity.value)
        : t('正在核对会话状态…')
    : '';
  const disabled = action.busy || loading || !!error || !!activityMessage;
  function reloadState() {
    reload();
    activity.reload();
  }
  async function mutate(kind: string) {
    const ok = await action.run(async () => {
      if (!value?.goalRevision) throw new Error(t('请先读取当前目标'));
      try {
        if (activitySupported) {
          const latest = await request<GoalActivity>('turn.latest', {
            sessionId,
            contractVersion: 1,
          });
          const message = goalActivityMessage(latest);
          if (message) throw new Error(message);
        }
        await request(`sessions.goal.${kind}`, {
          sessionId,
          expectedGoalRevision: value.goalRevision,
          ...(kind === 'edit'
            ? { objective: objective.trim(), ...(budget ? { tokenBudget: Number(budget) } : {}) }
            : {}),
        });
      } catch (error) {
        reloadState();
        const message = String(error);
        if (message.includes('OUTCOME_UNKNOWN'))
          throw new Error(t('操作结果尚未确认，请先核对操作结果，不要重复提交。'));
        if (message.includes('SYNC_CONFLICT'))
          throw new Error(t('目标或任务状态已变化，请核对刷新后的状态再操作。'));
        if (
          message.includes('Stop or reconcile') ||
          message.includes('active or unreconciled') ||
          message.includes('Pause an existing goal')
        )
          throw new Error(
            t(
              '电脑端尚未确认会话可修改。请先核对任务是否停止，再刷新状态；若已停止仍报错，需要更新电脑端。',
            ),
          );
        throw error;
      }
      onChanged();
      reloadState();
    });
    if (ok) {
      setEditing(false);
      setClear(false);
    }
  }
  return (
    <div className="panel-stack">
      <LoadState error={error} loading={loading} reload={reloadState} />
      {value && !goal && (
        <p className="muted">{t('此会话没有目标。选择输入框中的 Goal 模式并发送任务来创建。')}</p>
      )}
      {goal && (
        <>
          <div className="goal-status">{statusLabel(goal.status)}</div>
          <p className="goal-objective">{goal.objective}</p>
          {activityMessage && (
            <p className="muted" role="status">
              {activityMessage}
            </p>
          )}
          <button
            className="text-button"
            disabled={action.busy || activity.loading || loading}
            onClick={reloadState}
          >
            {t('刷新状态')}
          </button>
          <DataFields
            value={Object.fromEntries(
              Object.entries(goal).filter(
                ([key]) => !['objective', 'threadId', 'id', 'status'].includes(key),
              ),
            )}
          />
          {goal.status !== 'active' && (
            <div className="button-row">
              {supports('sessionGoalResume') && ['paused', 'blocked'].includes(goal.status) && (
                <button disabled={disabled} onClick={() => void mutate('resume')}>
                  <Play size={16} />
                  {t('继续目标')}
                </button>
              )}
              {supports('sessionGoalEdit') && (
                <button
                  disabled={disabled}
                  onClick={() => {
                    setObjective(goal.objective);
                    setBudget(goal.tokenBudget ? String(goal.tokenBudget) : '');
                    setEditing(true);
                  }}
                >
                  {t('编辑')}
                </button>
              )}
              {supports('sessionGoalClear') && (
                <button disabled={disabled} onClick={() => setClear(true)}>
                  {t('清除目标')}
                </button>
              )}
            </div>
          )}
          {editing && (
            <form
              className="panel-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void mutate('edit');
              }}
            >
              <label>
                {t('目标')}
                <textarea
                  rows={6}
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                />
              </label>
              <label>
                {t('Token 预算')}
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder={t('不设新预算')}
                />
              </label>
              <button disabled={disabled || !objective.trim()}>{t('保存目标')}</button>
            </form>
          )}
          {clear && (
            <div className="confirmation">
              <p>{t('清除现有目标？')}</p>
              <button disabled={disabled} onClick={() => void mutate('clear')}>
                {t('确认清除')}
              </button>
              <button onClick={() => setClear(false)}>{t('取消')}</button>
            </div>
          )}
        </>
      )}
      {action.feedback}
    </div>
  );
}

export function SkillsPanel({
  request,
  projectId,
  selected,
  onSelect,
  configure,
}: {
  request: Request;
  projectId: string;
  selected: Skill[];
  onSelect: (skills: Skill[]) => void;
  configure: boolean;
}) {
  useLocale();
  const { value, error, loading, reload } = useRead<{ skills: Skill[]; errorCount?: number }>(
    request,
    'skills.catalog',
    { projectId },
  );
  const [query, setQuery] = useState('');
  const action = useAction();
  return (
    <div className="panel-stack">
      <input
        aria-label={t('搜索技能')}
        placeholder={t('搜索技能')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="skills-summary">
        <strong>{t('技能')}</strong>
        <span>
          {selected.length} {t(' / 8 已选择')}
        </span>
        {selected.length > 0 && (
          <button className="text-button" onClick={() => onSelect([])}>
            {t('清空')}
          </button>
        )}
      </div>
      <LoadState {...{ error, loading, reload }} />
      {value?.skills
        .filter((s) =>
          `${s.name} ${s.description} ${s.displayName}`.toLowerCase().includes(query.toLowerCase()),
        )
        .map((s) => (
          <div className="skill-row" key={s.id}>
            <div className="skill-info">
              <strong>{s.displayName || s.name}</strong>
            </div>
            <button
              className={`skill-select ${selected.some((v) => v.id === s.id) ? 'selected' : ''}`}
              aria-label={t('{{p0}}技能 {{p1}}', {
                p0: selected.some((v) => v.id === s.id) ? t('移除') : t('添加'),
                p1: s.name,
              })}
              disabled={
                !s.enabled || (!selected.some((v) => v.id === s.id) && selected.length >= 8)
              }
              onClick={() =>
                onSelect(
                  selected.some((v) => v.id === s.id)
                    ? selected.filter((v) => v.id !== s.id)
                    : [...selected, s],
                )
              }
            >
              {selected.some((v) => v.id === s.id) ? t('已添加') : t('添加')}
            </button>
            {configure && (
              <label className="switch">
                <input
                  type="checkbox"
                  aria-label={t('启用技能 {{p0}}', { p0: s.name })}
                  checked={s.enabled}
                  disabled={action.busy}
                  onChange={(e) =>
                    void action.run(async () => {
                      await request('skills.setEnabled', {
                        projectId,
                        skillId: s.id,
                        enabled: e.target.checked,
                        expectedEnabled: s.enabled,
                      });
                      reload();
                    })
                  }
                />
              </label>
            )}
          </div>
        ))}
      {value?.errorCount ? (
        <p className="muted">{t('skills.unreadable', { count: value.errorCount })}</p>
      ) : null}
      {action.feedback}
    </div>
  );
}

type QueueEntry = {
  id: string;
  input: unknown[];
  inputRevision?: string;
  status?: string;
  deliveryState?: string;
};
export function QueuePanel({
  request,
  sessionId,
  supports,
  onChanged,
}: {
  request: Request;
  sessionId: string;
  supports: (s: string) => boolean;
  onChanged: () => void;
}) {
  useLocale();
  const { value, error, loading, reload } = useRead<{ data: QueueEntry[] }>(request, 'queue.list', {
    sessionId,
  });
  const [editing, setEditing] = useState<QueueEntry>(),
    [text, setText] = useState(''),
    [deleting, setDeleting] = useState('');
  const action = useAction();
  const mutate = async (name: string, payload: Record<string, unknown>) => {
    const ok = await action.run(async () => {
      await request(`queue.${name}`, { sessionId, ...payload });
      reload();
      onChanged();
    });
    if (ok) {
      setEditing(undefined);
      setDeleting('');
    }
  };
  return (
    <div className="panel-stack">
      <div className="button-row">
        <p className="muted">{t('消息由电脑保存，网页不会在重连时自动重发。')}</p>
        <IconButton icon={RefreshCw} label={t('刷新队列')} onClick={reload} />
      </div>
      <LoadState {...{ error, loading, reload }} />
      <MotionList className="panel-stack">
        {value?.data.map((entry, index) => (
          <div className="queue-entry" data-motion-item key={entry.id}>
            <p>{contentText(entry.input)}</p>
            {entry.input.some(
              (p) => !!p && typeof p === 'object' && (p as { type?: string }).type !== 'text',
            ) && <p className="muted">{t('包含附件或技能；编辑时保留原资源。')}</p>}
            <div className="queue-toolbar">
              <small>{statusLabel(entry.status)}</small>
              <div className="compact-actions">
                <IconButton
                  icon={Pencil}
                  label={t('编辑队列消息')}
                  disabled={
                    action.busy ||
                    !!entry.deliveryState ||
                    (!supports('nativeQueueResourceEdit') &&
                      entry.input.some(
                        (p) =>
                          typeof p === 'object' && p && (p as { type?: string }).type !== 'text',
                      ))
                  }
                  onClick={() => {
                    setEditing(entry);
                    setText(contentText(entry.input));
                  }}
                />
                {supports('nativeQueueStart') && !entry.deliveryState && (
                  <IconButton
                    icon={Play}
                    label={t('立即发送队列消息')}
                    disabled={action.busy}
                    onClick={() => void mutate('start', { submissionId: entry.id })}
                  />
                )}
                <IconButton
                  icon={ArrowUp}
                  label={t('上移消息')}
                  disabled={
                    action.busy || value.data.some((item) => !!item.deliveryState) || index === 0
                  }
                  onClick={() => {
                    const ids = value.data.map((e) => e.id);
                    [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!];
                    void mutate('reorder', { submissionIds: ids });
                  }}
                />
                <IconButton
                  icon={ArrowDown}
                  label={t('下移消息')}
                  disabled={
                    action.busy ||
                    value.data.some((item) => !!item.deliveryState) ||
                    index === value.data.length - 1
                  }
                  onClick={() => {
                    const ids = value.data.map((e) => e.id);
                    [ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!];
                    void mutate('reorder', { submissionIds: ids });
                  }}
                />
                <IconButton
                  icon={Trash2}
                  label={t('删除队列消息')}
                  disabled={action.busy}
                  onClick={() => setDeleting(entry.id)}
                />
              </div>
            </div>
            <MotionPresence>
              {deleting === entry.id && (
                <div className="confirmation">
                  <p>{t('删除这条待发送消息？')}</p>
                  <button
                    disabled={action.busy}
                    onClick={() => void mutate('delete', { submissionId: entry.id })}
                  >
                    {t('确认删除')}
                  </button>
                  <button onClick={() => setDeleting('')}>{t('取消')}</button>
                </div>
              )}
            </MotionPresence>
          </div>
        ))}
      </MotionList>
      {value && !value.data.length && <p className="muted">{t('暂无待发送消息。')}</p>}
      {editing && (
        <form
          className="panel-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void mutate('update', {
              submissionId: editing.id,
              text: text.trim(),
              ...(editing.inputRevision ? { expectedInputRevision: editing.inputRevision } : {}),
            });
          }}
        >
          <label>
            {t('编辑待发送消息')}
            <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="button-row">
            <button disabled={action.busy || !text.trim()}>{t('保存')}</button>
            <button type="button" onClick={() => setEditing(undefined)}>
              {t('取消')}
            </button>
          </div>
        </form>
      )}
      {action.feedback}
    </div>
  );
}

export function ProjectsPanel({
  request,
  projects,
  supports,
  onChanged,
  onProject,
}: {
  request: Request;
  projects: Project[];
  supports: (s: string) => boolean;
  onChanged: () => void;
  onProject: (id: string) => void;
}) {
  useLocale();
  const [remove, setRemove] = useState('');
  const action = useAction();
  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <p className="muted">
          {supports('codexWorkspaceDiscovery')
            ? t('已同步的工作区')
            : t(
                '此电脑需要更新 Host 才能自动同步 Codex 工作区；当前仍可在电脑上使用 agentdeck projects add PATH 添加。',
              )}
        </p>
        <IconButton
          icon={RefreshCw}
          label={t('同步 Codex 工作区')}
          disabled={action.busy || !supports('codexWorkspaceDiscovery')}
          onClick={() =>
            void action.run(async () => {
              await request('projects.add', {});
              onChanged();
            })
          }
        />
      </div>
      <MotionList>
        {projects.map((p) => (
          <div className="project-setting" data-motion-item key={p.projectId}>
            <button onClick={() => onProject(p.projectId)}>
              <Folder size={18} />
              <span>
                {p.name}
                <small>{p.canonicalPath}</small>
              </span>
            </button>
            <IconButton
              icon={Trash2}
              label={t('移除项目 {{p0}}', { p0: p.name })}
              disabled={action.busy}
              onClick={() => setRemove(p.projectId)}
            />
            <MotionPresence>
              {remove === p.projectId && (
                <div className="confirmation">
                  <p>
                    {t(
                      '从 Web 移除此工作区并撤销访问？不会删除电脑文件或 Codex 会话，也不会自动重新添加。',
                    )}
                  </p>
                  <button
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        const response = await request('projects.remove', {
                          projectId: p.projectId,
                        });
                        if (response.status === 'awaitingLocalConfirmation') {
                          throw new Error(t('请更新电脑 Host 后再移除工作区。'));
                        }
                        setRemove('');
                        onChanged();
                      })
                    }
                  >
                    {t('确认移除')}
                  </button>
                  <button onClick={() => setRemove('')}>{t('取消')}</button>
                </div>
              )}
            </MotionPresence>
          </div>
        ))}
      </MotionList>
      {supports('nativeProjectReadViews') && (
        <NativeProjects request={request} onProject={onProject} />
      )}
      {action.feedback}
    </div>
  );
}
function NativeProjects({
  request,
  onProject,
}: {
  request: Request;
  onProject: (id: string) => void;
}) {
  useLocale();
  type Native = {
    project: { id: string; name: string; roots: { path: string }[] };
    rootGrants: { rootIndex: number; projectId: string }[];
  };
  const [cursor, setCursor] = useState<string>();
  const { value, error, loading, reload } = useRead<{
    viewId: string;
    data: Native[];
    nextCursor?: string;
  }>(request, 'projects.nativePage', {
    contractVersion: 1,
    limit: 50,
    ...(cursor ? { cursor } : {}),
  });
  return (
    <>
      <h3>{t('Codex 项目')}</h3>
      <LoadState {...{ error, loading, reload }} />
      {value?.data.map((p) => (
        <div className="panel-stack" key={p.project.id}>
          <strong>{p.project.name}</strong>
          {p.project.roots.map((root, index) => {
            const grant = p.rootGrants.find((g) => g.rootIndex === index);
            return (
              <button
                key={root.path}
                disabled={!grant}
                onClick={() => grant && onProject(grant.projectId)}
              >
                {root.path}
                {!grant && t(' · 尚未授权')}
              </button>
            );
          })}
        </div>
      ))}
      {value?.nextCursor && (
        <button onClick={() => setCursor(value.nextCursor)}>{t('下一页项目')}</button>
      )}
    </>
  );
}

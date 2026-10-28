import { useEffect, useState, useRef } from 'react';
import {
  Folder,
  ArrowUp,
  ArrowDown,
  Play,
  Trash2,
  Copy,
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
import type { Capabilities, Model, Project, Request, Session, Skill } from '../workspace';
import { canManage, output, statusLabel } from '../workspace';
import { contentText } from '../RichContent';

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
  return (
    <>
      {loading && (
        <p className="muted" role="status">
          读取中…
        </p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button className="text-button" onClick={reload}>
            重试读取
          </button>
        </div>
      )}
    </>
  );
}
function useAction() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError('');
    setDone('');
    try {
      await fn();
      setDone('已完成');
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
        {(error || done) && (
          <div className="action-feedback" aria-live="polite">
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {done && (
              <p className="muted" role="status">
                {done}
              </p>
            )}
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
          aria-label="对话名称"
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
          aria-label="保存名称"
          title="保存名称"
          disabled={!canRename}
        >
          <Save size={18} aria-hidden="true" />
        </button>
      </form>
      <div className="compact-actions session-actions" aria-label="会话操作">
        <IconButton
          icon={session.pinned === 1 ? PinOff : Pin}
          label={session.pinned === 1 ? '取消置顶' : '置顶会话'}
          pressed={session.pinned === 1}
          disabled={action.busy || !safe}
          onClick={() => void mutate('sessions.pin', { pinned: session.pinned !== 1 })}
        />
        {supports('sessionFork') && (
          <IconButton
            icon={GitFork}
            label="分叉会话"
            disabled={action.busy || !safe}
            onClick={() => void mutate('sessions.fork')}
          />
        )}
        {supports('sessionCompaction') && (
          <IconButton
            icon={Minimize2}
            label="整理上下文"
            disabled={action.busy || !safe}
            onClick={() => setConfirmation('compact')}
          />
        )}
        <IconButton
          icon={session.archived === 1 ? ArchiveRestore : Archive}
          label={session.archived === 1 ? '恢复会话' : '归档会话'}
          disabled={action.busy || !safe}
          onClick={() => setConfirmation(session.archived === 1 ? 'restore' : 'archive')}
        />
        <IconButton
          icon={Trash2}
          label="永久删除会话"
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
                ? '永久删除此会话？此操作无法撤销。'
                : confirmation === 'compact'
                  ? '整理此会话的上下文？电脑会重新核对最新轮次。'
                  : confirmation === 'archive'
                    ? '归档此会话？稍后可从归档列表恢复。'
                    : '恢复此归档会话？'}
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
                        throw new Error('请先停止或核对当前任务');
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
                  ? '处理中…'
                  : confirmation === 'delete'
                    ? '永久删除'
                    : confirmation === 'compact'
                      ? '整理上下文'
                      : confirmation === 'archive'
                        ? '归档'
                        : '恢复'}
              </button>
              <button disabled={action.busy} onClick={() => setConfirmation('')}>
                取消
              </button>
            </div>
          </div>
        )}
      </MotionPresence>
      {!safe && <p className="muted">请先停止或核对正在进行的任务，再管理会话。</p>}
      {action.feedback}
      <LoadState {...{ error, loading, reload }} />
      {value && (
        <details className="technical-details">
          <summary>会话信息与活动记录</summary>
          <DataFields value={value.session} />
          <pre>{output(value.events)}</pre>
        </details>
      )}
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
    return '当前会话仍有任务在执行。请先停止任务，再刷新状态。';
  if (
    !['idle', 'notLoaded'].includes(activity.threadStatus) ||
    (activity.turn && !['completed', 'interrupted', 'failed'].includes(activity.turn.status || ''))
  )
    return '暂时无法确认会话已停止，请刷新状态后重试。';
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
      ? '未能核对会话状态，请刷新状态后重试。'
      : activity.value
        ? goalActivityMessage(activity.value)
        : '正在核对会话状态…'
    : '';
  const disabled = action.busy || loading || !!error || !!activityMessage;
  function reloadState() {
    reload();
    activity.reload();
  }
  async function mutate(kind: string) {
    const ok = await action.run(async () => {
      if (!value?.goalRevision) throw new Error('请先读取当前目标');
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
          throw new Error('操作结果尚未确认，请先核对操作结果，不要重复提交。');
        if (message.includes('SYNC_CONFLICT'))
          throw new Error('目标或任务状态已变化，请核对刷新后的状态再操作。');
        if (
          message.includes('Stop or reconcile') ||
          message.includes('active or unreconciled') ||
          message.includes('Pause an existing goal')
        )
          throw new Error(
            '电脑端尚未确认会话可修改。请先核对任务是否停止，再刷新状态；若已停止仍报错，需要更新电脑端。',
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
        <p className="muted">此会话没有目标。选择输入框中的 Goal 模式并发送任务来创建。</p>
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
            刷新状态
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
                  继续目标
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
                  编辑
                </button>
              )}
              {supports('sessionGoalClear') && (
                <button disabled={disabled} onClick={() => setClear(true)}>
                  清除目标
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
                目标
                <textarea
                  rows={6}
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                />
              </label>
              <label>
                Token 预算
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="不设新预算"
                />
              </label>
              <button disabled={disabled || !objective.trim()}>保存目标</button>
            </form>
          )}
          {clear && (
            <div className="confirmation">
              <p>清除现有目标？</p>
              <button disabled={disabled} onClick={() => void mutate('clear')}>
                确认清除
              </button>
              <button onClick={() => setClear(false)}>取消</button>
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
        aria-label="搜索技能"
        placeholder="搜索技能"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="skills-summary">
        <strong>技能</strong>
        <span>{selected.length} / 8 已选择</span>
        {selected.length > 0 && (
          <button className="text-button" onClick={() => onSelect([])}>
            清空
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
              aria-label={`${selected.some((v) => v.id === s.id) ? '移除' : '添加'}技能 ${s.name}`}
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
              {selected.some((v) => v.id === s.id) ? '已添加' : '添加'}
            </button>
            {configure && (
              <label className="switch">
                <input
                  type="checkbox"
                  aria-label={`启用技能 ${s.name}`}
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
      {value?.errorCount ? <p className="muted">有 {value.errorCount} 个技能无法读取。</p> : null}
      {action.feedback}
    </div>
  );
}

type QueueEntry = { id: string; input: unknown[]; inputRevision?: string; status?: string };
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
        <p className="muted">消息由电脑保存，网页不会在重连时自动重发。</p>
        <IconButton icon={RefreshCw} label="刷新队列" onClick={reload} />
      </div>
      <LoadState {...{ error, loading, reload }} />
      <MotionList className="panel-stack">
        {value?.data.map((entry, index) => (
          <div className="queue-entry" data-motion-item key={entry.id}>
            <p>{contentText(entry.input)}</p>
            {entry.input.some(
              (p) => !!p && typeof p === 'object' && (p as { type?: string }).type !== 'text',
            ) && <p className="muted">包含附件或技能；编辑时保留原资源。</p>}
            <div className="queue-toolbar">
              <small>{statusLabel(entry.status)}</small>
              <div className="compact-actions">
                <IconButton
                  icon={Pencil}
                  label="编辑队列消息"
                  disabled={
                    action.busy ||
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
                {supports('nativeQueueStart') && (
                  <IconButton
                    icon={Play}
                    label="立即发送队列消息"
                    disabled={action.busy}
                    onClick={() => void mutate('start', { submissionId: entry.id })}
                  />
                )}
                <IconButton
                  icon={ArrowUp}
                  label="上移消息"
                  disabled={action.busy || index === 0}
                  onClick={() => {
                    const ids = value.data.map((e) => e.id);
                    [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!];
                    void mutate('reorder', { submissionIds: ids });
                  }}
                />
                <IconButton
                  icon={ArrowDown}
                  label="下移消息"
                  disabled={action.busy || index === value.data.length - 1}
                  onClick={() => {
                    const ids = value.data.map((e) => e.id);
                    [ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!];
                    void mutate('reorder', { submissionIds: ids });
                  }}
                />
                <IconButton
                  icon={Trash2}
                  label="删除队列消息"
                  disabled={action.busy}
                  onClick={() => setDeleting(entry.id)}
                />
              </div>
            </div>
            <MotionPresence>
              {deleting === entry.id && (
                <div className="confirmation">
                  <p>删除这条待发送消息？</p>
                  <button
                    disabled={action.busy}
                    onClick={() => void mutate('delete', { submissionId: entry.id })}
                  >
                    确认删除
                  </button>
                  <button onClick={() => setDeleting('')}>取消</button>
                </div>
              )}
            </MotionPresence>
          </div>
        ))}
      </MotionList>
      {value && !value.data.length && <p className="muted">暂无待发送消息。</p>}
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
            编辑待发送消息
            <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="button-row">
            <button disabled={action.busy || !text.trim()}>保存</button>
            <button type="button" onClick={() => setEditing(undefined)}>
              取消
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
  const [remove, setRemove] = useState('');
  const action = useAction();
  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <p className="muted">
          {supports('codexWorkspaceDiscovery')
            ? '自动显示 Codex 已有工作区。移除后不再自动添加，电脑上的文件和 Codex 会话不会删除。'
            : '此电脑需要更新 Host 才能自动同步 Codex 工作区；当前仍可在电脑上使用 agentdeck projects add PATH 添加。'}
        </p>
        <IconButton
          icon={RefreshCw}
          label="同步 Codex 工作区"
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
              label={`移除项目 ${p.name}`}
              disabled={action.busy}
              onClick={() => setRemove(p.projectId)}
            />
            <MotionPresence>
              {remove === p.projectId && (
                <div className="confirmation">
                  <p>
                    从 Web 移除此工作区并撤销访问？不会删除电脑文件或 Codex
                    会话，也不会自动重新添加。
                  </p>
                  <button
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        const response = await request('projects.remove', {
                          projectId: p.projectId,
                        });
                        if (response.status === 'awaitingLocalConfirmation') {
                          throw new Error('请更新电脑 Host 后再移除工作区。');
                        }
                        setRemove('');
                        onChanged();
                      })
                    }
                  >
                    确认移除
                  </button>
                  <button onClick={() => setRemove('')}>取消</button>
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
      <h3>Codex 项目</h3>
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
                {!grant && ' · 尚未授权'}
              </button>
            );
          })}
        </div>
      ))}
      {value?.nextCursor && <button onClick={() => setCursor(value.nextCursor)}>下一页项目</button>}
    </>
  );
}

export function ConfigurationPanel({
  request,
  models,
  supports,
}: {
  request: Request;
  models: Model[];
  supports: (s: string) => boolean;
}) {
  const { value, error, loading, reload } = useRead<{
    values?: Record<string, unknown>;
    origins?: unknown;
    userRevision?: string;
    workspacePolicyCompatible?: boolean;
    sandboxVerified?: boolean;
  }>(request, 'settings.execution', {});
  const [model, setModel] = useState(''),
    [effort, setEffort] = useState(''),
    [verbosity, setVerbosity] = useState('default'),
    [summary, setSummary] = useState('default');
  useEffect(() => {
    if (!value) return;
    const current = value.values || {};
    setModel(typeof current.model === 'string' ? current.model : '');
    setEffort(
      typeof current.model_reasoning_effort === 'string' ? current.model_reasoning_effort : '',
    );
    setVerbosity(typeof current.model_verbosity === 'string' ? current.model_verbosity : 'default');
    setSummary(
      typeof current.model_reasoning_summary === 'string'
        ? current.model_reasoning_summary
        : 'default',
    );
  }, [value]);
  const action = useAction();
  return (
    <div className="panel-stack">
      <LoadState {...{ error, loading, reload }} />
      {value && (
        <>
          <details>
            <summary>当前模型、沙盒和配置来源</summary>
            <DataFields value={value} />
          </details>
          {supports('modelDefaultsWrite') && (
            <form
              className="panel-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(async () => {
                  await request('settings.modelDefaults', {
                    model,
                    expectedUserRevision: value.userRevision,
                    ...(effort ? { effort } : {}),
                  });
                  reload();
                });
              }}
            >
              <h3>默认模型</h3>
              <select
                aria-label="默认模型"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setEffort('');
                }}
              >
                <option value="">选择模型</option>
                {model && !models.some((m) => (m.id || m.model) === model) && (
                  <option value={model}>{model}</option>
                )}
                {models.map((m) => {
                  const id = m.id || m.model;
                  return id ? (
                    <option value={id} key={id}>
                      {m.displayName || m.name || id}
                    </option>
                  ) : null;
                })}
              </select>
              <select
                aria-label="默认推理强度"
                value={effort}
                onChange={(e) => setEffort(e.target.value)}
              >
                <option value="">模型默认</option>
                {effort &&
                  !models
                    .find((m) => (m.id || m.model) === model)
                    ?.supportedReasoningEfforts?.some(
                      (e) => (typeof e === 'string' ? e : e.reasoningEffort) === effort,
                    ) && <option value={effort}>{effort}</option>}
                {models
                  .find((m) => (m.id || m.model) === model)
                  ?.supportedReasoningEfforts?.map((e) => {
                    const id = typeof e === 'string' ? e : e.reasoningEffort;
                    return <option key={id}>{id}</option>;
                  })}
              </select>
              <button disabled={action.busy || !value.userRevision || !model}>
                保存模型默认值
              </button>
            </form>
          )}
          {supports('outputDefaultsWrite') && (
            <form
              className="panel-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(async () => {
                  await request('settings.outputDefaults', {
                    verbosity,
                    summary,
                    expectedUserRevision: value.userRevision,
                  });
                  reload();
                });
              }}
            >
              <h3>默认输出</h3>
              <label>
                详细程度
                <select value={verbosity} onChange={(e) => setVerbosity(e.target.value)}>
                  {['default', 'low', 'medium', 'high'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                思考摘要
                <select value={summary} onChange={(e) => setSummary(e.target.value)}>
                  {['default', 'auto', 'concise', 'detailed', 'none'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <button disabled={action.busy || !value.userRevision}>保存输出默认值</button>
            </form>
          )}
        </>
      )}
      {action.feedback}
    </div>
  );
}
export function RetentionPanel({ request }: { request: Request }) {
  const { value, error, loading, reload } = useRead<{
    retention: { days: number; maxMiB: number };
  }>(request, 'settings.get', {});
  const [days, setDays] = useState(''),
    [mib, setMib] = useState(''),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!value) return;
    setDays(String(value.retention.days));
    setMib(String(value.retention.maxMiB));
  }, [value]);
  const action = useAction();
  return (
    <div className="panel-stack">
      <LoadState {...{ error, loading, reload }} />
      {value && <DataFields value={value} />}
      <label>
        缓存保留天数
        <input
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          placeholder="1–365"
        />
      </label>
      <label>
        缓存上限 MiB
        <input
          type="number"
          min={16}
          max={1024}
          value={mib}
          onChange={(e) => setMib(e.target.value)}
          placeholder="16–1024"
        />
      </label>
      <button
        disabled={
          action.busy ||
          !(
            Number(days) >= 1 &&
            Number(days) <= 365 &&
            Number(mib) >= 16 &&
            Number(mib) <= 1024 &&
            Number.isInteger(Number(days)) &&
            Number.isInteger(Number(mib))
          )
        }
        onClick={() => setConfirm(true)}
      >
        更新缓存策略
      </button>
      {confirm && (
        <div className="confirmation">
          <p>更新电脑缓存策略？超过限额的本地缓存会被清理。</p>
          <button
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await request('settings.update', { days: Number(days), maxMiB: Number(mib) });
                setConfirm(false);
                reload();
              })
            }
          >
            确认更新
          </button>
          <button onClick={() => setConfirm(false)}>取消</button>
        </div>
      )}
      {action.feedback}
    </div>
  );
}
export function DiagnosticsPanel({ request }: { request: Request }) {
  const { value, error, loading, reload } = useRead<Record<string, unknown>>(
    request,
    'system.diagnostics',
    {},
  );
  const action = useAction();
  return (
    <div className="panel-stack">
      <LoadState {...{ error, loading, reload }} />
      {value && (
        <>
          <DataFields value={value} />
          <button
            onClick={() => void action.run(() => navigator.clipboard.writeText(output(value)))}
          >
            <Copy size={16} />
            复制已脱敏诊断
          </button>
        </>
      )}
      {action.feedback}
    </div>
  );
}
export function AccountPanel({ request }: { request: Request }) {
  const { value, error, loading, reload } = useRead<Record<string, unknown>>(
    request,
    'account.status',
    {},
  );
  return (
    <>
      <LoadState {...{ error, loading, reload }} />
      {value && <DataFields value={value} />}
    </>
  );
}

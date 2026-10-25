import { useEffect, useState, useRef } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  FileText,
  Folder,
  Play,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  Plus,
  Pin,
  Archive,
  GitFork,
  Minimize2,
} from 'lucide-react';
import { DataFields, IconButton } from '../ui';
import type { Capabilities, Model, Project, Request, Session, Skill } from '../workspace';
import { canManage, output, statusLabel } from '../workspace';
import { contentText } from '../RichContent';
import { DiffText } from './DiffText';

function useRead<T>(request: Request, action: string, payload: Record<string, unknown>) {
  const [value, setValue] = useState<T>(),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false);
  const key = JSON.stringify(payload);
  useEffect(() => {
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
  }, [request, action, key, revision]);
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
      <>
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
      </>
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
  const mutate = async (name: string, payload: Record<string, unknown> = {}) => {
    await action.run(async () => {
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
    <div className="panel-stack">
      <div>
        <span className="eyebrow">Conversation</span>
        <h3>{session.title || '未命名会话'}</h3>
        <p className="muted">{statusLabel(value?.session.status || session.status)}</p>
      </div>
      <label>
        名称
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </label>
      <div className="button-row">
        <button
          disabled={action.busy || !safe || !title.trim()}
          onClick={() => void mutate('sessions.rename', { title: title.trim() })}
        >
          保存名称
        </button>
        <button
          disabled={action.busy || !safe}
          onClick={() => void mutate('sessions.pin', { pinned: session.pinned !== 1 })}
        >
          <Pin size={16} />
          {session.pinned === 1 ? '取消置顶' : '置顶'}
        </button>
        {supports('sessionFork') && (
          <button disabled={action.busy || !safe} onClick={() => void mutate('sessions.fork')}>
            <GitFork size={16} />
            分叉会话
          </button>
        )}
      </div>
      <div className="panel-list">
        {supports('sessionCompaction') && (
          <button disabled={action.busy || !safe} onClick={() => setConfirmation('compact')}>
            <Minimize2 size={17} />
            <span>整理上下文</span>
          </button>
        )}
        <button
          disabled={action.busy || !safe}
          onClick={() => setConfirmation(session.archived === 1 ? 'restore' : 'archive')}
        >
          <Archive size={17} />
          <span>{session.archived === 1 ? '恢复会话' : '归档会话'}</span>
        </button>
        <button
          className="danger"
          disabled={action.busy || !safe}
          onClick={() => setConfirmation('delete')}
        >
          <Trash2 size={17} />
          <span>永久删除会话</span>
        </button>
      </div>
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
              disabled={action.busy}
              onClick={async () => {
                if (confirmation === 'compact') {
                  await action.run(async () => {
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
                } else await mutate(`sessions.${confirmation}`);
                setConfirmation('');
              }}
            >
              确认
            </button>
            <button onClick={() => setConfirmation('')}>取消</button>
          </div>
        </div>
      )}
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
  const [editing, setEditing] = useState(false),
    [objective, setObjective] = useState(''),
    [budget, setBudget] = useState(''),
    [clear, setClear] = useState(false);
  const action = useAction(),
    goal = value?.goal;
  async function mutate(kind: string) {
    const ok = await action.run(async () => {
      if (!value?.goalRevision) throw new Error('请先读取当前目标');
      await request(`sessions.goal.${kind}`, {
        sessionId,
        expectedGoalRevision: value.goalRevision,
        ...(kind === 'edit'
          ? { objective: objective.trim(), ...(budget ? { tokenBudget: Number(budget) } : {}) }
          : {}),
      });
      onChanged();
      reload();
    });
    if (ok) {
      setEditing(false);
      setClear(false);
    }
  }
  return (
    <div className="panel-stack">
      <LoadState {...{ error, loading, reload }} />
      {value && !goal && (
        <p className="muted">此会话没有目标。选择输入框中的 Goal 模式并发送任务来创建。</p>
      )}
      {goal && (
        <>
          <div className="goal-status">{statusLabel(goal.status)}</div>
          <p className="goal-objective">{goal.objective}</p>
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
                <button disabled={action.busy} onClick={() => void mutate('resume')}>
                  <Play size={16} />
                  继续目标
                </button>
              )}
              {supports('sessionGoalEdit') && (
                <button
                  disabled={action.busy}
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
                <button disabled={action.busy} onClick={() => setClear(true)}>
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
              <button disabled={action.busy || !objective.trim()}>保存目标</button>
            </form>
          )}
          {clear && (
            <div className="confirmation">
              <p>清除现有目标？</p>
              <button disabled={action.busy} onClick={() => void mutate('clear')}>
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

type FileEntry = { name: string; path: string; kind: string; size?: number };
export function FilesPanel({
  request,
  projectId,
  onReference,
  initialPath,
}: {
  request: Request;
  projectId: string;
  onReference: (text: string) => void;
  initialPath?: string;
}) {
  const [directory, setDirectory] = useState(''),
    [selected, setSelected] = useState<FileEntry | undefined>(() =>
      initialPath
        ? { name: initialPath.split('/').pop() || initialPath, path: initialPath, kind: 'file' }
        : undefined,
    ),
    [text, setText] = useState(''),
    [fileError, setFileError] = useState(''),
    [fileLoading, setFileLoading] = useState(false);
  const { value, error, loading, reload } = useRead<{ entries: FileEntry[]; truncated?: boolean }>(
    request,
    'files.list',
    { projectId, ...(directory ? { directory } : {}) },
  );
  const action = useAction();
  useEffect(() => {
    let active = true;
    setText('');
    setFileError('');
    if (!selected) return;
    setFileLoading(true);
    void request<{ text: string }>('files.readText', { projectId, path: selected.path })
      .then((v) => {
        if (active) setText(v.text);
      })
      .catch((e) => {
        if (active) setFileError(String(e));
      })
      .finally(() => {
        if (active) setFileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected, projectId, request]);
  return (
    <div className="panel-stack">
      <div className="breadcrumb">
        <IconButton
          icon={ArrowLeft}
          label="上一级"
          disabled={!directory && !selected}
          onClick={() => {
            if (selected) setSelected(undefined);
            else
              setDirectory(
                directory.replace(/[\\/][^\\/]+$/, '') === directory
                  ? ''
                  : directory.replace(/[\\/][^\\/]+$/, ''),
              );
          }}
        />
        <span>{selected?.path || directory || '项目根目录'}</span>
        <IconButton icon={RefreshCw} label="刷新文件" onClick={reload} />
      </div>
      {selected ? (
        <>
          <p className="muted">当前授权文件 · UTF-8 · 最多 256 KiB</p>
          {fileLoading && <p>读取中…</p>}
          {fileError && <p className="error">{fileError}</p>}
          <pre className="file-preview">{text}</pre>
          <button
            disabled={action.busy || fileLoading || !!fileError}
            onClick={() =>
              void action.run(async () => {
                const v = await request<{ referenceText: string }>('files.reference', {
                  projectId,
                  path: selected.path,
                });
                onReference(v.referenceText);
              })
            }
          >
            <Plus size={16} />
            引用到消息
          </button>
          {action.feedback}
        </>
      ) : (
        <>
          <LoadState {...{ error, loading, reload }} />
          <div className="file-list">
            {value?.entries.map((f) => (
              <button
                key={f.path}
                onClick={() => {
                  if (f.kind === 'directory') setDirectory(f.path);
                  else setSelected(f);
                }}
              >
                {f.kind === 'directory' ? <Folder size={18} /> : <FileText size={18} />}
                <span>{f.name}</span>
                <small>{f.kind === 'directory' ? '' : `${f.size || 0} B`}</small>
              </button>
            ))}
          </div>
          {value && !value.entries.length && <p className="muted">此目录为空。</p>}
          {value?.truncated && <p className="muted">目录条目已达到读取上限。</p>}
        </>
      )}
    </div>
  );
}

type GitFile = {
  fileId: string;
  path: string;
  oldPath?: string;
  index?: string;
  worktree?: string;
  untracked?: boolean;
};
export function GitPanel({ request, projectId }: { request: Request; projectId: string }) {
  const { value, error, loading, reload } = useRead<{
    available: boolean;
    files: GitFile[];
    attribution?: unknown;
    truncated?: boolean;
  }>(request, 'git.status', { projectId });
  const [selected, setSelected] = useState<GitFile>();
  return (
    <div className="panel-stack">
      <p className="muted">当前工作区差异 · 只读</p>
      <LoadState {...{ error, loading, reload }} />
      <div className="file-list">
        {value?.files?.map((f) => (
          <button
            key={f.fileId}
            className={selected?.fileId === f.fileId ? 'selected' : ''}
            onClick={() => setSelected(f)}
          >
            <FileText size={17} />
            <span>{f.path}</span>
            <small>{f.untracked ? 'U' : `${f.index || ''} ${f.worktree || ''}`}</small>
          </button>
        ))}
      </div>
      {value &&
        (!value.available ? (
          <p>此项目没有可用的 Git 工作区。</p>
        ) : (
          !value.files.length && <p>工作区没有改动。</p>
        ))}
      {value?.truncated && <p className="muted">文件列表达到读取上限。</p>}
      {selected && (
        <CurrentDiff
          key={selected.fileId}
          request={request}
          projectId={projectId}
          file={selected}
        />
      )}
    </div>
  );
}
function CurrentDiff({
  request,
  projectId,
  file,
}: {
  request: Request;
  projectId: string;
  file: GitFile;
}) {
  const { value, error, loading, reload } = useRead<{
    text: string;
    binary: boolean;
    truncated: boolean;
  }>(request, 'git.diff', { projectId, fileId: file.fileId });
  return (
    <>
      <h3>{file.path}</h3>
      <LoadState {...{ error, loading, reload }} />
      {value &&
        (value.binary ? <p>二进制文件无法显示文本差异。</p> : <DiffText text={value.text} />)}
      {value?.truncated && <p className="muted">差异过长，已截断。</p>}
    </>
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
  const [query, setQuery] = useState(''),
    [detail, setDetail] = useState<Skill>();
  const action = useAction();
  return (
    <div className="panel-stack">
      <input
        aria-label="搜索技能"
        placeholder="搜索技能"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="muted">已选择 {selected.length} / 8 个技能</p>
      <LoadState {...{ error, loading, reload }} />
      {value?.skills
        .filter((s) =>
          `${s.name} ${s.description} ${s.displayName}`.toLowerCase().includes(query.toLowerCase()),
        )
        .map((s) => (
          <div className="skill-row" key={s.id}>
            <button className="skill-info" onClick={() => setDetail(s)}>
              <strong>{s.displayName || s.name}</strong>
              <small>{s.shortDescription || s.description}</small>
            </button>
            <IconButton
              icon={selected.some((v) => v.id === s.id) ? Check : Plus}
              label={`${selected.some((v) => v.id === s.id) ? '移除' : '引用'}技能 ${s.name}`}
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
            />
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
      {detail && (
        <details open>
          <summary>{detail.displayName || detail.name}</summary>
          <p>{detail.description}</p>
          <small>{detail.scope}</small>
        </details>
      )}
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
      {value?.data.map((entry, index) => (
        <div className="queue-entry" key={entry.id}>
          <p>{contentText(entry.input)}</p>
          {entry.input.some(
            (p) => !!p && typeof p === 'object' && (p as { type?: string }).type !== 'text',
          ) && <p className="muted">包含附件或技能；编辑时保留原资源。</p>}
          <small>{statusLabel(entry.status)}</small>
          <div className="button-row">
            <button
              disabled={
                action.busy ||
                (!supports('nativeQueueResourceEdit') &&
                  entry.input.some(
                    (p) => typeof p === 'object' && p && (p as { type?: string }).type !== 'text',
                  ))
              }
              onClick={() => {
                setEditing(entry);
                setText(contentText(entry.input));
              }}
            >
              编辑
            </button>
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
        </div>
      ))}
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
      <p className="muted">项目目录由电脑授权。新增项目会在电脑上请求选择文件夹。</p>
      <button
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            await request('projects.add', {});
            onChanged();
          })
        }
      >
        <Plus size={16} />
        在电脑上授权项目
      </button>
      {projects.map((p) => (
        <div className="project-setting" key={p.projectId}>
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
          {remove === p.projectId && (
            <div className="confirmation">
              <p>撤销该项目的授权？电脑上的文件不会删除。</p>
              <button
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await request('projects.remove', { projectId: p.projectId });
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
        </div>
      ))}
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
    values?: unknown;
    origins?: unknown;
    userRevision?: string;
    workspacePolicyCompatible?: boolean;
    sandboxVerified?: boolean;
  }>(request, 'settings.execution', {});
  const [model, setModel] = useState(''),
    [effort, setEffort] = useState(''),
    [verbosity, setVerbosity] = useState('default'),
    [summary, setSummary] = useState('default');
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
  const { value, error, loading, reload } = useRead<Record<string, unknown>>(
    request,
    'settings.get',
    {},
  );
  const [days, setDays] = useState(''),
    [mib, setMib] = useState(''),
    [confirm, setConfirm] = useState(false);
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

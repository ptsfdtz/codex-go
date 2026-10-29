import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Folder, RefreshCw, Search, Trash2 } from 'lucide-react';
import { IconButton } from '../../ui';
import type { Project, Request } from '../../workspace';
import './project-settings.css';

export function ProjectSettings({
  request,
  projects,
  connected,
  hostName,
  currentProject,
  canSync,
  onChanged,
  onProject,
}: {
  request: Request;
  projects: Project[];
  connected: boolean;
  hostName?: string;
  currentProject?: string;
  canSync: boolean;
  onChanged: () => Promise<void> | void;
  onProject: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState<Project>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const alive = useRef(true);
  const removeTrigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmationId = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async (operation: string, action: () => Promise<void>) => {
    if (pending.current || !connected) return;
    pending.current = true;
    setBusy(operation);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      if (alive.current) setBusy('');
    }
  };
  const cancelRemoval = () => {
    setRemoving(undefined);
    setError('');
    removeTrigger.current?.focus();
  };
  const filter = query.trim().toLocaleLowerCase();
  const visible = projects.filter((project) =>
    `${project.name} ${project.canonicalPath || ''}`.toLocaleLowerCase().includes(filter),
  );
  return (
    <section className="project-settings" aria-label="项目管理">
      <header className="project-settings-heading">
        <div>
          <h3 ref={heading} tabIndex={-1}>
            项目 <span className="project-settings-count">{connected ? projects.length : '—'}</span>
          </h3>
          <p>{hostName ? `来自 ${hostName}` : '管理已同步的项目'}</p>
        </div>
        <button
          type="button"
          className="project-settings-sync"
          disabled={!connected || !canSync || !!busy}
          aria-busy={busy === 'sync' || undefined}
          title={!canSync && connected ? '更新电脑 Host 后可同步项目' : undefined}
          onClick={() =>
            void run('sync', async () => {
              await request('projects.add', {});
              if (!alive.current) return;
              await onChanged();
              if (alive.current) setNotice('项目已同步');
            })
          }
        >
          <RefreshCw
            size={14}
            className={busy === 'sync' ? 'pending-icon' : ''}
            aria-hidden="true"
          />
          {busy === 'sync' ? '同步中…' : '同步项目'}
        </button>
      </header>
      {connected && (projects.length > 5 || query !== '') && (
        <label className="project-settings-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索项目"
            placeholder="搜索名称或路径"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      {!connected ? (
        <p className="project-settings-empty">连接电脑后查看和管理项目。</p>
      ) : projects.length === 0 ? (
        <div className="project-settings-empty">
          <Folder size={23} strokeWidth={1.4} aria-hidden="true" />
          <p>还没有已同步的项目</p>
          <small>在电脑上的 Codex 中打开项目后，同步到这里。</small>
        </div>
      ) : (
        <ul className="project-settings-list">
          {visible.map((project) => (
            <li key={project.projectId}>
              <div className="project-settings-row">
                <span className="project-settings-folder">
                  <Folder size={17} strokeWidth={1.5} aria-hidden="true" />
                </span>
                <button
                  type="button"
                  className="project-settings-open"
                  aria-label={`打开项目 ${project.name}`}
                  disabled={!!busy}
                  onClick={() => onProject(project.projectId)}
                >
                  <span className="project-settings-name">
                    <strong>{project.name}</strong>
                    {currentProject === project.projectId && <small>当前</small>}
                  </span>
                  {project.canonicalPath && (
                    <span className="project-settings-path" title={project.canonicalPath}>
                      {project.canonicalPath}
                    </span>
                  )}
                </button>
                <div className="project-settings-actions">
                  <IconButton
                    icon={ArrowUpRight}
                    label={`进入项目 ${project.name}`}
                    disabled={!!busy}
                    onClick={() => onProject(project.projectId)}
                  />
                  <button
                    type="button"
                    className="icon-button project-settings-remove-trigger"
                    title={`移除项目 ${project.name}`}
                    aria-label={`移除项目 ${project.name}`}
                    disabled={!!busy}
                    onClick={(event) => {
                      removeTrigger.current = event.currentTarget;
                      setError('');
                      setNotice('');
                      setRemoving(project);
                    }}
                  >
                    <Trash2 size={15} strokeWidth={1.6} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {removing?.projectId === project.projectId && (
                <div
                  className="project-settings-confirm"
                  role="group"
                  aria-labelledby={confirmationId}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      if (!pending.current) cancelRemoval();
                    }
                  }}
                >
                  <strong id={confirmationId}>移除“{project.name}”？</strong>
                  <p>
                    将撤销此项目的 Web 访问。电脑文件和 Codex 会话会保留，项目不会自动重新添加。
                  </p>
                  <div>
                    <button type="button" disabled={!!busy} onClick={cancelRemoval}>
                      取消
                    </button>
                    <button
                      type="button"
                      className="project-settings-remove"
                      disabled={!!busy}
                      onClick={() =>
                        void run('remove', async () => {
                          const response = await request('projects.remove', {
                            projectId: project.projectId,
                          });
                          if (response.status === 'awaitingLocalConfirmation')
                            throw new Error('请更新电脑 Host 后再移除项目。');
                          if (response.status !== 'removed')
                            throw new Error('移除结果尚未确认，请同步项目后核对。');
                          if (!alive.current) return;
                          setRemoving(undefined);
                          await onChanged();
                          if (alive.current) {
                            setNotice(`已移除“${project.name}”`);
                            heading.current?.focus();
                          }
                        })
                      }
                    >
                      {busy === 'remove' ? '移除中…' : '移除项目'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {visible.length === 0 && <li className="project-settings-empty">没有匹配的项目</li>}
        </ul>
      )}
      <div className="project-settings-feedback" aria-live="polite">
        {connected && !canSync && <p>更新电脑 Host 后可使用项目同步。</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
    </section>
  );
}

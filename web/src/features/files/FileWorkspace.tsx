import { useContentMotion } from '../../motion';
import type { FileReference } from '../../workspace';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Copy,
  FileDiff,
  FolderOpen,
  GitCompareArrows,
  Info,
  ListTree,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type { Request } from '../../workspace';
import { IconButton } from '../../ui';
import { isProjectImage, readProjectImage } from '../project-image';
import { CodePreview, type ScrollPosition } from './CodePreview';
import { FileIcon, FileTree, type DirectoryState } from './FileTree';
import {
  closeTab,
  gitLabel,
  openTab,
  parentPaths,
  restoreWorkspace,
  validFilePath,
  type FileTab,
  type GitStatus,
} from './workspace-state';
import { BranchComparison } from './BranchComparison';
import './file-workspace.css';

type Content = {
  loading?: boolean;
  error?: string;
  text?: string;
  imageUrl?: string;
  binary?: boolean;
  truncated?: boolean;
  untracked?: boolean;
  size?: number;
};

export function FileWorkspace({
  request,
  projectId,
  projectName,
  storageKey,
  visible,
  initialPath,
  initialView = 'files',
  openToken,
  imagePreview,
  gitRead,
  gitBranchCompare,
  referenceAllowed,
  expanded: wide,
  onExpand,
  onClose,
  onReference,
}: {
  request: Request;
  projectId: string;
  projectName: string;
  storageKey: string;
  visible: boolean;
  initialPath?: string;
  initialView?: 'files' | 'changes';
  openToken: number;
  imagePreview: boolean;
  gitRead: boolean;
  gitBranchCompare: boolean;
  referenceAllowed: boolean;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  onReference: (reference: FileReference) => void;
}) {
  const [comparing, setComparing] = useState(false);
  const [findToken, setFindToken] = useState(0);
  const [workspace, setWorkspace] = useState(() => {
    try {
      return restoreWorkspace(sessionStorage.getItem(storageKey));
    } catch {
      return restoreWorkspace(null);
    }
  });
  const [treeOpen, setTreeOpen] = useState(true),
    [query, setQuery] = useState(''),
    [revision, setRevision] = useState(0);
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({});
  const directoryRef = useRef(directories),
    generation = useRef(0);
  const [expanded, setExpanded] = useState(() => new Set(['', ...parentPaths(workspace.active)]));
  const [git, setGit] = useState<{ value?: GitStatus; loading?: boolean; error?: string }>({});
  const [loadedContent, setLoadedContent] = useState<Content & { key?: string }>({});
  const [feedback, setFeedback] = useState(''),
    [actionBusy, setActionBusy] = useState(false);
  const positions = useRef(new Map<string, ScrollPosition>()),
    tabList = useRef<HTMLDivElement>(null);
  const active = workspace.tabs.find((tab) => tab.path === workspace.active);
  const previewMotion = useContentMotion(`${workspace.active}:${active?.view || ''}`);
  const changes = git.value?.files || [];
  const gitStatusByPath = new Map(changes.map((file) => [file.path, gitLabel(file)]));
  const changed = changes.find((file) => file.path === active?.path);
  const image = !!active && active.view === 'file' && isProjectImage(active.path);
  const scrollKey = `${active?.view}:${active?.path}`;
  const contentKey = `${scrollKey}:${revision}`;
  const content: Content = loadedContent.key === contentKey ? loadedContent : { loading: true };
  const setContent = (value: Content) => setLoadedContent({ ...value, key: contentKey });
  const diffId = active?.view === 'diff' ? changed?.fileId : undefined;
  const diffLoading = active?.view === 'diff' ? git.loading : undefined;
  const diffError = active?.view === 'diff' ? git.error : undefined;

  const open = useCallback((path: string, view: FileTab['view'] = 'file') => {
    if (view !== 'changes' && !validFilePath(path)) {
      setFeedback('请输入项目内的相对文件路径。');
      return;
    }
    setWorkspace((state) => openTab(state, { path, view }));
    if (path) setExpanded((items) => new Set([...items, ...parentPaths(path)]));
    setFeedback('');
    if (matchMedia('(max-width:760px)').matches) setTreeOpen(false);
  }, []);
  useEffect(() => {
    if (!visible) return;
    setComparing(false);
    if (initialPath) open(initialPath);
    else if (initialView === 'changes') open('', 'changes');
  }, [initialPath, initialView, openToken, visible, open]);
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(workspace));
    } catch {
      /* Tabs still work in memory. */
    }
  }, [workspace, storageKey]);
  useEffect(() => {
    tabList.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [workspace.active]);
  useEffect(() => {
    generation.current++;
    directoryRef.current = {};
    setDirectories({});
    return () => {
      generation.current++;
    };
  }, [request, projectId, visible, revision]);
  useEffect(() => {
    if (!visible) return;
    const version = generation.current;
    for (const path of expanded) {
      if (Object.hasOwn(directoryRef.current, path)) continue;
      if (Object.keys(directoryRef.current).length >= 64) {
        setFeedback('已达到目录浏览上限，请刷新项目文件或输入完整路径直接打开文件。');
        break;
      }
      directoryRef.current = { ...directoryRef.current, [path]: { entries: [], loading: true } };
      setDirectories({ ...directoryRef.current });
      void request<{ entries: DirectoryState['entries']; truncated?: boolean }>('files.list', {
        projectId,
        ...(path ? { directory: path } : {}),
      })
        .then((value) => {
          if (version !== generation.current) return;
          const entries = value.entries.filter(
            (entry) =>
              validFilePath(entry.path) && entry.path.split('/').slice(0, -1).join('/') === path,
          );
          const remaining = Math.max(
            0,
            20000 -
              Object.values(directoryRef.current).reduce((sum, dir) => sum + dir.entries.length, 0),
          );
          directoryRef.current = {
            ...directoryRef.current,
            [path]: {
              entries: entries.slice(0, remaining),
              truncated: value.truncated || entries.length > remaining,
            },
          };
          setDirectories({ ...directoryRef.current });
        })
        .catch((error) => {
          if (version !== generation.current) return;
          directoryRef.current = {
            ...directoryRef.current,
            [path]: { entries: [], error: String(error) },
          };
          setDirectories({ ...directoryRef.current });
        });
    }
  }, [request, projectId, visible, revision, expanded]);
  useEffect(() => {
    if (!visible || !gitRead) {
      setGit({});
      return;
    }
    let current = true;
    setGit({ loading: true });
    void request<GitStatus>('git.status', { projectId })
      .then((value) => {
        if (current) setGit({ value });
      })
      .catch((error) => {
        if (current) setGit({ error: String(error) });
      });
    return () => {
      current = false;
    };
  }, [request, projectId, visible, revision, gitRead]);
  useEffect(() => {
    let current = true,
      objectUrl = '';
    setContent({});
    setFeedback('');
    if (!visible || comparing || !active || active.view === 'changes') return;
    if (image && !imagePreview) {
      setContent({ error: '当前电脑不支持图片预览，请升级 Host。' });
      return;
    }
    if (active.view === 'diff' && !changed) {
      if (!git.loading)
        setContent({ error: git.error || '此文件已不在当前变更列表中，请刷新或查看文件内容。' });
      else setContent({ loading: true });
      return;
    }
    setContent({ loading: true });
    const result =
      active.view === 'diff'
        ? request<Content>('git.diff', { projectId, fileId: changed!.fileId })
        : image
          ? readProjectImage(request, projectId, active.path, () => current)
          : request<Content>('files.readText', { projectId, path: active.path });
    void result
      .then((value) => {
        if (!current) return;
        if (value instanceof Blob) {
          objectUrl = URL.createObjectURL(value);
          setContent({ imageUrl: objectUrl, size: value.size });
        } else setContent(value);
      })
      .catch((error) => {
        if (current) setContent({ error: String(error) });
      });
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    request,
    projectId,
    visible,
    active?.path,
    active?.view,
    image,
    imagePreview,
    comparing,
    diffId,
    diffLoading,
    diffError,
    revision,
  ]);

  function toggleDirectory(path: string, show: boolean) {
    setExpanded((items) => {
      const next = new Set(items);
      if (show) next.add(path);
      else next.delete(path);
      return next;
    });
  }
  function retryDirectory(path: string) {
    delete directoryRef.current[path];
    setExpanded((items) => new Set(items));
  }
  async function action(run: () => Promise<void>) {
    if (actionBusy) return;
    setActionBusy(true);
    setFeedback('');
    try {
      await run();
    } catch (error) {
      setFeedback(String(error));
    } finally {
      setActionBusy(false);
    }
  }
  function close(path: string) {
    setWorkspace((state) => closeTab(state, path));
    positions.current.delete(`file:${path}`);
    positions.current.delete(`diff:${path}`);
    requestAnimationFrame(() =>
      tabList.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus(),
    );
  }
  return (
    <aside
      className={`file-workspace ${treeOpen ? 'with-file-tree' : ''}`}
      hidden={!visible}
      inert={!visible}
      aria-hidden={!visible}
      aria-label="项目文件工作区"
    >
      <header className="file-workspace-header" aria-label="文件预览导航">
        {!comparing && workspace.tabs.length ? (
          <div
            className="file-tabs"
            role="tablist"
            aria-label="已打开的文件"
            ref={tabList}
            onKeyDown={(event) => {
              const index = workspace.tabs.findIndex((tab) => tab.path === workspace.active);
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % workspace.tabs.length;
              else if (event.key === 'ArrowLeft')
                next = (index + workspace.tabs.length - 1) % workspace.tabs.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = workspace.tabs.length - 1;
              else if (event.key === 'Delete' && active) {
                event.preventDefault();
                close(active.path);
                return;
              } else return;
              event.preventDefault();
              const tab = workspace.tabs[next];
              if (tab) {
                open(tab.path, tab.view);
                requestAnimationFrame(() =>
                  tabList.current
                    ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
                    ?.focus(),
                );
              }
            }}
          >
            {workspace.tabs.map((tab) => (
              <div
                className={`file-tab ${tab.path === workspace.active ? 'selected' : ''}`}
                key={tab.path || 'changes'}
              >
                <button
                  role="tab"
                  aria-selected={tab.path === workspace.active}
                  tabIndex={tab.path === workspace.active ? 0 : -1}
                  title={tab.path || '全部变更'}
                  onClick={() => open(tab.path, tab.view)}
                >
                  {tab.view === 'changes' || tab.view === 'diff' ? (
                    <FileDiff size={14} />
                  ) : (
                    <FileIcon path={tab.path} />
                  )}
                  <span>{tab.view === 'changes' ? '全部变更' : tab.path.split('/').pop()}</span>
                  {gitStatusByPath.has(tab.path) && (
                    <small className={`file-git-status status-${gitStatusByPath.get(tab.path)}`}>
                      {gitStatusByPath.get(tab.path)}
                    </small>
                  )}
                </button>
                <button
                  className="file-tab-close"
                  aria-label={`关闭标签 ${tab.path || '全部变更'}`}
                  onClick={() => close(tab.path)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="file-workspace-title" title={projectName}>
            <FolderOpen size={16} />
            <strong>{projectName}</strong>
          </div>
        )}
        <div className="file-workspace-actions">
          {!comparing && active?.path && (
            <>
              {content.text !== undefined && !content.loading && !content.error && (
                <IconButton
                  icon={Search}
                  label="文件内查找"
                  onClick={() => setFindToken((value) => value + 1)}
                />
              )}
              {changed && (
                <IconButton
                  icon={FileDiff}
                  label={active.view === 'diff' ? '查看文件' : '查看变更'}
                  pressed={active.view === 'diff'}
                  onClick={() => open(active.path, active.view === 'diff' ? 'file' : 'diff')}
                />
              )}
              {active.view === 'file' && content.text !== undefined && (
                <IconButton
                  icon={Copy}
                  label="复制文件内容"
                  disabled={actionBusy}
                  onClick={() => void action(() => navigator.clipboard.writeText(content.text!))}
                />
              )}
              {active.view === 'file' && !content.loading && !content.error && (
                <IconButton
                  icon={Plus}
                  label={referenceAllowed ? '引用文件' : '升级 Host 后可添加文件引用'}
                  disabled={actionBusy || !referenceAllowed}
                  onClick={() =>
                    void action(async () => {
                      const version = generation.current;
                      const result = await request<FileReference>('files.reference', {
                        projectId,
                        path: active.path,
                      });
                      if (version === generation.current) onReference(result);
                    })
                  }
                />
              )}
            </>
          )}
          <IconButton
            icon={ArrowLeft}
            label="返回对话"
            className="file-mobile-back"
            onClick={onClose}
          />
          <IconButton
            icon={GitCompareArrows}
            label={comparing ? '返回项目文件' : '比较分支'}
            pressed={comparing}
            onClick={() => setComparing((value) => !value)}
          />
          {!comparing && (
            <IconButton
              icon={RefreshCw}
              label="刷新项目文件和变更"
              onClick={() => setRevision((value) => value + 1)}
            />
          )}
          <IconButton
            icon={wide ? Minimize2 : Maximize2}
            label={wide ? '恢复并排预览' : '扩大文件预览'}
            onClick={onExpand}
          />
          {!comparing && (
            <IconButton
              icon={ListTree}
              label={treeOpen ? '隐藏文件目录' : '显示文件目录'}
              pressed={treeOpen}
              onClick={() => setTreeOpen((value) => !value)}
            />
          )}
          <IconButton icon={X} label="关闭文件工作区" onClick={onClose} />
        </div>
      </header>
      {comparing ? (
        visible && (
          <BranchComparison request={request} projectId={projectId} supported={gitBranchCompare} />
        )
      ) : (
        <div className="file-workspace-body">
          <section ref={previewMotion} className="file-editor" aria-label="文件预览">
            {feedback && (
              <div className="file-feedback" role="status">
                {feedback}
              </div>
            )}
            {!active ? (
              <div className="file-empty">
                <FolderOpen size={32} />
                <h3>浏览项目文件</h3>
                <p>
                  从右侧目录选择文件，在这里预览。
                  <br />
                  对话仍可在左侧继续。
                </p>
                <button onClick={() => setTreeOpen(true)}>显示文件目录</button>
              </div>
            ) : active.view === 'changes' ? (
              <div className="file-changes-overview">
                <div
                  className="file-changes-heading"
                  aria-label={`工作区变更，${changes.length} 个文件`}
                >
                  <FileDiff size={15} aria-hidden="true" />
                  <small>{changes.length}</small>
                  <span
                    className="file-changes-info"
                    tabIndex={0}
                    role="img"
                    aria-label="当前电脑的实际工作区改动，可能包含其他应用的修改。"
                    title="当前电脑的实际工作区改动，可能包含其他应用的修改。"
                  >
                    <Info size={15} aria-hidden="true" />
                  </span>
                </div>
                {git.loading && <p role="status">正在读取变更…</p>}
                {git.error && (
                  <p className="error" role="alert">
                    {git.error}
                  </p>
                )}
                {git.value &&
                  (!git.value.available ? (
                    <p>此项目没有可用的 Git 工作区。</p>
                  ) : (
                    !changes.length && <p>工作区没有改动。</p>
                  ))}
                {changes.map((file) => (
                  <button key={file.fileId} onClick={() => open(file.path, 'diff')}>
                    <FileIcon path={file.path} />
                    <span>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
                    <small className={`file-git-status status-${gitLabel(file)}`}>
                      {gitLabel(file)}
                    </small>
                  </button>
                ))}
                {git.value?.truncated && (
                  <p className="muted">变更列表已达到上限，部分文件未显示。</p>
                )}
              </div>
            ) : (
              <>
                {content.loading && (
                  <div className="file-empty" role="status">
                    正在读取{active.view === 'diff' ? '差异' : '文件'}…
                  </div>
                )}
                {content.error && (
                  <div className="file-empty" role="alert">
                    <p className="error">{content.error}</p>
                    <button onClick={() => setRevision((value) => value + 1)}>
                      <RefreshCw size={14} />
                      重新读取
                    </button>
                  </div>
                )}
                {!content.loading &&
                  !content.error &&
                  (content.binary ? (
                    <div className="file-empty">
                      二进制文件无法显示文本差异。
                      <button onClick={() => open(active.path)}>查看文件</button>
                    </div>
                  ) : content.imageUrl ? (
                    <div className="file-workspace-image">
                      <img
                        src={content.imageUrl}
                        alt={active.path}
                        onError={() => setContent({ error: '无法渲染此图片，请检查格式后重试。' })}
                      />
                    </div>
                  ) : (
                    content.text !== undefined && (
                      <CodePreview
                        key={scrollKey}
                        findToken={findToken}
                        text={content.text}
                        path={active.path}
                        diff={active.view === 'diff'}
                        untracked={content.untracked}
                        position={positions.current.get(scrollKey)}
                        onScroll={(value) => positions.current.set(scrollKey, value)}
                      />
                    )
                  ))}
                {content.truncated && (
                  <div className="file-feedback">差异过长，当前预览已截断。</div>
                )}
              </>
            )}
          </section>
          {treeOpen && (
            <aside className="file-explorer" aria-label="文件目录侧栏">
              <form
                className="file-filter"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (query.trim()) open(query.trim());
                }}
              >
                <Search size={14} />
                <input
                  id="file-filter"
                  aria-label="筛选文件或打开路径"
                  placeholder="筛选文件 / 输入路径"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button type="button" aria-label="清除文件筛选" onClick={() => setQuery('')}>
                    <X size={13} />
                  </button>
                )}
              </form>
              {query && (
                <div className="file-filter-hint">筛选已加载目录；按 Enter 打开完整相对路径。</div>
              )}
              <div className="file-explorer-scroll">
                {gitRead && (
                  <>
                    <button className="file-section-button" onClick={() => open('', 'changes')}>
                      <FileDiff size={14} />
                      全部变更<small>{changes.length || ''}</small>
                    </button>
                    <details className="file-tree-section">
                      <summary>
                        已更改的文件 <small>{changes.length || ''}</small>
                      </summary>
                      {git.loading && (
                        <p className="file-tree-message" role="status">
                          核对变更中…
                        </p>
                      )}
                      {git.error && (
                        <div className="file-tree-message error" role="alert">
                          {git.error}
                          <button onClick={() => setRevision((value) => value + 1)}>重试</button>
                        </div>
                      )}
                      {git.value && !git.value.available && (
                        <p className="file-tree-message">不是可用的 Git 工作区</p>
                      )}
                      {git.value?.available && !changes.length && (
                        <p className="file-tree-message">没有改动</p>
                      )}
                      {changes
                        .filter((file) => file.path.toLowerCase().includes(query.toLowerCase()))
                        .map((file) => (
                          <button
                            className={`file-tree-row ${active?.path === file.path && active.view === 'diff' ? 'selected' : ''}`}
                            key={file.fileId}
                            title={file.path}
                            onClick={() => open(file.path, 'diff')}
                          >
                            <FileIcon path={file.path} />
                            <span>{file.path}</span>
                            <small className={`file-git-status status-${gitLabel(file)}`}>
                              {gitLabel(file)}
                            </small>
                          </button>
                        ))}
                      {git.value?.truncated && (
                        <p className="file-tree-message">变更列表已截断。</p>
                      )}
                    </details>
                  </>
                )}
                <details className="file-tree-section" open>
                  <summary>所有文件</summary>
                  <FileTree
                    directories={directories}
                    expanded={expanded}
                    query={query}
                    selected={active?.path}
                    changes={changes}
                    onToggle={toggleDirectory}
                    onOpen={(path) => open(path)}
                    onRetry={retryDirectory}
                  />
                </details>
              </div>
            </aside>
          )}
        </div>
      )}
    </aside>
  );
}

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Computer, FileDiff, FileText, FolderOpen, RefreshCw, X } from 'lucide-react';
import type { Project, Request } from '../../workspace';
import { IconButton } from '../../ui';
import { gitLabel, validFilePath, type GitStatus } from '../files/workspace-state';
import './project-overview.css';

export function ProjectOverview({
  request,
  project,
  computer,
  gitRead,
  fileBrowser,
  activeTurn,
  filesOpen,
  onOpen,
  onFiles,
  onChanges,
  onFile,
}: {
  request: Request;
  project: Project;
  computer: string;
  gitRead: boolean;
  fileBrowser: boolean;
  activeTurn?: string;
  filesOpen: boolean;
  onOpen: () => void;
  onFiles: () => void;
  onChanges: () => void;
  onFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ value?: GitStatus; error?: string }>({});
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (filesOpen) setOpen(false);
  }, [filesOpen]);
  useEffect(() => {
    const mobile = matchMedia('(max-width:760px)');
    const changed = () => setOpen(false);
    mobile.addEventListener('change', changed);
    return () => mobile.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    if (!open || !gitRead) return;
    let current = true;
    setResult({});
    void request<GitStatus>('git.status', { projectId: project.projectId })
      .then((value) => {
        if (current) setResult({ value });
      })
      .catch((error) => {
        if (current) setResult({ error: String(error) });
      });
    return () => {
      current = false;
    };
  }, [open, gitRead, request, project.projectId, activeTurn, revision]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (
        matchMedia('(max-width:760px)').matches &&
        !anchor.current?.contains(event.target as Node)
      )
        setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const value = result.value;
  const loading = gitRead && !value && !result.error;
  const files = value?.files.filter((file) => validFilePath(file.path)) || [];
  function navigate(action: () => void) {
    setOpen(false);
    action();
  }
  return (
    <div className="project-overview-anchor" ref={anchor}>
      <button
        ref={trigger}
        className="icon-button"
        title="项目概览"
        aria-label="项目概览"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen();
          setOpen((value) => !value);
        }}
      >
        <FileDiff size={19} strokeWidth={1.6} aria-hidden="true" />
      </button>
      {open && (
        <section className="popover project-overview" aria-label="项目概览">
          <div className="project-overview-heading">
            <span title={project.canonicalPath || project.name}>{project.name}</span>
            {gitRead && (
              <IconButton
                icon={RefreshCw}
                label="刷新项目概览"
                disabled={loading}
                onClick={() => setRevision((value) => value + 1)}
              />
            )}
            <IconButton
              icon={X}
              label="关闭项目概览"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            />
          </div>
          {gitRead ? (
            <>
              <button
                className="project-overview-changes"
                disabled={!value?.available}
                onClick={() => navigate(onChanges)}
              >
                <FileDiff size={17} />
                <span>工作区改动</span>
                {value?.available && (
                  <strong>
                    {value.files.length}
                    {value.truncated ? '+' : ''}
                    <small> 个文件</small>
                  </strong>
                )}
              </button>
              <div className="project-overview-state" role="status">
                {loading && '正在读取工作区…'}
                {result.error && (
                  <>
                    <span className="error">{result.error}</span>
                    <button onClick={() => setRevision((value) => value + 1)}>重试读取</button>
                  </>
                )}
                {value && !value.available && '此项目没有可用的 Git 工作区。'}
                {value?.available && !value.files.length && '工作区干净，暂无未提交改动。'}
              </div>
              {!!files.length && (
                <>
                  <p className="project-overview-caption">变更文件</p>
                  {files.slice(0, 3).map((file) => (
                    <button
                      className="project-overview-file"
                      key={file.fileId}
                      disabled={!fileBrowser}
                      title={file.path}
                      onClick={() => navigate(() => onFile(file.path))}
                    >
                      <FileText size={15} />
                      <span>{file.path}</span>
                      <small>{gitLabel(file)}</small>
                    </button>
                  ))}
                  <button className="project-overview-all" onClick={() => navigate(onChanges)}>
                    <ArrowUpRight size={15} />
                    <span>查看全部改动</span>
                  </button>
                </>
              )}
              {value?.truncated && (
                <p className="project-overview-caption">变更数量已达到读取上限</p>
              )}
            </>
          ) : (
            <p className="project-overview-caption">当前电脑尚不支持读取 Git 改动</p>
          )}
          <div className="project-overview-footer">
            {fileBrowser && (
              <button onClick={() => navigate(onFiles)}>
                <FolderOpen size={16} />
                <span>浏览项目文件</span>
                <ArrowUpRight size={14} />
              </button>
            )}
            <div title={computer}>
              <Computer size={15} />
              <span>{computer}</span>
              <span className="dot online" />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

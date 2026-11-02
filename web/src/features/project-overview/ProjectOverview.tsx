import type { HistoryEntry } from '../../history';
import type { Bridge } from '../../transport/bridge';
import { readHistoryImage } from '../../media';
import { displayCommand } from '../command-display';
import { overviewData, type OverviewSource } from './overview-data';
import { errorText, t, useLocale } from '../../i18n';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  FileDiff,
  FileText,
  FolderOpen,
  RefreshCw,
  X,
  Terminal,
  Plus,
  Image,
  ChevronDown,
  GitBranch,
} from 'lucide-react';
import type { Draft, Project, Request } from '../../workspace';
import { IconButton, Modal } from '../../ui';
import { type GitStatus } from '../files/workspace-state';
import './project-overview.css';

export function ProjectOverview({
  request,
  project,
  history = [],
  draft,
  connection,
  sessionId = '',
  onEntry,
  onAddSources,
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
  computer?: string;
  history?: HistoryEntry[];
  draft?: Draft;
  connection?: Bridge;
  sessionId?: string;
  onEntry?: (entry: HistoryEntry) => void;
  onAddSources?: () => void;
  gitRead: boolean;
  fileBrowser: boolean;
  activeTurn?: string;
  filesOpen: boolean;
  onOpen: () => void;
  onFiles: () => void;
  onChanges: () => void;
  onFile: (path: string) => void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [allSources, setAllSources] = useState(false);
  const [preview, setPreview] = useState<OverviewSource>();
  const { processes, sources } = overviewData(history, draft, project);
  const [result, setResult] = useState<{ value?: GitStatus; error?: string }>({});
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setPreview(undefined);
    setAllSources(false);
  }, [sessionId, project.projectId]);
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
      if (event.key === 'Escape' && !preview) {
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
  }, [open, preview]);
  const value = result.value;
  const loading = gitRead && !value && !result.error;

  function navigate(action: () => void) {
    setOpen(false);
    action();
  }
  return (
    <div className="project-overview-anchor" ref={anchor}>
      <button
        ref={trigger}
        className="icon-button"
        title={t('项目概览')}
        aria-label={t('项目概览')}
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            onOpen();
            setAllSources(false);
          }
          setOpen((value) => !value);
        }}
      >
        <FileDiff size={19} strokeWidth={1.6} aria-hidden="true" />
      </button>
      {open && (
        <section className="popover project-overview" aria-label={t('项目概览')}>
          <div className="project-overview-heading">
            <span title={project.canonicalPath || project.name}>{project.name}</span>
            {gitRead && (
              <IconButton
                icon={RefreshCw}
                label={t('刷新项目概览')}
                disabled={loading}
                onClick={() => setRevision((value) => value + 1)}
              />
            )}
            <IconButton
              icon={X}
              label={t('关闭项目概览')}
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
                <span>{t('改动')}</span>
                {value?.available && (
                  <strong>
                    {value.files.length}
                    {value.truncated ? '+' : ''}
                    <small> {t(' 个文件')}</small>
                  </strong>
                )}
                <GitBranch size={15} className="project-overview-branch" />
              </button>
              <div className="project-overview-state" role="status">
                {loading && t('正在读取工作区…')}
                {result.error && (
                  <>
                    <span className="error">{errorText(result.error)}</span>
                    <button onClick={() => setRevision((value) => value + 1)}>
                      {t('重试读取')}
                    </button>
                  </>
                )}
                {value && !value.available && t('此项目没有可用的 Git 工作区。')}
                {value?.available && !value.files.length && t('工作区干净，暂无未提交改动。')}
              </div>
              {value?.truncated && (
                <p className="project-overview-caption">{t('变更数量已达到读取上限')}</p>
              )}
            </>
          ) : (
            <p className="project-overview-caption">{t('当前电脑尚不支持读取 Git 改动')}</p>
          )}
          <section className="project-overview-section" aria-label={t('后台进程')}>
            <h3>{t('后台进程')}</h3>
            {processes.length ? (
              processes.map((entry) => (
                <button
                  type="button"
                  className="project-overview-row"
                  key={JSON.stringify([entry.turnId, entry.item?.id])}
                  title={displayCommand(String(entry.item?.command))}
                  disabled={!onEntry}
                  onClick={() => navigate(() => onEntry?.(entry))}
                >
                  <Terminal size={16} />
                  <span>{displayCommand(String(entry.item?.command))}</span>
                  <i className="activity-dot" aria-label={t('正在执行命令')} />
                </button>
              ))
            ) : (
              <p className="project-overview-empty">{t('当前会话暂无运行中的命令')}</p>
            )}
          </section>
          <section className="project-overview-section" aria-label={t('来源')}>
            <div className="project-overview-section-title">
              <h3>{t('来源')}</h3>
              {onAddSources && (
                <IconButton icon={Plus} label={t('添加图片')} onClick={onAddSources} />
              )}
            </div>
            {(allSources ? sources : sources.slice(0, 3)).map((source, index) => (
              <button
                type="button"
                className="project-overview-row"
                key={source.id}
                title={source.name || t('会话历史图片')}
                disabled={
                  source.kind === 'file'
                    ? !fileBrowser
                    : source.kind === 'history-image' && (!connection || !sessionId)
                }
                onClick={() =>
                  source.kind === 'file' ? navigate(() => onFile(source.path)) : setPreview(source)
                }
              >
                {source.kind === 'draft-image' ? (
                  <img
                    className="project-overview-thumbnail"
                    alt=""
                    src={`data:${source.attachment.mime};base64,${source.attachment.data}`}
                  />
                ) : source.kind === 'file' ? (
                  <FileText size={16} />
                ) : (
                  <Image size={16} />
                )}
                <span>{source.name || `${t('会话历史图片')} ${index + 1}`}</span>
              </button>
            ))}
            {!sources.length && (
              <p className="project-overview-empty">{t('当前会话暂无附件或文件引用')}</p>
            )}
            {sources.length > 3 && (
              <button
                type="button"
                className="project-overview-row project-overview-all"
                onClick={() => setAllSources((value) => !value)}
              >
                <ChevronDown size={15} />
                <span>{allSources ? t('收起') : t('查看全部来源')}</span>
                <small>{sources.length}</small>
              </button>
            )}
          </section>
          <div className="project-overview-footer">
            {fileBrowser && (
              <button type="button" onClick={() => navigate(onFiles)}>
                <FolderOpen size={16} />
                <span>{t('浏览项目文件')}</span>
                <ArrowUpRight size={14} />
              </button>
            )}
            <p>{t('当前会话')}</p>
          </div>
        </section>
      )}
      {preview && (
        <Modal title={preview.name || t('会话历史图片')} onClose={() => setPreview(undefined)}>
          <SourceImage source={preview} connection={connection} sessionId={sessionId} />
        </Modal>
      )}
    </div>
  );
}

function SourceImage({
  source,
  connection,
  sessionId,
}: {
  source: OverviewSource;
  connection?: Bridge;
  sessionId: string;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setUrl('');
    setError('');
    if (source.kind === 'draft-image') {
      setUrl(`data:${source.attachment.mime};base64,${source.attachment.data}`);
      return;
    }
    if (source.kind !== 'history-image' || !connection) return;
    let current = true,
      objectUrl = '';
    void readHistoryImage(
      connection,
      sessionId,
      source.entry.turnId!,
      String(source.entry.item!.id),
      source.index,
      () => current,
    )
      .then((blob) => {
        if (current) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch((error) => {
        if (current) setError(String(error));
      });
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, connection, sessionId, attempt]);
  return url ? (
    <img className="project-overview-preview" src={url} alt={source.name || t('会话历史图片')} />
  ) : error ? (
    <div role="alert">
      <p className="error">{errorText(error)}</p>
      <button onClick={() => setAttempt((value) => value + 1)}>{t('重试读取图片')}</button>
    </div>
  ) : (
    <p role="status">{t('读取图片中…')}</p>
  );
}

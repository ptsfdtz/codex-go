import { errorText, t, useLocale } from '../../i18n';
import { Select } from '../../components/Select';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  FileDiff,
  GitBranch,
  GitCompareArrows,
  Info,
  ListFilter,
  LoaderCircle,
  RefreshCw,
  Search,
} from 'lucide-react';
import { IconButton } from '../../ui';
import { FileIcon } from './FileTree';
import './branch-comparison.css';
import type { Request } from '../../workspace';
import { CodePreview } from './CodePreview';

type Branches = {
  branches: { name: string; commit: string }[];
  current?: string;
  truncated: boolean;
};
type Comparison = {
  base: string;
  head: string;
  files: { path: string; fileId: string; status: string; previewable: boolean }[];
  truncated: boolean;
};
type Diff = { text: string; binary: boolean; truncated: boolean };
const label = (name: string) =>
  name.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, t('远程 / '));

export function BranchComparison({
  request,
  projectId,
  supported,
}: {
  request: Request;
  projectId: string;
  supported: boolean;
}) {
  useLocale();
  const [branches, setBranches] = useState<Branches>();
  const [base, setBase] = useState(''),
    [head, setHead] = useState('HEAD');
  const [mode, setMode] = useState('merge-base');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Comparison>();
  const [selected, setSelected] = useState('');
  const [filesOpen, setFilesOpen] = useState(true);
  const [filter, setFilter] = useState('');
  const previewHeading = useRef<HTMLDivElement>(null);
  const help = useRef<HTMLDetailsElement>(null);
  const fileFilter = useRef<HTMLInputElement>(null);
  const [diff, setDiff] = useState<Diff>();
  const [retry, setRetry] = useState(0);
  const [findToken, setFindToken] = useState(0);
  const [loading, setLoading] = useState(false),
    [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState(''),
    [diffError, setDiffError] = useState('');
  const generation = useRef(0);
  const cache = useRef(new Map<string, Diff>());
  const [compared, setCompared] = useState('');
  const selectionKey = JSON.stringify([base, head, mode]);
  const stale = compared !== selectionKey;

  useEffect(() => {
    function outside(event: PointerEvent) {
      if (help.current && !help.current.contains(event.target as Node)) help.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && help.current?.open) {
        event.preventDefault();
        help.current.open = false;
        help.current.querySelector('summary')?.focus();
      }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  useEffect(() => {
    if (!supported) return;
    let current = true;
    generation.current++;
    cache.current.clear();
    setResult(undefined);
    setSelected('');
    setFilesOpen(true);
    setFilter('');
    setBranches(undefined);
    setError('');
    setLoading(true);
    void request<Branches>('git.branches', { projectId })
      .then((value) => {
        if (!current) return;
        setBranches(value);
        setHead(value.current || 'HEAD');
        const main =
          value.branches.find((b) => b.name === 'refs/heads/main') ||
          value.branches.find((b) => b.name === 'refs/heads/master') ||
          value.branches.find((b) => b.name !== value.current);
        setBase(main?.name || value.current || 'HEAD');
      })
      .catch((e) => {
        if (current) setError(String(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      generation.current++;
    };
  }, [request, projectId, supported, revision]);

  useEffect(() => {
    setDiff(undefined);
    setDiffError('');
    setDiffLoading(false);
    if (!result || !selected || stale) return;
    const cached = cache.current.get(selected);
    if (cached) {
      setDiff(cached);
      return;
    }
    let current = true;
    setDiffLoading(true);
    void request<Diff>('git.compareDiff', {
      projectId,
      base: result.base,
      head: result.head,
      fileId: selected,
    })
      .then((value) => {
        if (!current) return;
        if (cache.current.size >= 8) cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(selected, value);
        setDiff(value);
      })
      .catch((e) => {
        if (current) setDiffError(String(e));
      })
      .finally(() => {
        if (current) setDiffLoading(false);
      });
    return () => {
      current = false;
    };
  }, [request, projectId, result, selected, stale, retry]);

  async function compare() {
    const version = ++generation.current;
    setLoading(true);
    setError('');
    setResult(undefined);
    setSelected('');
    setFilesOpen(true);
    setFilter('');
    cache.current.clear();
    try {
      const value = await request<Comparison>('git.compare', { projectId, base, head, mode });
      if (generation.current === version) {
        setResult(value);
        setCompared(selectionKey);
      }
    } catch (e) {
      if (generation.current === version) setError(String(e));
    } finally {
      if (generation.current === version) setLoading(false);
    }
  }

  function selectFile(fileId?: string) {
    if (!fileId) return;
    setSelected(fileId);
    setFilesOpen(false);
    if (matchMedia('(max-width:760px)').matches)
      requestAnimationFrame(() => previewHeading.current?.focus());
  }
  const file = result?.files.find((entry) => entry.fileId === selected);
  const index = result?.files.findIndex((entry) => entry.fileId === selected) ?? -1;
  const filtered =
    result?.files.filter((entry) => entry.path.toLowerCase().includes(filter.toLowerCase())) || [];
  const statusName = (status: string) =>
    ({ A: t('新增'), M: t('修改'), D: t('删除'), T: t('类型变更') })[status] || status;
  if (!supported)
    return (
      <div className="file-empty">
        <GitCompareArrows size={28} strokeWidth={1.5} />
        <h3>{t('比较分支')}</h3>
        <p>{t('当前电脑尚不支持分支比较，请升级 Host。')}</p>
      </div>
    );
  return (
    <section className="branch-comparison" aria-label={t('分支比较')}>
      <form
        className="branch-controls"
        onSubmit={(event) => {
          event.preventDefault();
          void compare();
        }}
      >
        <div className="branch-selectors">
          <label className="branch-select-field">
            <span className="branch-sr-only">{t('基准')}</span>
            <div>
              <GitBranch size={14} />
              <Select
                aria-label={t('基准分支')}
                title={t('基准分支：{{p0}}', { p0: label(base) })}
                value={base}
                disabled={loading || !branches}
                onValueChange={(value) => setBase(value)}
              >
                <option value="HEAD">{t('HEAD（当前提交）')}</option>
                <optgroup label={t('本地分支')}>
                  {branches?.branches
                    .filter((b) => !b.name.startsWith('refs/remotes/'))
                    .map((b) => (
                      <option key={b.name} value={b.name}>
                        {label(b.name)}
                      </option>
                    ))}
                </optgroup>
                <optgroup label={t('远程分支')}>
                  {branches?.branches
                    .filter((b) => b.name.startsWith('refs/remotes/'))
                    .map((b) => (
                      <option key={b.name} value={b.name}>
                        {label(b.name)}
                      </option>
                    ))}
                </optgroup>
              </Select>
            </div>
          </label>
          <IconButton
            icon={ArrowLeftRight}
            label={t('交换基准和目标分支')}
            disabled={loading || !branches}
            onClick={() => {
              setBase(head);
              setHead(base);
            }}
          />
          <label className="branch-select-field">
            <span className="branch-sr-only">{t('目标')}</span>
            <div>
              <GitBranch size={14} />
              <Select
                aria-label={t('目标分支')}
                title={t('目标分支：{{p0}}', { p0: label(head) })}
                value={head}
                disabled={loading || !branches}
                onValueChange={(value) => setHead(value)}
              >
                <option value="HEAD">{t('HEAD（当前提交）')}</option>
                <optgroup label={t('本地分支')}>
                  {branches?.branches
                    .filter((b) => !b.name.startsWith('refs/remotes/'))
                    .map((b) => (
                      <option key={b.name} value={b.name}>
                        {label(b.name)}
                      </option>
                    ))}
                </optgroup>
                <optgroup label={t('远程分支')}>
                  {branches?.branches
                    .filter((b) => b.name.startsWith('refs/remotes/'))
                    .map((b) => (
                      <option key={b.name} value={b.name}>
                        {label(b.name)}
                      </option>
                    ))}
                </optgroup>
              </Select>
            </div>
          </label>
          <button
            className="branch-compare-button"
            type="submit"
            aria-label={loading ? t('正在比较') : t('比较分支')}
            title={t('比较分支')}
            disabled={loading || !branches || !base}
          >
            {loading ? (
              <LoaderCircle className="pending-icon" size={14} />
            ) : (
              <GitCompareArrows size={14} />
            )}
          </button>
        </div>
        <div className="branch-heading">
          <fieldset className="branch-modes" aria-label={t('比较方式')}>
            <legend>{t('比较方式')}</legend>
            <label title={t('目标分支从共同祖先以来的改动')}>
              <input
                type="radio"
                name="branch-mode"
                value="merge-base"
                checked={mode === 'merge-base'}
                disabled={loading}
                onChange={() => setMode('merge-base')}
              />
              <span>
                <GitBranch size={15} />
                <span className="branch-sr-only">{t('分支改动')}</span>
              </span>
            </label>
            <label title={t('两个分支的最终内容差异')}>
              <input
                type="radio"
                name="branch-mode"
                value="direct"
                checked={mode === 'direct'}
                disabled={loading}
                onChange={() => setMode('direct')}
              />
              <span>
                <GitCompareArrows size={15} />
                <span className="branch-sr-only">{t('两端差异')}</span>
              </span>
            </label>
          </fieldset>
          <div>
            <details className="branch-help" ref={help}>
              <summary aria-label={t('比较说明')} title={t('比较说明')}>
                <Info size={16} />
              </summary>
              <div>
                {t('分支改动：目标分支从共同祖先以来的改动。')}
                <br />
                {t('两端差异：比较两个分支的最终内容。')}
                <hr />
                {t('仅比较本机已有的提交，不含未提交改动；远程分支使用本地记录，不自动拉取。')}
              </div>
            </details>
            <IconButton
              icon={RefreshCw}
              label={t('刷新分支')}
              disabled={loading}
              onClick={() => setRevision((v) => v + 1)}
            />
          </div>
        </div>
      </form>
      {branches?.truncated && (
        <p className="branch-notice">{t('分支列表已达上限，部分分支未显示。')}</p>
      )}
      {error && (
        <p className="branch-notice error" role="alert">
          {errorText(error)}
        </p>
      )}
      {result && stale ? (
        <div className="file-empty">
          <GitCompareArrows size={28} strokeWidth={1.5} />
          <h3>{t('比较条件已更改')}</h3>
          <p>{t('点击“比较”查看新的差异。')}</p>
        </div>
      ) : result ? (
        <>
          <div className="branch-summary">
            <span>
              {t('变更文件')}{' '}
              <small className="branch-count">
                {result.files.length}
                {result.truncated ? '+' : ''}
              </small>
            </span>
            <code title={`${result.base} → ${result.head}`}>
              {result.base.slice(0, 7)}
              <span> → </span>
              {result.head.slice(0, 7)}
            </code>
          </div>
          {result.truncated && (
            <p className="branch-notice">{t('列表已截断，最多显示 1,000 个文件。')}</p>
          )}
          {!result.files.length ? (
            <div className="file-empty">
              <FileDiff size={28} strokeWidth={1.5} />
              <h3>{t('没有差异')}</h3>
              <p>{t('当前比较范围内没有文件改动。')}</p>
            </div>
          ) : (
            <div className={`branch-results ${filesOpen ? 'show-files' : 'show-preview'}`}>
              <div className="branch-file-list" aria-label={t('分支变更文件')}>
                <div className="branch-file-filter">
                  <Search size={13} />
                  <input
                    ref={fileFilter}
                    aria-label={t('筛选变更文件')}
                    placeholder={t('筛选文件…')}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
                <div className="branch-file-scroll">
                  {filtered.map((entry) => (
                    <button
                      key={entry.fileId}
                      className={selected === entry.fileId ? 'selected' : ''}
                      aria-label={`${entry.path} ${statusName(entry.status)}`}
                      aria-pressed={selected === entry.fileId}
                      onClick={() => selectFile(entry.fileId)}
                      title={entry.path}
                    >
                      <FileIcon path={entry.path} />
                      <span>
                        <strong>{entry.path.split('/').pop()}</strong>
                        <small>
                          {entry.path.includes('/')
                            ? entry.path.slice(0, entry.path.lastIndexOf('/'))
                            : t('项目根目录')}
                        </small>
                      </span>
                      <small
                        className={`branch-file-status status-${entry.status}`}
                        title={statusName(entry.status)}
                      >
                        {entry.status}
                      </small>
                    </button>
                  ))}
                  {!filtered.length && <p className="branch-notice">{t('没有匹配的文件。')}</p>}
                </div>
                {file && (
                  <button
                    className="branch-return-preview"
                    onClick={() => {
                      setFilesOpen(false);
                      requestAnimationFrame(() => previewHeading.current?.focus());
                    }}
                  >
                    {t('返回差异')}
                    <ChevronRight size={14} />
                  </button>
                )}
              </div>
              <div className="branch-preview" aria-label={t('分支文件差异')}>
                <div className="branch-preview-heading" ref={previewHeading} tabIndex={-1}>
                  <button
                    className="branch-show-files"
                    aria-label={t('显示变更文件列表')}
                    aria-expanded={filesOpen}
                    onClick={() => {
                      setFilesOpen(true);
                      requestAnimationFrame(() => fileFilter.current?.focus());
                    }}
                  >
                    <ArrowLeft size={14} />
                    {t('文件')}
                  </button>
                  <span className="branch-preview-path" title={file?.path}>
                    {file ? (
                      <>
                        <FileIcon path={file.path} />
                        <span className="branch-path-full">{file.path}</span>
                        <span className="branch-path-name">{file.path.split('/').pop()}</span>
                      </>
                    ) : (
                      <>
                        <ListFilter size={14} />
                        <span>{t('文件差异')}</span>
                      </>
                    )}
                  </span>
                  {file && (
                    <div className="branch-file-navigation">
                      <IconButton
                        icon={Search}
                        label={t('文件内查找')}
                        disabled={!diff || diff.binary}
                        onClick={() => setFindToken((value) => value + 1)}
                      />
                      <span>
                        {index + 1} / {result.files.length}
                      </span>
                      <IconButton
                        icon={ChevronLeft}
                        label={t('上一个变更文件')}
                        disabled={index <= 0}
                        onClick={() => selectFile(result.files[index - 1]?.fileId)}
                      />
                      <IconButton
                        icon={ChevronRight}
                        label={t('下一个变更文件')}
                        disabled={index >= result.files.length - 1}
                        onClick={() => selectFile(result.files[index + 1]?.fileId)}
                      />
                    </div>
                  )}
                </div>
                {diffLoading ? (
                  <div className="file-empty" role="status">
                    <LoaderCircle className="pending-icon" size={22} />
                    <p>{t('正在读取文件差异…')}</p>
                  </div>
                ) : diffError ? (
                  <div className="file-empty" role="alert">
                    <p>{diffError}</p>
                    <button onClick={() => setRetry((value) => value + 1)}>{t('重试')}</button>
                  </div>
                ) : diff ? (
                  <>
                    {diff.truncated && (
                      <div className="file-feedback">
                        {t('差异超过 128 KiB，仅显示前面的部分。')}
                      </div>
                    )}
                    {diff.binary ? (
                      <div className="file-empty">
                        <FileDiff size={28} strokeWidth={1.5} />
                        <h3>{t('此文件不提供文本差异')}</h3>
                        <p>{t('二进制文件、符号链接或子模块仅显示变更信息。')}</p>
                      </div>
                    ) : (
                      <CodePreview
                        key={selected}
                        path={file?.path || ''}
                        text={diff.text}
                        diff
                        findToken={findToken}
                        onScroll={() => {}}
                      />
                    )}
                  </>
                ) : (
                  <div className="file-empty">
                    <FileDiff size={28} strokeWidth={1.5} />
                    <h3>{t('查看文件差异')}</h3>
                    <p>{t('从文件列表选择一项，查看具体改动。')}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : !loading && !error ? (
        <div className="file-empty">
          <GitCompareArrows size={28} strokeWidth={1.5} />
          <h3>{t('比较两个分支')}</h3>
          <p>{t('选择基准与目标，查看已提交的文件改动。')}</p>
        </div>
      ) : (
        loading && (
          <div className="file-empty" role="status">
            <LoaderCircle className="pending-icon" size={22} />
            <p>{t('正在读取比较信息…')}</p>
          </div>
        )
      )}
    </section>
  );
}

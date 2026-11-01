import { errorText, t, useLocale } from '../../i18n';
import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
} from 'lucide-react';
import type { FileEntry, GitFile } from './workspace-state';
import { gitLabel, parentPaths } from './workspace-state';

export type DirectoryState = {
  entries: FileEntry[];
  loading?: boolean;
  error?: string;
  truncated?: boolean;
};
export function FileIcon({
  path,
  directory = false,
  open = false,
}: {
  path: string;
  directory?: boolean;
  open?: boolean;
}) {
  useLocale();
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const Icon = directory
    ? open
      ? FolderOpen
      : Folder
    : /^(png|jpg|jpeg|gif|webp|svg|ico|avif|bmp)$/.test(ext)
      ? FileImage
      : /^(json|yaml|yml|toml)$/.test(ext)
        ? FileJson2
        : /^(ts|tsx|js|jsx|mjs|cjs|rs|py|go|c|h|cpp|html|css|sh|sql)$/.test(ext)
          ? FileCode2
          : /^(md|txt|log|lock)$/.test(ext)
            ? FileText
            : File;
  return (
    <Icon
      size={15}
      className={`file-type-icon ${directory ? 'file-type-directory' : `file-type-${ext}`}`}
      aria-hidden="true"
    />
  );
}

export function FileTree({
  directories,
  expanded,
  query,
  selected,
  changes,
  onToggle,
  onOpen,
  onRetry,
}: {
  directories: Record<string, DirectoryState>;
  expanded: Set<string>;
  query: string;
  selected?: string;
  changes: GitFile[];
  onToggle: (path: string, open: boolean) => void;
  onOpen: (path: string) => void;
  onRetry: (path: string) => void;
}) {
  useLocale();
  const needle = query.trim().toLowerCase();
  const [focused, setFocused] = useState('');
  const matches = new Set<string>();
  if (needle)
    for (const dir of Object.values(directories))
      for (const entry of dir.entries) {
        if (entry.path.toLowerCase().includes(needle)) {
          matches.add(entry.path);
          parentPaths(entry.path).forEach((path) => matches.add(path));
        }
      }
  const changed = new Map(changes.map((file) => [file.path, file]));
  const visiblePaths = new Set(
    Object.values(directories)
      .flatMap((dir) => dir.entries)
      .filter(
        (entry) =>
          (!needle || matches.has(entry.path)) &&
          parentPaths(entry.path).every(
            (path) => expanded.has(path) || (!!needle && Object.hasOwn(directories, path)),
          ),
      )
      .map((entry) => entry.path),
  );
  const focusPath = visiblePaths.has(focused)
    ? focused
    : selected && visiblePaths.has(selected)
      ? selected
      : [...visiblePaths][0];
  function branch(path: string, depth: number) {
    const directory = Object.hasOwn(directories, path) ? directories[path] : undefined;
    if (!directory) return null;
    return (
      <>
        {directory.loading && (
          <p className="file-tree-message" role="status">
            {t('读取目录中…')}
          </p>
        )}
        {directory.error && (
          <div className="file-tree-message error" role="alert">
            {errorText(directory.error)}
            <button onClick={() => onRetry(path)}>
              <RefreshCw size={12} />
              {t('重试')}
            </button>
          </div>
        )}
        {!directory.loading &&
          !directory.error &&
          !directory.truncated &&
          directory.entries.length === 0 && <p className="file-tree-message">{t('空目录')}</p>}
        {directory.entries
          .filter((entry) => !needle || matches.has(entry.path))
          .map((entry) => {
            const folder = entry.kind === 'directory',
              open =
                expanded.has(entry.path) || (!!needle && Object.hasOwn(directories, entry.path));
            const status = changed.get(entry.path);
            return (
              <div key={entry.path} role="none">
                <button
                  role="treeitem"
                  aria-level={depth + 1}
                  aria-expanded={folder ? open : undefined}
                  aria-selected={!folder && selected === entry.path}
                  data-path={entry.path}
                  data-directory={folder || undefined}
                  tabIndex={focusPath === entry.path ? 0 : -1}
                  onFocus={() => setFocused(entry.path)}
                  className={`file-tree-row ${selected === entry.path ? 'selected' : ''}`}
                  title={entry.path}
                  style={{ paddingLeft: 8 + depth * 14 }}
                  onClick={() => (folder ? onToggle(entry.path, !open) : onOpen(entry.path))}
                >
                  {folder ? (
                    open ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )
                  ) : (
                    <span className="file-tree-spacer" />
                  )}
                  <FileIcon path={entry.path} directory={folder} open={open} />
                  <span>{entry.name}</span>
                  {status && (
                    <small className={`file-git-status status-${gitLabel(status)}`}>
                      {gitLabel(status)}
                    </small>
                  )}
                </button>
                {folder && open && depth < 31 && branch(entry.path, depth + 1)}
                {folder && open && depth >= 31 && (
                  <p className="file-tree-message">{t('目录层级过深，请通过路径打开文件。')}</p>
                )}
              </div>
            );
          })}
        {directory.truncated && (
          <p className="file-tree-message">
            {t('目录过大，当前列表已截断；可输入完整路径打开文件。')}
          </p>
        )}
      </>
    );
  }
  return (
    <div
      role="tree"
      aria-label={t('项目目录')}
      className="file-tree"
      onKeyDown={(event) => {
        const node = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="treeitem"]');
        if (!node) return;
        const nodes = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
        );
        const index = nodes.indexOf(node),
          path = node.dataset.path || '',
          folder = node.dataset.directory;
        let target: HTMLButtonElement | undefined;
        if (event.key === 'ArrowDown') target = nodes[Math.min(nodes.length - 1, index + 1)];
        else if (event.key === 'ArrowUp') target = nodes[Math.max(0, index - 1)];
        else if (event.key === 'Home') target = nodes[0];
        else if (event.key === 'End') target = nodes[nodes.length - 1];
        else if (event.key === 'ArrowRight' && folder) {
          if (node.getAttribute('aria-expanded') !== 'true') onToggle(path, true);
          else target = nodes[index + 1];
        } else if (event.key === 'ArrowLeft') {
          if (folder && expanded.has(path)) onToggle(path, false);
          else
            target = nodes.find(
              (item) => item.dataset.path === path.split('/').slice(0, -1).join('/'),
            );
        } else return;
        event.preventDefault();
        target?.focus();
      }}
    >
      {branch('', 0)}
      {needle && !matches.size && (
        <p className="file-tree-message">{t('已加载目录中没有匹配的文件。')}</p>
      )}
    </div>
  );
}

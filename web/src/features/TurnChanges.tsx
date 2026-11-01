import { t, useLocale } from '../i18n';
import { MotionPresence, useContentMotion } from '../motion';
import { useId, useState } from 'react';
import { FileDiff } from 'lucide-react';
import type { HistoryEntry } from '../history';
import { Modal } from '../ui';
import { DiffText } from './DiffText';
import { projectRelativePath, turnChanges, workDuration } from './turn-changes';
export function TurnChanges({
  entries,
  projectRoot,
}: {
  entries: HistoryEntry[];
  projectRoot?: string;
}) {
  useLocale();
  const files = turnChanges(entries),
    duration = workDuration(entries);
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(''),
    [expanded, setExpanded] = useState(false);
  const file = files.find((f) => f.path === selected) || files[0];
  const contentMotion = useContentMotion<HTMLDivElement>(`${open}:${selected}`);
  const panelId = useId();
  const displayPath = (path: string) =>
    projectRelativePath(path, projectRoot) || path.replaceAll('\\', '/').split('/').pop() || path;
  return (
    <>
      {duration && <div className="work-duration">{t('task.duration', { duration })}</div>}
      {files.length > 0 && (
        <div className="turn-changes">
          <div className="changes-header">
            <FileDiff size={17} />
            <strong>{t('files.changed', { count: files.length })}</strong>
            <span className="diff-count-add">+{files.reduce((n, f) => n + f.added, 0)}</span>
            <span className="diff-count-remove">−{files.reduce((n, f) => n + f.removed, 0)}</span>
            <button className="text-button" onClick={() => setOpen(true)}>
              {t('View changes')}
            </button>
          </div>
          {files.slice(0, expanded ? files.length : 3).map((f) => (
            <button
              className="changed-file"
              key={f.path}
              onClick={() => {
                setSelected(f.path);
                setOpen(true);
              }}
            >
              <span title={displayPath(f.path)}>{displayPath(f.path)}</span>
              <span className="diff-count-add">+{f.added}</span>
              <span className="diff-count-remove">−{f.removed}</span>
            </button>
          ))}
          {files.length > 3 && (
            <button className="text-button" onClick={() => setExpanded(!expanded)}>
              {expanded ? t('Show less') : t('files.showMore', { count: files.length - 3 })}
            </button>
          )}
        </div>
      )}
      <MotionPresence>
        {open && file && (
          <Modal
            title={t('改动预览')}
            wide
            className="changes-preview"
            onClose={() => setOpen(false)}
            header={
              <div className="changes-tabs" role="tablist" aria-label={t('改动文件')}>
                {files.map((f) => (
                  <button
                    key={f.path}
                    id={`${panelId}-${files.indexOf(f)}`}
                    role="tab"
                    aria-selected={f.path === file.path}
                    aria-controls={panelId}
                    tabIndex={f.path === file.path ? 0 : -1}
                    title={displayPath(f.path)}
                    onClick={() => setSelected(f.path)}
                    onKeyDown={(event) => {
                      const index = files.indexOf(f);
                      const next =
                        event.key === 'ArrowRight'
                          ? (index + 1) % files.length
                          : event.key === 'ArrowLeft'
                            ? (index + files.length - 1) % files.length
                            : event.key === 'Home'
                              ? 0
                              : event.key === 'End'
                                ? files.length - 1
                                : undefined;
                      if (next === undefined) return;
                      event.preventDefault();
                      setSelected(files[next]!.path);
                      const target =
                        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                          '[role="tab"]',
                        )[next];
                      target?.focus();
                      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                    }}
                    className={f.path === file.path ? 'selected' : ''}
                  >
                    <span>{displayPath(f.path)}</span>
                    <span className="diff-count-add">+{f.added}</span>
                    <span className="diff-count-remove">−{f.removed}</span>
                  </button>
                ))}
              </div>
            }
          >
            <div
              key={file.path}
              id={panelId}
              ref={contentMotion}
              role="tabpanel"
              aria-labelledby={`${panelId}-${files.indexOf(file)}`}
              tabIndex={0}
            >
              <DiffText text={file.diffs.join('\n\n')} />
            </div>
          </Modal>
        )}
      </MotionPresence>
    </>
  );
}

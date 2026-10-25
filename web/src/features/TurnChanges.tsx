import { MotionPresence } from '../motion';
import { useState } from 'react';
import { FileDiff } from 'lucide-react';
import type { HistoryEntry } from '../history';
import { Modal } from '../ui';
import { DiffText } from './DiffText';
import { turnChanges, workDuration } from './turn-changes';
export function TurnChanges({ entries, partial }: { entries: HistoryEntry[]; partial: boolean }) {
  const files = turnChanges(entries),
    duration = workDuration(entries);
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(''),
    [expanded, setExpanded] = useState(false);
  const file = files.find((f) => f.path === selected) || files[0];
  return (
    <>
      {duration && (
        <div className="work-duration">
          Worked for {duration}
          {partial ? ' · loaded history' : ''}
        </div>
      )}
      {files.length > 0 && (
        <div className="turn-changes">
          <div className="changes-header">
            <FileDiff size={17} />
            <strong>{files.length} files changed</strong>
            <span className="diff-count-add">+{files.reduce((n, f) => n + f.added, 0)}</span>
            <span className="diff-count-remove">−{files.reduce((n, f) => n + f.removed, 0)}</span>
            <button className="text-button" onClick={() => setOpen(true)}>
              View changes
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
              <span>{f.path}</span>
              <span className="diff-count-add">+{f.added}</span>
              <span className="diff-count-remove">−{f.removed}</span>
            </button>
          ))}
          {files.length > 3 && (
            <button className="text-button" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Show less' : `Show ${files.length - 3} more`}
            </button>
          )}
          {partial && <small>仅含已加载步骤的累计改动</small>}
        </div>
      )}
      <MotionPresence>
        {open && file && (
          <Modal title="本轮文件改动" wide onClose={() => setOpen(false)}>
            <p className="muted">已加载步骤累计，不是当前工作区净差异。</p>
            <div className="changes-tabs">
              {files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => setSelected(f.path)}
                  className={f.path === file.path ? 'selected' : ''}
                >
                  {f.path.split(/[\\/]/).pop()}
                </button>
              ))}
            </div>
            <p>{file.path}</p>
            <DiffText text={file.diffs.join('\n\n')} />
          </Modal>
        )}
      </MotionPresence>
    </>
  );
}

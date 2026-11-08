import { useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Session } from '../../workspace';
import { t } from '../../i18n';
import { attentionLabels, type TaskNotice } from './task-attention';

export function TaskBanners({
  notices,
  sessions,
  onOpen,
  onDismiss,
}: {
  notices: TaskNotice[];
  sessions: Session[];
  onOpen: (session: Session) => void;
  onDismiss: (id: string) => void;
}) {
  const notice = notices.at(-1);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => onDismiss(notice.id), 7000);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);
  const session = sessions.find((session) => session.sessionId === notice?.sessionId);
  if (!notice || !session) return null;
  return (
    <div className="task-banner-region" role="status" aria-live="polite">
      <button
        className="task-banner"
        onClick={() => {
          onOpen(session);
          onDismiss(notice.id);
        }}
      >
        <span>
          <strong>{t('Codex {{status}}', { status: attentionLabels[notice.kind] })}</strong>
          <small>{session.title || t('未命名会话')}</small>
        </span>
        <ChevronRight size={22} />
      </button>
    </div>
  );
}

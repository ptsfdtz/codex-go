import { t, useLocale } from '../../i18n';
import { CheckCircle2, CircleAlert, ShieldCheck, X } from 'lucide-react';
import type { Session } from '../../workspace';
import { attentionLabels, type TaskNotice } from './task-attention';
import './task-notifications.css';

export function TaskNotifications({
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
  useLocale();
  return (
    <div
      className="task-notifications"
      role="region"
      aria-label={t('任务提醒')}
      aria-live="polite"
      aria-relevant="additions text"
    >
      {notices
        .filter((notice) => notice.kind !== 'question')
        .map((notice) => {
          const session = sessions.find((s) => s.sessionId === notice.sessionId);
          const Icon =
            notice.kind === 'approval'
              ? ShieldCheck
              : notice.kind === 'completed'
                ? CheckCircle2
                : CircleAlert;
          return (
            <section
              className={`task-notification is-${notice.kind}`}
              key={notice.id}
              aria-label={attentionLabels[notice.kind]}
            >
              <Icon size={21} aria-hidden="true" />
              <div className="task-notification-content">
                <strong>{attentionLabels[notice.kind]}</strong>
                <p>{session?.title || t('未命名会话')}</p>
                <button
                  disabled={!session}
                  onClick={() => {
                    if (session) onOpen(session);
                  }}
                >
                  {notice.kind === 'approval' ? t('查看请求') : t('查看会话')}
                </button>
              </div>
              <button
                className="icon-button"
                aria-label={t('关闭提醒')}
                title={t('关闭提醒')}
                onClick={() => onDismiss(notice.id)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </section>
          );
        })}
    </div>
  );
}

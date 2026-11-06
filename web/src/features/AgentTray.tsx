import { useId } from 'react';
import { Bot, ChevronRight, LoaderCircle } from 'lucide-react';
import { t, useLocale } from '../i18n';
import { positionPopover, useMenuPopover } from '../components/popover';
import type { HistoryEntry } from '../history';
import { isSessionWorking, type Session } from '../workspace';

export function AgentTray({
  entries,
  sessions,
  onSelect,
}: {
  entries: HistoryEntry[];
  sessions: Session[];
  onSelect: (id: string) => void;
}) {
  const ids = [
    ...new Set(
      entries.flatMap(({ item }) =>
        item?.type === 'collabAgentToolCall'
          ? [
              item.agentThreadId,
              ...(Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []),
            ].filter((value): value is string => typeof value === 'string' && !!value)
          : [],
      ),
    ),
  ];
  if (!ids.length) return null;
  return <AgentTrayMenu ids={ids} sessions={sessions} onSelect={onSelect} />;
}

function AgentTrayMenu({
  ids,
  sessions,
  onSelect,
}: {
  ids: string[];
  sessions: Session[];
  onSelect: (id: string) => void;
}) {
  useLocale();
  const id = useId();
  const popup = useMenuPopover();
  return (
    <div className="agent-tray">
      <button
        className="agent-tray-trigger"
        popoverTarget={id}
        onClick={(event) => {
          if (popup.current)
            positionPopover(event.currentTarget, popup.current, { width: 280, preferAbove: true });
        }}
      >
        <Bot size={16} aria-hidden="true" />
        <span>{t('{{p0}} 个智能体', { p0: ids.length })}</span>
      </button>
      <div id={id} ref={popup} popover="auto" className="agent-tray-popup" aria-label={t('智能体')}>
        {ids.map((id) => {
          const session = sessions.find((item) => item.upstreamThreadId === id);
          return (
            <button
              key={id}
              disabled={!session}
              title={session?.title || id}
              onClick={() => {
                popup.current?.hidePopover();
                onSelect(id);
              }}
            >
              <Bot size={18} aria-hidden="true" />
              <span>{session?.title || t('尚未同步的智能体')}</span>
              {session && isSessionWorking(session) ? (
                <LoaderCircle className="pending-icon" size={16} aria-label={t('正在工作')} />
              ) : (
                <ChevronRight size={16} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import type { Request, Session } from '../workspace';

export type HistoryMatch = {
  sessionId: string;
  projectId: string;
  turnId: string;
  itemId: string;
  snippet: string;
  pageCursor: string | null;
};
type SearchPage = { matches: HistoryMatch[]; nextCursor: string | null; skippedSessions: number };

export function HistorySearch({
  query,
  request,
  sessions,
  onOpen,
}: {
  query: string;
  request: Request;
  sessions: Session[];
  onOpen: (match: HistoryMatch) => void;
}) {
  const [matches, setMatches] = useState<HistoryMatch[]>([]);
  const [cursor, setCursor] = useState<string | null>();
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const visibleSessions = useMemo(() => new Map(sessions.map((s) => [s.sessionId, s])), [sessions]);
  const generation = useRef(0);
  const running = useRef(false);
  const tooLong = Array.from(query.trim()).length > 128;
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function search() {
    if (!query.trim() || tooLong || running.current || cursor === null) return;
    const token = ++generation.current;
    running.current = true;
    setBusy(true);
    setError('');
    let next = cursor,
      count = 0;
    try {
      for (let batch = 0; batch < 12; batch++) {
        const page: SearchPage = await request('sessions.historySearch', {
          query,
          ...(next ? { cursor: next } : {}),
        });
        if (generation.current !== token) return;
        if (page.nextCursor && page.nextCursor === next)
          throw new Error(t('historySearch.cursorStalled'));
        setMatches((previous) => {
          const seen = new Set(
            previous.map((hit) => JSON.stringify([hit.sessionId, hit.turnId, hit.itemId])),
          );
          return [
            ...previous,
            ...page.matches.filter(
              (hit) => !seen.has(JSON.stringify([hit.sessionId, hit.turnId, hit.itemId])),
            ),
          ];
        });
        setSkipped((value) => value + page.skippedSessions);
        setCursor(page.nextCursor);
        count += page.matches.length;
        if (!page.nextCursor || count >= 20) break;
        next = page.nextCursor;
      }
    } catch (e) {
      if (generation.current === token) setError(String(e));
    } finally {
      if (generation.current === token) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="panel-stack">
      <button
        disabled={!query.trim() || tooLong || busy || cursor === null}
        onClick={() => void search()}
      >
        {cursor ? t('historySearch.continue') : t('historySearch.search')}
      </button>
      {tooLong && <small>{t('historySearch.queryTooLong')}</small>}
      {busy && (
        <button
          onClick={() => {
            generation.current++;
            running.current = false;
            setBusy(false);
          }}
        >
          {t('historySearch.cancel')}
        </button>
      )}
      <span role="status" className="muted">
        {busy
          ? t('historySearch.searching')
          : cursor === null
            ? matches.length || skipped
              ? t('historySearch.complete')
              : t('historySearch.noMatches')
            : cursor
              ? t('historySearch.partial')
              : ''}
      </span>
      {skipped > 0 && <small>{t('historySearch.skippedSessions', { count: skipped })}</small>}
      {error && <p role="alert">{error}</p>}
      {matches.map((hit) => {
        const session = visibleSessions.get(hit.sessionId);
        return (
          session &&
          session.projectId === hit.projectId && (
            <button
              className="search-result"
              key={JSON.stringify([hit.sessionId, hit.turnId, hit.itemId])}
              onClick={() => onOpen(hit)}
            >
              <strong>{session.title || t('未命名会话')}</strong>
              <span>{hit.snippet}</span>
            </button>
          )
        );
      })}
    </section>
  );
}

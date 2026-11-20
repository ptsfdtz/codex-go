import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import type { Host, Snapshot } from '../../workspace';
import { Bridge } from '../../transport/bridge';
import { getHostGrant } from '../../transport/host-grant';
import { readHistoryPage } from '../../history-page';
import type { HistoryEntry } from '../../history';
import { confirmedAnswers, messageQuestions } from '../question-replies';
import { attentionLabels } from './task-attention';

type InboxData = { snapshot: Snapshot; questions: Map<string, 'question' | 'check'> };
async function readInbox(
  connection: Bridge,
  active: () => boolean,
  publish: (data: InboxData) => void,
) {
  const snapshot = await connection.request<Snapshot>('snapshot.get');
  const questions = new Map<string, 'question' | 'check'>();
  const candidates = new Map<string, Set<string>>();
  const allowed = new Set(snapshot.sessions?.map((s) => s.sessionId));
  for (const q of snapshot.recentQuestions || []) {
    if (!allowed.has(q.sessionId)) continue;
    const ids = candidates.get(q.sessionId) || new Set<string>();
    ids.add(q.itemId);
    candidates.set(q.sessionId, ids);
  }
  // Surface pending approvals immediately, including on a slow history read.
  for (const id of candidates.keys()) questions.set(id, 'check');
  if (active()) publish({ snapshot, questions: new Map(questions) });
  for (const [sessionId, ids] of candidates) {
    if (!active()) break;
    questions.delete(sessionId);
    const entries: HistoryEntry[] = [];
    let cursor: string | undefined;
    try {
      for (let batch = 0; batch < 3 && active(); batch++) {
        const page = await readHistoryPage(connection, sessionId, cursor);
        entries.push(...page.data);
        for (const entry of page.data) {
          const id = entry.item?.id;
          if (!id || !ids.has(id)) continue;
          ids.delete(id);
          const fields = messageQuestions(entry);
          const answered = confirmedAnswers(entries, id);
          if (fields.some((q) => !answered.has(q.id))) questions.set(sessionId, 'question');
        }
        cursor = page.nextCursor;
        if (!cursor || !ids.size || questions.has(sessionId)) break;
      }
    } catch {
      questions.set(sessionId, 'check');
    }
    if (cursor && ids.size && !questions.has(sessionId)) questions.set(sessionId, 'check');
    if (active()) publish({ snapshot, questions: new Map(questions) });
  }
}
function PendingItems({ data, open }: { data: InboxData; open: (id: string) => void }) {
  const { snapshot, questions } = data;
  const kinds = new Map<string, 'question' | 'approval' | 'check'>(questions);
  for (const approval of snapshot.approvals || []) {
    if (approval.status && approval.status !== 'pending') continue;
    kinds.set(
      approval.sessionId,
      approval.method === 'item/tool/requestUserInput' ? 'question' : 'approval',
    );
  }
  const rows = (snapshot.sessions || []).filter((s) => kinds.has(s.sessionId));
  return rows.length ? (
    <>
      {rows.map((s) => (
        <button className="search-result" key={s.sessionId} onClick={() => open(s.sessionId)}>
          <strong>{s.title || t('未命名会话')}</strong>
          <small>
            {kinds.get(s.sessionId) === 'check'
              ? t('inbox.reviewQuestion')
              : attentionLabels[kinds.get(s.sessionId) as 'question' | 'approval']}
          </small>
        </button>
      ))}
    </>
  ) : (
    <span className="muted">{t('inbox.empty')}</span>
  );
}

export function AttentionInbox({
  hosts,
  currentId,
  currentBridge,
  currentSnapshot,
  scope,
  name,
  open,
}: {
  hosts: Host[];
  currentId?: string;
  currentSnapshot?: Snapshot;
  currentBridge?: Bridge;
  scope: string;
  name: (host: Host) => string;
  open: (host: Host, id: string) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [results, setResults] = useState<Record<string, InboxData | 'unavailable'>>({});
  const ids = JSON.stringify(
    hosts
      .filter((h) => h.online || h.hostId === currentId)
      .map((h) => h.hostId)
      .sort(),
  );
  useEffect(() => {
    let active = true;
    const readers = new Set<Bridge>();
    setResults({});
    const targets = (JSON.parse(ids) as string[]).filter((id) => id !== currentId);
    const publish = (id: string, data: InboxData | 'unavailable') => {
      if (active) setResults((previous) => ({ ...previous, [id]: data }));
    };
    async function readNextHost() {
      while (active) {
        const id = targets.shift();
        if (!id) return;
        let connection: Bridge | undefined;
        try {
          const grant = await getHostGrant(id);
          if (!active) return;
          connection = new Bridge(scope);
          readers.add(connection);
          await connection.connect(grant, { checkReceipts: false });
          if (active)
            await readInbox(
              connection,
              () => active,
              (data) => publish(id, data),
            );
        } catch {
          publish(id, 'unavailable');
        } finally {
          if (connection) {
            connection.close();
            readers.delete(connection);
          }
        }
      }
    }
    if (currentId && currentBridge)
      void readInbox(
        currentBridge,
        () => active,
        (data) => publish(currentId, data),
      ).catch(() => publish(currentId, 'unavailable'));
    for (let worker = 0, count = Math.min(3, targets.length); worker < count; worker++)
      void readNextHost();
    return () => {
      active = false;
      for (const connection of readers) connection.close();
    };
  }, [ids, scope, revision, currentId, currentBridge]);
  return (
    <div className="panel-stack">
      <button onClick={() => setRevision((x) => x + 1)}>{t('inbox.refresh')}</button>
      {!hosts.length && <p>{t('inbox.noHosts')}</p>}
      {hosts.map((h) => {
        const data = results[h.hostId];
        const unavailable = !h.online && h.hostId !== currentId;
        return (
          <section key={h.hostId} className="panel-stack">
            <h3>{name(h)}</h3>
            {unavailable ? (
              <p>{t('inbox.offline')}</p>
            ) : !data || data === 'unavailable' ? (
              <p role="status">{data === 'unavailable' ? t('inbox.unavailable') : t('加载中…')}</p>
            ) : (
              <PendingItems
                data={
                  h.hostId === currentId &&
                  currentSnapshot &&
                  Number(currentSnapshot.cursor) > Number(data.snapshot.cursor)
                    ? { ...data, snapshot: currentSnapshot }
                    : data
                }
                open={(id) => open(h, id)}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

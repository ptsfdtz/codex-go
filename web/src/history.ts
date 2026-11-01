import { t } from './i18n';
export type HistoryEntry = {
  turnId?: string;
  item?: { id?: string; [key: string]: unknown };
  startedAtMs?: number;
  completedAtMs?: number;
};
export type HistoryPage = {
  data?: HistoryEntry[];
  nextCursor?: string;
  resource?: {
    cursor?: string | null;
    sha256?: string;
    bytes?: number;
    turnId?: string;
    itemId?: string;
  } | null;
};

export function historyKey(entry: HistoryEntry): string {
  if (!entry.turnId || !entry.item?.id) throw new Error(t('历史条目缺少原生身份'));
  return JSON.stringify([entry.turnId, entry.item.id]);
}

// Both inputs are chronological. An older request must not overwrite a newer
// version of an item which arrived while that request was in flight.
export function mergeHistory(
  current: HistoryEntry[],
  incoming: HistoryEntry[],
  direction: 'latest' | 'older',
): HistoryEntry[] {
  const result = new Map<string, HistoryEntry>();
  const pages = direction === 'older' ? [incoming, current] : [current, incoming];
  for (const page of pages) for (const entry of page) result.set(historyKey(entry), entry);
  return [...result.values()];
}

export function withLiveText(
  entries: HistoryEntry[],
  live: Map<string, HistoryEntry>,
): HistoryEntry[] {
  const result = new Map(entries.map((entry) => [historyKey(entry), entry]));
  for (const [key, entry] of live) {
    const saved = result.get(key);
    if (!saved || String(saved.item?.text || '').length < String(entry.item?.text || '').length)
      result.set(key, entry);
  }
  return [...result.values()];
}

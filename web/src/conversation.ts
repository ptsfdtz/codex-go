import { historyKey, mergeHistory, type HistoryEntry } from './history';
import type { Packet } from './transport/bridge';

export function finalItem(entry?: HistoryEntry): boolean {
  return ['completed', 'failed', 'declined', 'interrupted'].includes(String(entry?.item?.status));
}

// A read can finish after streaming or completion events. Preserve concurrent
// updates, including a shorter final answer, instead of reverting to the snapshot.
export function mergeHistorySnapshot(
  current: HistoryEntry[],
  incoming: HistoryEntry[],
  atRequest: HistoryEntry[],
): HistoryEntry[] {
  const before = new Map(atRequest.map((entry) => [historyKey(entry), entry]));
  const concurrent = current.filter((entry) => before.get(historyKey(entry)) !== entry);
  const previous = new Map(current.map((entry) => [historyKey(entry), entry]));
  const merged = mergeHistory(mergeHistory(current, incoming, 'latest'), concurrent, 'latest').map(
    (entry) => {
      const old = previous.get(historyKey(entry));
      return old && JSON.stringify(old) === JSON.stringify(entry) ? old : entry;
    },
  );
  return merged.length === current.length &&
    merged.every((entry, index) => entry === current[index])
    ? current
    : merged;
}

export function historyError(error: unknown): string {
  const message = String(error);
  if (message.includes('WORKSPACE_FORBIDDEN'))
    return '无法读取此会话：工作目录已变化或不在电脑授权范围内。请在电脑端核对目录并同步工作区，或选择其他会话。';
  return `会话历史读取失败：${message}`;
}

// Use upstream turn/item identities. Tool and reasoning deltas must never be
// appended to the assistant's answer, and local Bridge turn IDs are not native IDs.
export function applyProgress(entries: HistoryEntry[], packet: Packet): HistoryEntry[] {
  const payload = packet.payload;
  if (!payload) return entries;
  const turnId = payload.upstreamTurnId || payload.turnId;
  if (typeof turnId !== 'string') return entries;
  if (['item/started', 'item/completed'].includes(String(payload.method))) {
    const item = payload.item as HistoryEntry['item'];
    if (!item || typeof item.id !== 'string') return entries;
    const old = entries.find((entry) => entry.turnId === turnId && entry.item?.id === item.id);
    if (payload.method === 'item/started' && finalItem(old)) return entries;
    return mergeHistory(
      entries,
      [
        {
          turnId,
          item: {
            ...item,
            status:
              item.status || (payload.method === 'item/completed' ? 'completed' : 'inProgress'),
          },
        },
      ],
      'latest',
    );
  }
  if (payload.method === 'turn/plan/updated' && Array.isArray(payload.plan)) {
    return mergeHistory(
      entries,
      [
        {
          turnId,
          item: {
            id: `${turnId}:plan`,
            type: 'plan',
            text: payload.explanation || '',
            plan: payload.plan,
          },
        },
      ],
      'latest',
    );
  }
  if (typeof payload.itemId !== 'string') return entries;
  const entry: HistoryEntry = { turnId, item: { id: payload.itemId } };
  const previous = entries.find((item) => historyKey(item) === historyKey(entry));
  if (finalItem(previous)) return entries;
  const method = String(payload.method),
    delta = payload.delta;
  const item = { ...previous?.item, id: payload.itemId, status: 'inProgress' } as NonNullable<
    HistoryEntry['item']
  >;
  if (
    ['item/agentMessage/delta', 'item/plan/delta'].includes(method) &&
    typeof delta === 'string'
  ) {
    item.type = method === 'item/plan/delta' ? 'plan' : 'agentMessage';
    item.text = String(item.text || '') + delta;
  } else if (
    ['item/commandExecution/outputDelta', 'item/fileChange/outputDelta'].includes(method) &&
    typeof delta === 'string'
  ) {
    item.type ||= method.includes('commandExecution') ? 'commandExecution' : 'fileChange';
    item.aggregatedOutput = (String(item.aggregatedOutput || '') + delta).slice(-128000);
  } else if (
    method.startsWith('item/reasoning/') &&
    (typeof delta === 'string' || method.endsWith('/summaryPartAdded'))
  ) {
    const summary = method !== 'item/reasoning/textDelta';
    const index = payload[summary ? 'summaryIndex' : 'contentIndex'];
    if (!Number.isInteger(index) || Number(index) < 0 || Number(index) > 127) return entries;
    const field = summary ? 'summary' : 'content';
    const parts = [...(Array.isArray(item[field]) ? (item[field] as string[]) : [])];
    while (parts.length <= Number(index)) parts.push('');
    parts[Number(index)] = (String(parts[Number(index)] || '') + String(delta || '')).slice(
      -128000,
    );
    item.type = 'reasoning';
    item[field] = parts;
  } else if (method === 'item/mcpToolCall/progress' && typeof payload.message === 'string') {
    item.type ||= 'mcpToolCall';
    item.output = [String(item.output || ''), payload.message]
      .filter(Boolean)
      .join('\n')
      .slice(-128000);
  } else if (method === 'item/fileChange/patchUpdated' && Array.isArray(payload.changes)) {
    item.type = 'fileChange';
    item.changes = payload.changes;
  } else return entries;
  entry.item = item;
  return mergeHistory(entries, [entry], 'latest');
}

import { historyKey, mergeHistory, type HistoryEntry } from './history';
import type { Packet } from './transport/bridge';

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
  if (!payload || typeof payload.turnId !== 'string') return entries;
  const turnId = payload.turnId;
  if (['item/started', 'item/completed'].includes(String(payload.method))) {
    const item = payload.item as HistoryEntry['item'];
    if (!item || typeof item.id !== 'string') return entries;
    return mergeHistory(entries, [{ turnId, item }], 'latest');
  }
  if (
    payload.method !== 'item/agentMessage/delta' ||
    typeof payload.itemId !== 'string' ||
    typeof payload.delta !== 'string'
  )
    return entries;
  const entry: HistoryEntry = { turnId, item: { id: payload.itemId } };
  const previous = entries.find((item) => historyKey(item) === historyKey(entry));
  entry.item = {
    ...previous?.item,
    id: payload.itemId,
    type: 'agentMessage',
    text: String(previous?.item?.text || '') + payload.delta,
  };
  return mergeHistory(entries, [entry], 'latest');
}

import type { HistoryEntry } from '../history';

export function isAssistant(entry: HistoryEntry): boolean {
  return (
    ['agentMessage', 'assistantMessage'].includes(String(entry.item?.type)) ||
    entry.item?.role === 'assistant'
  );
}

export function answerActions(
  entries: HistoryEntry[],
  activeTurn: string | undefined,
  text: (item: HistoryEntry['item']) => string,
): Map<HistoryEntry, string> {
  const turns = new Map<string, { last: HistoryEntry; parts: string[] }>();
  for (const entry of entries) {
    if (!entry.turnId || entry.turnId === activeTurn || !isAssistant(entry)) continue;
    const value = text(entry.item);
    if (!value) continue;
    const turn = turns.get(entry.turnId) || { last: entry, parts: [] };
    turn.last = entry;
    turn.parts.push(value);
    turns.set(entry.turnId, turn);
  }
  return new Map([...turns.values()].map(({ last, parts }) => [last, parts.join('\n\n')]));
}

import { useCallback, useRef, useState, type SetStateAction } from 'react';
import type { HistoryEntry } from '../history';

// Event consumers need the latest committed-to-view value even before React
// renders a batch. Both primary and side conversations use the same contract.
export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const current = useRef(entries);
  const [revision, setRevision] = useState(0);
  const update = useCallback((value: SetStateAction<HistoryEntry[]>, progress = false) => {
    const next = typeof value === 'function' ? value(current.current) : value;
    if (next === current.current) return;
    current.current = next;
    setEntries(next);
    if (progress) setRevision((value) => value + 1);
  }, []);
  return { entries, current, revision, update };
}

import { historyKey, type HistoryEntry } from '../history';
export type ChangedFile = { path: string; added: number; removed: number; diffs: string[] };
export function turnChanges(entries: HistoryEntry[]) {
  const files = new Map<string, ChangedFile>(),
    seen = new Set<string>();
  for (const entry of entries) {
    const key = historyKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    const item = entry.item;
    if (
      item?.type !== 'fileChange' ||
      ['failed', 'inProgress', 'running', 'declined'].includes(String(item.status))
    )
      continue;
    if (!Array.isArray(item.changes)) continue;
    for (const change of item.changes) {
      if (typeof change?.path !== 'string' || !change.path) continue;
      const diff = typeof change.diff === 'string' ? change.diff : '';
      const file: ChangedFile = files.get(change.path) || {
        path: change.path,
        added: 0,
        removed: 0,
        diffs: [],
      };
      for (const line of diff.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) file.added++;
        if (line.startsWith('-') && !line.startsWith('---')) file.removed++;
      }
      file.diffs.push(diff);
      files.set(file.path, file);
    }
  }
  return [...files.values()];
}
export function workDuration(entries: HistoryEntry[]) {
  const starts: number[] = [],
    ends: number[] = [];
  for (const entry of entries) {
    if (entry.item?.type === 'userMessage') continue;
    const value = entry as HistoryEntry & { startedAtMs?: number; completedAtMs?: number };
    if (typeof value.startedAtMs === 'number' && value.startedAtMs >= 0)
      starts.push(value.startedAtMs);
    if (typeof value.completedAtMs === 'number' && value.completedAtMs >= 0)
      ends.push(value.completedAtMs);
  }
  if (!starts.length || !ends.length) return;
  const seconds = Math.max(0, Math.round((Math.max(...ends) - Math.min(...starts)) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
export function projectRelativePath(path: string, root?: string) {
  let clean = path.replace(/^file:\/\//i, '').replaceAll('\\', '/');
  try {
    clean = decodeURIComponent(clean).replaceAll('\\', '/');
  } catch {
    return;
  }
  // A line/column suffix is navigation metadata, not part of the file name.
  clean = clean.replace(/(?:#L\d+|:\d+(?::\d+)?)$/, '');
  const base = root?.replaceAll('\\', '/').replace(/\/$/, '');
  if (/^(?:\/?[A-Za-z]:|\/)/.test(clean)) {
    if (!base) return;
    if (clean.startsWith('/') && /^[A-Za-z]:/.test(base)) clean = clean.slice(1);
    const windows = /^[A-Za-z]:/.test(base),
      a = windows ? clean.toLowerCase() : clean,
      b = windows ? base.toLowerCase() : base;
    if (!a.startsWith(b + '/')) return;
    clean = clean.slice(base.length + 1);
  }
  if (
    !clean ||
    clean.includes(':') ||
    clean.split('/').some((part) => !part || part === '.' || part === '..') ||
    [...clean].some((c) => c.charCodeAt(0) < 32)
  )
    return;
  return clean;
}

export type FileEntry = { name: string; path: string; kind: 'directory' | 'file'; size?: number };
export type GitFile = {
  fileId: string;
  path: string;
  oldPath?: string;
  index?: string;
  worktree?: string;
  untracked?: boolean;
};
export type GitStatus = { available: boolean; files: GitFile[]; truncated?: boolean };
export type FileTab = { path: string; view: 'file' | 'diff' | 'changes' };
export type WorkspaceState = { tabs: FileTab[]; active: string };
export const MAX_TABS = 12;

export function validFilePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= 4096 &&
    !/[\\:]/.test(path) &&
    ![...path].some((char) => char.charCodeAt(0) < 32) &&
    path.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}
export function parentPaths(path: string): string[] {
  return path
    .split('/')
    .slice(0, -1)
    .slice(0, 32)
    .map((_, index, parts) => parts.slice(0, index + 1).join('/'));
}
export function openTab(state: WorkspaceState, tab: FileTab): WorkspaceState {
  const existing = state.tabs.findIndex((item) => item.path === tab.path);
  const tabs = [...state.tabs];
  if (existing >= 0) tabs[existing] = tab;
  else {
    if (tabs.length >= MAX_TABS)
      tabs.splice(
        Math.max(
          0,
          tabs.findIndex((item) => item.path !== state.active),
        ),
        1,
      );
    tabs.push(tab);
  }
  return { tabs, active: tab.path };
}
export function closeTab(state: WorkspaceState, path: string): WorkspaceState {
  const index = state.tabs.findIndex((item) => item.path === path);
  const tabs = state.tabs.filter((item) => item.path !== path);
  return {
    tabs,
    active:
      state.active === path ? (tabs[Math.min(index, tabs.length - 1)]?.path ?? '') : state.active,
  };
}
export function restoreWorkspace(value: string | null): WorkspaceState {
  try {
    const stored = JSON.parse(value || 'null');
    const tabs: FileTab[] = [];
    for (const item of Array.isArray(stored?.tabs) ? stored.tabs.slice(0, MAX_TABS) : []) {
      if (
        ((item?.view === 'changes' && item.path === '') ||
          (validFilePath(item?.path) && ['file', 'diff'].includes(item.view))) &&
        !tabs.some((tab) => tab.path === item.path)
      )
        tabs.push({ path: item.path, view: item.view });
    }
    return {
      tabs,
      active: tabs.some((tab) => tab.path === stored?.active)
        ? stored.active
        : (tabs[0]?.path ?? ''),
    };
  } catch {
    return { tabs: [], active: '' };
  }
}
export function gitLabel(file: GitFile): string {
  if (file.untracked) return 'U';
  const status = `${file.index || ''}${file.worktree || ''}`;
  return ['D', 'R', 'C', 'A', 'M', 'U'].find((value) => status.includes(value)) || 'M';
}

export type DiffLine = {
  text: string;
  kind: 'add' | 'remove' | 'hunk' | 'meta' | 'context';
  old?: number;
  next?: number;
};
export function diffLines(text: string, untracked = false): DiffLine[] {
  let old = 0,
    next = 0,
    inHunk = false;
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      if (untracked) return { text: `+${line}`, kind: 'add', next: ++next };
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (hunk) {
        old = Number(hunk[1]);
        next = Number(hunk[2]);
        inHunk = true;
        return { text: line, kind: 'hunk' };
      }
      if (line.startsWith('diff --git ')) {
        inHunk = false;
        return { text: line, kind: 'meta' };
      }
      if (inHunk && line.startsWith('+')) return { text: line, kind: 'add', next: next++ };
      if (inHunk && line.startsWith('-')) return { text: line, kind: 'remove', old: old++ };
      if (inHunk && line.startsWith(' '))
        return { text: line, kind: 'context', old: old++, next: next++ };
      return { text: line, kind: 'meta' };
    });
}

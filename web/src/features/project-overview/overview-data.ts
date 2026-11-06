import type { HistoryEntry } from '../../history';
import type { Attachment, Draft, Project } from '../../workspace';
import { fileReferencePart } from '../../content-text';
import { projectRelativePath } from '../turn-changes';
import { validFilePath } from '../files/workspace-state';

export type OverviewSource = { id: string; name: string } & (
  | { kind: 'file'; path: string }
  | { kind: 'draft-image'; attachment: Attachment }
  | { kind: 'history-image'; entry: HistoryEntry; index: number }
);

export function overviewData(history: HistoryEntry[], draft: Draft | undefined, project: Project) {
  const processes = history.filter(
    (entry) =>
      entry.item?.type === 'commandExecution' &&
      ['inProgress', 'running'].includes(String(entry.item.status)) &&
      !entry.completedAtMs &&
      typeof entry.item.command === 'string' &&
      entry.item.command.trim(),
  );
  const sources = new Map<string, OverviewSource>();
  function file(path: string, name: string) {
    const relative = projectRelativePath(path, project.canonicalPath || '');
    if (!relative || !validFilePath(relative)) return;
    sources.set(`file:${relative}`, { id: `file:${relative}`, kind: 'file', name, path: relative });
  }
  for (const entry of history) {
    if (entry.item?.type !== 'userMessage' && entry.item?.role !== 'user') continue;
    if (!Array.isArray(entry.item.content)) continue;
    entry.item.content.forEach((part: Record<string, unknown>, index: number) => {
      if (!part || typeof part !== 'object') return;
      const reference = fileReferencePart(part);
      if (reference) file(reference.path, reference.name);
      if (part.type === 'localImage' && entry.turnId && entry.item?.id) {
        const path = typeof part.path === 'string' ? part.path : '';
        const name = path.split(/[\\/]/).pop() || '';
        const id = `image:${JSON.stringify([entry.turnId, entry.item.id, index])}`;
        sources.set(id, { id, kind: 'history-image', name, entry, index });
      }
    });
  }
  for (const reference of draft?.references || []) {
    if (reference.projectId === project.projectId && validFilePath(reference.path))
      sources.set(`file:${reference.path}`, {
        id: `file:${reference.path}`,
        kind: 'file',
        name: reference.name,
        path: reference.path,
      });
  }
  for (const attachment of draft?.attachments || []) {
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(attachment.mime)) continue;
    const id = `draft:${attachment.name}`;
    sources.set(id, { id, kind: 'draft-image', name: attachment.name, attachment });
  }
  return { processes, sources: [...sources.values()].reverse() };
}

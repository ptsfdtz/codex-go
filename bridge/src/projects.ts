import { realpath, stat, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, basename, parse, join } from 'node:path';
import type { Project } from '@agentdeck/protocol';
import { Store, now, uid } from './store.js';
import { invariant } from './errors.js';

export function within(root: string, target: string): boolean {
  const path = relative(root, target);
  return (
    path === '' ||
    (!path.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) &&
      path !== '..' &&
      !isAbsolute(path))
  );
}
export function validLocalPath(path: string): void {
  invariant(
    isAbsolute(path) && !path.includes('\0'),
    'WORKSPACE_FORBIDDEN',
    'Absolute local path required',
  );
  if (process.platform === 'win32')
    invariant(
      /^[A-Za-z]:[\\/]/.test(path) && !path.slice(2).includes(':'),
      'WORKSPACE_FORBIDDEN',
      'UNC, device and alternate stream paths are forbidden',
    );
}
export class ProjectRegistry {
  constructor(private readonly store: Store) {}
  async addLocal(path: string): Promise<Project> {
    validLocalPath(path);
    const canonicalPath = await realpath(path);
    validLocalPath(canonicalPath);
    const info = await stat(canonicalPath, { bigint: true });
    invariant(
      info.isDirectory() && parse(canonicalPath).root !== canonicalPath,
      'WORKSPACE_FORBIDDEN',
      'Choose a project folder, not a drive root',
    );
    const identity = `${info.dev}:${info.ino}`;
    const existing = this.store.db
      .prepare('SELECT projectId FROM projects WHERE canonicalPath=?')
      .get(canonicalPath) as { projectId: string } | undefined;
    const projectId = existing?.projectId ?? uid('project');
    this.store.db
      .prepare(
        'INSERT INTO projects(projectId,name,canonicalPath,identity,enabled,createdAt) VALUES(?,?,?,?,1,?) ON CONFLICT(canonicalPath) DO UPDATE SET identity=excluded.identity,enabled=1',
      )
      .run(projectId, basename(canonicalPath), canonicalPath, identity, now());
    this.store.append('projects.updated', {});
    return this.store.projects().find((p) => p.projectId === projectId)!;
  }
  async root(projectId: string): Promise<string> {
    const project = this.store.project(projectId);
    const path = String(project.canonicalPath);
    const current = await realpath(path);
    const info = await stat(current, { bigint: true });
    invariant(
      current.toLowerCase() === path.toLowerCase() &&
        `${info.dev}:${info.ino}` === project.identity &&
        info.isDirectory(),
      'WORKSPACE_FORBIDDEN',
      'Authorized folder identity changed; reauthorize locally',
    );
    return current;
  }
  async file(projectId: string, file: string): Promise<string> {
    invariant(
      file.length > 0 && !isAbsolute(file) && !file.includes('\0') && !file.includes(':'),
      'WORKSPACE_FORBIDDEN',
      'Invalid relative file',
    );
    const root = await this.root(projectId);
    const target = resolve(root, file);
    invariant(within(root, target), 'WORKSPACE_FORBIDDEN', 'Path leaves authorized workspace');
    // Check each existing component; do not follow a junction to another workspace.
    let cursor = root;
    for (const component of relative(root, target).split(/[\\/]/)) {
      cursor = join(cursor, component);
      try {
        await lstat(cursor);
        const canonical = await realpath(cursor);
        invariant(
          within(root, canonical),
          'WORKSPACE_FORBIDDEN',
          'Link leaves authorized workspace',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
    }
    return target;
  }
  removeLocal(projectId: string): void {
    invariant(
      !this.store
        .turns()
        .some(
          (t) =>
            this.store.session(t.sessionId).projectId === projectId &&
            ['queued', 'running', 'waitingApproval', 'unknown'].includes(t.status),
        ),
      'CONFLICT',
      'Interrupt or reconcile active tasks before removing a project',
    );
    this.store.db.prepare('UPDATE projects SET enabled=0 WHERE projectId=?').run(projectId);
    this.store.append('projects.updated', {});
  }
}

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { relative, dirname } from 'node:path';
import { ProjectRegistry, within } from './projects.js';
import { invariant, DeckError } from './errors.js';
import { redact } from './log.js';

export interface GitEntry {
  fileId: string;
  path: string;
  oldPath?: string;
  index: string;
  worktree: string;
  untracked: boolean;
  link: boolean;
}
export function parseStatus(data: Buffer): Omit<GitEntry, 'fileId' | 'link'>[] {
  const entries: Omit<GitEntry, 'fileId' | 'link'>[] = [];
  const parts = data.toString('utf8').split('\0');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || part.length < 4) continue;
    const index = part[0]!;
    const worktree = part[1]!;
    const path = part.slice(3);
    const oldPath =
      index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C'
        ? parts[++i]
        : undefined;
    entries.push({
      path,
      ...(oldPath ? { oldPath } : {}),
      index,
      worktree,
      untracked: index === '?' && worktree === '?',
    });
  }
  return entries;
}
export function gitCommand(
  root: string,
  args: string[],
  maxBytes = 2 * 1024 * 1024,
  timeout = 10000,
): Promise<{ data: Buffer; truncated: boolean; code: number }> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'cat',
      GIT_OPTIONAL_LOCKS: '0',
    };
    for (const name of Object.keys(env))
      if (
        /^GIT_/i.test(name) &&
        ![
          'GIT_CONFIG_NOSYSTEM',
          'GIT_CONFIG_GLOBAL',
          'GIT_TERMINAL_PROMPT',
          'GIT_PAGER',
          'GIT_OPTIONAL_LOCKS',
        ].includes(name)
      )
        delete env[name];
    const child = spawn(
      'git',
      [
        '--no-optional-locks',
        '-c',
        'core.pager=cat',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.untrackedCache=false',
        '-c',
        'diff.external=',
        '-c',
        'core.hooksPath=',
        '-C',
        root,
        ...args,
      ],
      { shell: false, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks: Buffer[] = [];
    let count = 0;
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.stdout.on('data', (chunk: Buffer) => {
      const remaining = Math.max(0, maxBytes - count);
      if (remaining) chunks.push(chunk.subarray(0, remaining));
      count += chunk.length;
      if (count > maxBytes) {
        truncated = true;
        child.kill();
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      reject(new DeckError('GIT_UNAVAILABLE', 'Git executable could not be started'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new DeckError('UPSTREAM_TIMEOUT', 'Git operation timed out', true));
      else resolve({ data: Buffer.concat(chunks), truncated, code: code ?? (truncated ? 0 : 1) });
    });
  });
}
export class GitService {
  private entries = new Map<string, { projectId: string; entry: GitEntry }>();
  constructor(private readonly projects: ProjectRegistry) {}
  async changeToken(projectId: string, files: GitEntry[]): Promise<string> {
    const hash = createHash('sha256');
    await this.projects.root(projectId);
    for (const name of ['.git/index', ...files.map((file) => file.path)]) {
      hash.update(name);
      try {
        const path = await this.projects.file(projectId, name);
        const info = await lstat(path, { bigint: true });
        hash.update(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`);
      } catch {
        hash.update('unavailable');
      }
    }
    return hash.digest('hex');
  }
  async status(projectId: string): Promise<{
    available: boolean;
    files: GitEntry[];
    truncated: boolean;
    attribution: string;
    baseline: string | null;
  }> {
    const root = await this.projects.root(projectId);
    const top = await gitCommand(root, ['rev-parse', '--show-toplevel']);
    if (top.code !== 0)
      return {
        available: false,
        files: [],
        truncated: false,
        attribution: 'working-tree',
        baseline: null,
      };
    const gitRoot = await realpath(top.data.toString('utf8').trim());
    invariant(
      gitRoot.toLowerCase() === root.toLowerCase(),
      'WORKSPACE_FORBIDDEN',
      'Authorize the Git worktree root to review this repository',
    );
    // Git directory references outside the root are not readable through this service.
    const gd = await gitCommand(root, ['rev-parse', '--absolute-git-dir']);
    invariant(
      gd.code === 0 && within(root, await realpath(gd.data.toString('utf8').trim())),
      'WORKSPACE_FORBIDDEN',
      'External Git metadata is not authorized',
    );
    const result = await gitCommand(root, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--ignore-submodules=all',
    ]);
    invariant(result.code === 0 || result.truncated, 'GIT_UNAVAILABLE', 'Git status failed');
    const parsed = parseStatus(
      result.truncated
        ? result.data.subarray(0, Math.max(0, result.data.lastIndexOf(0) + 1))
        : result.data,
    );
    for (const [id, known] of this.entries)
      if (known.projectId === projectId) this.entries.delete(id);
    const files: GitEntry[] = [];
    for (const entry of parsed.slice(0, 2000)) {
      try {
        const path = await this.projects.file(projectId, entry.path);
        if (entry.oldPath) await this.projects.file(projectId, entry.oldPath);
        let link = false;
        try {
          link = (await lstat(path)).isSymbolicLink();
        } catch {
          /* deleted file */
        }
        const fileId = createHash('sha256')
          .update(projectId + '\0' + entry.path)
          .digest('hex');
        const file = { ...entry, fileId, link };
        this.entries.set(fileId, { projectId, entry: file });
        files.push(file);
      } catch {
        /* unsafe paths do not become remotely readable entries */
      }
    }
    const head = await gitCommand(root, ['rev-parse', '--verify', 'HEAD'], 256);
    while (this.entries.size > 5000) this.entries.delete(this.entries.keys().next().value!);
    return {
      available: true,
      files,
      truncated: result.truncated || parsed.length > 2000,
      attribution: 'working-tree; may include external changes',
      baseline: head.code === 0 ? head.data.toString().trim() : null,
    };
  }
  async diff(projectId: string, fileId: string): Promise<Record<string, unknown>> {
    await this.status(projectId);
    const known = this.entries.get(fileId);
    invariant(
      known?.projectId === projectId,
      'NOT_FOUND',
      'File entry is unavailable; refresh Git status',
    );
    const root = await this.projects.root(projectId);
    const file = await this.projects.file(projectId, known.entry.path);
    invariant(!known.entry.link, 'WORKSPACE_FORBIDDEN', 'Symlink target content is not exposed');
    if (known.entry.untracked) {
      const info = await lstat(file);
      invariant(
        info.isFile() && !info.isSymbolicLink(),
        'WORKSPACE_FORBIDDEN',
        'Not a regular file',
      );
      const parent = await realpath(dirname(file));
      invariant(within(root, parent), 'WORKSPACE_FORBIDDEN', 'File parent leaves workspace');
      const handle = await open(file, 'r');
      try {
        const after = await handle.stat();
        invariant(
          after.ino === info.ino && after.dev === info.dev,
          'WORKSPACE_FORBIDDEN',
          'File changed during review',
        );
        const bytes = Buffer.alloc(Math.min(after.size, 256 * 1024));
        const read = await handle.read(bytes, 0, bytes.length, 0);
        const data = bytes.subarray(0, read.bytesRead);
        return {
          path: relative(root, file),
          untracked: true,
          binary: data.includes(0),
          truncated: after.size > data.length,
          text: data.includes(0) ? '' : redact(data.toString('utf8')),
          attribution: 'working-tree',
        };
      } finally {
        await handle.close();
      }
    }
    const paths = known.entry.oldPath
      ? [known.entry.oldPath, known.entry.path]
      : [known.entry.path];
    const unstaged = await gitCommand(
      root,
      ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--', ...paths],
      128 * 1024,
    );
    const staged = await gitCommand(
      root,
      ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '--', ...paths],
      128 * 1024,
    );
    invariant(
      (unstaged.code === 0 || unstaged.truncated) && (staged.code === 0 || staged.truncated),
      'GIT_UNAVAILABLE',
      'Git diff failed',
    );
    const text = staged.data.toString('utf8') + unstaged.data.toString('utf8');
    return {
      path: known.entry.path,
      text: redact(text),
      binary: text.includes('Binary files '),
      truncated: staged.truncated || unstaged.truncated,
      attribution: 'working-tree; may include external changes',
    };
  }
}

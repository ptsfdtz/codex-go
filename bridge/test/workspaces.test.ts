import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, join, parse } from 'node:path';
import { tmpdir } from 'node:os';
import {
  discoverWorkspaces,
  syncWorkspacesLocal,
  type WorkspaceReader,
} from '../src/workspaces.js';
import { ProjectRegistry } from '../src/projects.js';
import { Store } from '../src/store.js';

const samples = JSON.parse(
  readFileSync(new URL('./fixtures/protocol-samples.json', import.meta.url), 'utf8').replace(
    /^\uFEFF/,
    '',
  ),
);
const roots: string[] = [];
const stores: Store[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) s.close();
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  await mkdir(resolve('artifacts'), { recursive: true });
  const root = await mkdtemp(resolve('artifacts/workspace-sync-test-'));
  roots.push(root);
  const first = join(root, 'first'),
    second = join(root, 'second');
  await mkdir(first);
  await mkdir(second);
  return { root, first, second };
}
function thread(cwd: string) {
  return { ...structuredClone(samples.threadStart.thread), cwd };
}
function reader(
  configured: Record<string, unknown>,
  pages: (params: Record<string, unknown>) => unknown,
) {
  const request = vi.fn(async (method: string, params: Record<string, unknown>) =>
    method === 'config/read'
      ? { config: { projects: configured }, origins: {}, layers: null }
      : pages(params),
  );
  return {
    reader: { rpc: { request }, requireReady: vi.fn() } as unknown as WorkspaceReader,
    request,
  };
}
function page(paths: string[], nextCursor: string | null = null) {
  return { data: paths.map(thread), nextCursor, backwardsCursor: null };
}
describe('Windows-local Codex workspace sync', () => {
  it('paginates all providers and interactive sources, includes archived directories and deduplicates canonical paths', async () => {
    const { root, first, second } = await fixture();
    const alias = join(root, 'alias');
    await symlink(first, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const { reader: upstream, request } = reader({ [alias]: { trust_level: 'trusted' } }, (p) =>
      p.archived ? page([second]) : p.cursor ? page([alias]) : page([first], 'next'),
    );
    const found = await discoverWorkspaces(upstream);
    expect(found.paths).toHaveLength(2);
    expect(found.skipped).toBe(0);
    expect(request.mock.calls.filter(([m]) => m === 'thread/list').map(([, p]) => p)).toEqual([
      {
        cursor: null,
        limit: 100,
        modelProviders: [],
        sourceKinds: ['cli', 'vscode', 'appServer'],
        archived: false,
      },
      {
        cursor: 'next',
        limit: 100,
        modelProviders: [],
        sourceKinds: ['cli', 'vscode', 'appServer'],
        archived: false,
      },
      {
        cursor: null,
        limit: 100,
        modelProviders: [],
        sourceKinds: ['cli', 'vscode', 'appServer'],
        archived: true,
      },
    ]);
    const store = new Store(':memory:');
    stores.push(store);
    const registry = new ProjectRegistry(store);
    expect(store.projects()).toEqual([]); // discovery alone never grants access
    const synced = await syncWorkspacesLocal(upstream, registry);
    expect(synced.synced).toBe(2);
    await syncWorkspacesLocal(upstream, registry);
    expect(store.projects()).toHaveLength(2);
  });
  it('skips missing, temporary, relative and drive-root directories without importing untrusted config entries', async () => {
    const { root, first, second } = await fixture();
    const { reader: upstream } = reader(
      { [first]: { trust_level: 'trusted' }, [second]: { trust_level: 'untrusted' } },
      () => page([join(root, 'missing'), tmpdir(), '../escape', parse(root).root]),
    );
    const found = await discoverWorkspaces(upstream);
    expect(found.paths).toEqual([first]);
    expect(found.skipped).toBe(4);
  });
  it('fails before any local grant on repeated cursors or malformed upstream contracts', async () => {
    const { first } = await fixture();
    const { reader: upstream } = reader({}, () => page([first], 'repeat'));
    const store = new Store(':memory:');
    stores.push(store);
    await expect(syncWorkspacesLocal(upstream, new ProjectRegistry(store))).rejects.toMatchObject({
      code: 'UPSTREAM_PROTOCOL_ERROR',
    });
    expect(store.projects()).toEqual([]);
    const malformed = reader({}, () => ({ data: [{ cwd: first }], nextCursor: null }));
    await expect(discoverWorkspaces(malformed.reader)).rejects.toMatchObject({
      code: 'UPSTREAM_PROTOCOL_ERROR',
    });
  });
});

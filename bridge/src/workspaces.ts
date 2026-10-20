import { realpath, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import type { ConfigReadResponse } from '../generated/codex/v2/ConfigReadResponse.js';
import type { ThreadListParams } from '../generated/codex/v2/ThreadListParams.js';
import type { ThreadListResponse } from '../generated/codex/v2/ThreadListResponse.js';
import type { Supervisor } from './codex.js';
import { validateContract } from './contracts.js';
import { invariant } from './errors.js';
import { ProjectRegistry, validLocalPath, within } from './projects.js';

export type WorkspaceReader = Pick<Supervisor, 'rpc' | 'requireReady'>;
export type WorkspaceDiscovery = { paths: string[]; skipped: number };

// Read only documented/generated contracts. Never inspect Desktop's private state or login files.
export async function discoverWorkspaces(upstream: WorkspaceReader): Promise<WorkspaceDiscovery> {
  upstream.requireReady();
  const config = await upstream.rpc.request('config/read', { includeLayers: false });
  validateContract('v2/ConfigReadResponse', config);
  const configured = (config as ConfigReadResponse).config.projects;
  const paths = new Set<string>();
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
    for (const [path, value] of Object.entries(configured)) {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        value.trust_level === 'trusted'
      )
        paths.add(path);
    }
  }
  const started = Date.now();
  for (const archived of [false, true]) {
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; ; page++) {
      invariant(
        page < 100 && Date.now() - started < 60000,
        'SYNC_LIMIT',
        '项目记录过多，请稍后重试；尚未更改授权。',
      );
      upstream.requireReady();
      const params: ThreadListParams = {
        cursor,
        limit: 100,
        modelProviders: [],
        sourceKinds: ['cli', 'vscode', 'appServer'],
        archived,
      };
      const response = await upstream.rpc.request('thread/list', params, 15000);
      validateContract('v2/ThreadListResponse', response);
      const result = response as ThreadListResponse;
      for (const thread of result.data) paths.add(thread.cwd);
      invariant(
        paths.size <= 1000,
        'SYNC_LIMIT',
        '发现超过 1,000 个目录，请在更多菜单中单独添加项目。',
      );
      cursor = result.nextCursor;
      if (!cursor) break;
      invariant(!seen.has(cursor), 'UPSTREAM_PROTOCOL_ERROR', 'Codex 项目分页重复，请重试。');
      seen.add(cursor);
    }
  }
  const safe = new Map<string, string>();
  let skipped = 0;
  const excluded = [
    await realpath(tmpdir()),
    await realpath(process.env.CODEX_HOME ?? join(homedir(), '.codex')).catch(() =>
      join(homedir(), '.codex'),
    ),
  ];
  for (const path of paths) {
    try {
      validLocalPath(path);
      const canonical = await realpath(path);
      validLocalPath(canonical);
      invariant(
        (await stat(canonical)).isDirectory() &&
          canonical !== parse(canonical).root &&
          canonical.toLowerCase() !== homedir().toLowerCase() &&
          !excluded.some((root) => within(root, canonical)),
        'WORKSPACE_FORBIDDEN',
        '非项目目录',
      );
      safe.set(process.platform === 'win32' ? canonical.toLowerCase() : canonical, canonical);
    } catch {
      skipped++;
    }
  }
  return { paths: [...safe.values()].sort((a, b) => a.localeCompare(b)), skipped };
}

// Called only by a validated Windows-local click. Additive: never revoke other grants.
export async function syncWorkspacesLocal(upstream: WorkspaceReader, registry: ProjectRegistry) {
  const found = await discoverWorkspaces(upstream);
  let synced = 0;
  for (const path of found.paths) {
    try {
      await registry.addLocal(path);
      synced++;
    } catch {
      found.skipped++;
    }
  }
  invariant(
    synced > 0,
    'NO_WORKSPACES',
    '未找到可同步的本机项目。在 Codex 中打开项目并建立会话后重试，或从更多菜单添加目录。',
  );
  return { synced, skipped: found.skipped, at: new Date().toISOString() };
}

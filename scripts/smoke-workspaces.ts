import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { RpcClient, initializeRpc } from '../bridge/src/rpc.js';
import { findCodex, verifyCodex, codexEnvironment } from '../bridge/src/codex.js';
import { discoverWorkspaces, syncWorkspacesLocal } from '../bridge/src/workspaces.js';
import { Store } from '../bridge/src/store.js';
import { ProjectRegistry } from '../bridge/src/projects.js';
const exe = findCodex();
verifyCodex(exe);
const rpc = new RpcClient(
  exe,
  ['app-server', '--listen', 'stdio://'],
  30000,
  undefined,
  codexEnvironment(),
);
rpc.on('request', (m: { id: string }) => rpc.reject(m.id));
const store = new Store(':memory:');
rpc.start();
try {
  await initializeRpc(rpc);
  const upstream = { rpc, requireReady: () => {} };
  const found = await discoverWorkspaces(upstream);
  const registry = new ProjectRegistry(store);
  const first = await syncWorkspacesLocal(upstream, registry);
  const ids = store.projects().map((p) => p.projectId);
  const second = await syncWorkspacesLocal(upstream, registry);
  if (
    first.synced !== found.paths.length ||
    second.synced !== ids.length ||
    JSON.stringify(store.projects().map((p) => p.projectId)) !== JSON.stringify(ids)
  )
    throw Error('Workspace sync did not preserve project identities');
  const report = {
    at: new Date().toISOString(),
    result: 'PASS',
    officialProtocol: true,
    discovered: found.paths.length,
    synced: first.synced,
    skipped: first.skipped,
    idempotent: true,
    scope:
      'Real Codex config/read and paginated thread/list, local path checks and sync into an in-memory registry; no persistent grants or network pairing',
  };
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/workspace-sync-smoke.json'), JSON.stringify(report, null, 2));
  console.log(report);
} finally {
  const exited = once(rpc, 'exit');
  rpc.stop();
  await exited;
  store.close();
}

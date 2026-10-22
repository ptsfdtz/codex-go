// Windows-local, additive migration. Never reads Codex login files, overwrites a
// destination database/certificate, or deletes the original data directory.
import { DatabaseSync as Database, backup } from 'node:sqlite';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
const source = resolve(process.argv[2] ?? '');
const destination = join(process.env.LOCALAPPDATA ?? '', 'AgentDeck');
const port = Number(process.argv[3] ?? 49321);
if (
  process.platform !== 'win32' ||
  !process.argv[2] ||
  !process.env.LOCALAPPDATA ||
  !Number.isInteger(port) ||
  port < 1025 ||
  port > 65535
)
  throw new Error(
    'Usage: node scripts/desktop/migrate-desktop-data.mjs <existing-data-directory> <bridge-port>',
  );
if (existsSync(join(destination, 'agentdeck.db')) || existsSync(join(destination, 'tls.dpapi')))
  throw new Error('Destination already has user data; refusing to overwrite');
if (!existsSync(join(source, 'agentdeck.db')) || !existsSync(join(source, 'tls.dpapi')))
  throw new Error('Source database and DPAPI TLS certificate are required');
const db = new Database(join(source, 'agentdeck.db'), { readOnly: true });
if (
  db
    .prepare(
      "SELECT COUNT(*) AS count FROM turns WHERE status IN ('queued','running','waitingApproval')",
    )
    .get().count ||
  db.prepare("SELECT COUNT(*) AS count FROM approvals WHERE status IN ('pending','sending')").get()
    .count
)
  throw new Error('Stop active tasks and handle pending approvals before local migration');
mkdirSync(destination, { recursive: true });
await backup(db, join(destination, 'agentdeck.db'));
db.close();
cpSync(join(source, 'tls.dpapi'), join(destination, 'tls.dpapi'), {
  errorOnExist: true,
  force: false,
});
const migrated = new Database(join(destination, 'agentdeck.db'));
migrated
  .prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)')
  .run('listenPort', String(port));
console.log(
  JSON.stringify({
    destination,
    port,
    projects: migrated.prepare('SELECT COUNT(*) AS count FROM projects WHERE enabled=1').get()
      .count,
    devices: migrated.prepare('SELECT COUNT(*) AS count FROM devices WHERE revokedAt IS NULL').get()
      .count,
    originalRetained: true,
  }),
);
migrated.close();

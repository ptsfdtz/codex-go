import { DatabaseSync as Database } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
if (!process.env.LOCALAPPDATA || !process.argv[2])
  throw new Error(
    'Usage: node scripts/verify-desktop-install.mjs <original-data-directory> [port]',
  );
const data = join(process.env.LOCALAPPDATA, 'AgentDeck');
const original = resolve(process.argv[2]);
const installed = join(process.env.LOCALAPPDATA, 'Programs/AgentDeck');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileHash = (path) => digest(readFileSync(path));
const installedBinary = readFileSync(join(installed, 'agentdeck-desktop.exe'));
const portableBinary = readFileSync('artifacts/AgentDeck-0.3.0-windows/AgentDeck.exe');
// Tauri patches this exact marker to NSS while packaging, then restores UNK in
// the build output. Compare the code after normalizing this documented marker.
const marker = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS');
const normalizeBundleType = (bytes) => {
  const normalized = Buffer.from(bytes);
  const index = normalized.indexOf(marker);
  if (index >= 0) Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK').copy(normalized, index);
  return normalized;
};
const db = new Database(join(data, 'agentdeck.db'), { readOnly: true });
const old = new Database(join(original, 'agentdeck.db'), { readOnly: true });
const meta = (database, key) =>
  database.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;
const port = process.argv[3] ?? '49321';
const report = {
  at: new Date().toISOString(),
  installedBinarySha256: digest(installedBinary),
  portableBinarySha256: digest(portableBinary),
  executableCodeMatches:
    digest(normalizeBundleType(installedBinary)) === digest(normalizeBundleType(portableBinary)),
  expectedTauriBundleTypeDifference: installedBinary.includes(marker),
  installedRuntimeHashMatches:
    fileHash(join(installed, 'runtime/agentdeck-service.exe')) ===
    fileHash('desktop/src-tauri/resources/native-runtime/agentdeck-service.exe'),
  certificatePreserved: fileHash(join(data, 'tls.dpapi')) === fileHash(join(original, 'tls.dpapi')),
  hostIdentityPreserved: meta(db, 'hostId') === meta(old, 'hostId'),
  portPreserved: meta(db, 'listenPort') === port,
  authorizedProjects: db.prepare('SELECT COUNT(*) AS n FROM projects WHERE enabled=1').get().n,
  pairedDevices: db.prepare('SELECT COUNT(*) AS n FROM devices WHERE revokedAt IS NULL').get().n,
  currentUiVerification: 'SKIPPED: this script checks binaries and persisted identity only',
  freshTabletLanAndHumanApproval:
    'SKIPPED: physical LAN and human approval are not exercised by this script',
  fullRustBridgeMigration: 'Rust service executable; no Node child required',
  installerSignature: 'UNSIGNED',
};
report.passed =
  report.executableCodeMatches &&
  report.installedRuntimeHashMatches &&
  report.certificatePreserved &&
  report.hostIdentityPreserved &&
  report.portPreserved;
writeFileSync('artifacts/tauri-installed-verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
db.close();
old.close();
if (!report.passed) process.exitCode = 1;

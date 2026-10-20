import { DatabaseSync as Database, backup } from 'node:sqlite';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const source = join(process.env.LOCALAPPDATA, 'AgentDeck');
const directory = mkdtempSync(join(tmpdir(), 'agentdeck-native-data-'));
const db = new Database(join(source, 'agentdeck.db'), { readOnly: true });
await backup(db, join(directory, 'agentdeck.db'));
db.close();
cpSync(join(source, 'tls.dpapi'), join(directory, 'tls.dpapi'));
execFileSync(
  'cargo',
  [
    'test',
    '--locked',
    '--manifest-path',
    'desktop/core/Cargo.toml',
    '--test',
    'real',
    'migrated_data_identity',
    '--',
    '--ignored',
    '--nocapture',
  ],
  {
    env: { ...process.env, AGENTDECK_TEST_DATA_DIR: directory },
    stdio: 'inherit',
    windowsHide: true,
  },
);
const report = JSON.parse(readFileSync(join(directory, 'native-data-check.json'), 'utf8'));
writeFileSync(
  'artifacts/native-data-compatibility.json',
  JSON.stringify({ ...report, source, isolatedBackup: directory }, null, 2),
);
console.log(JSON.stringify(report, null, 2));

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const metadata = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--no-deps',
      '--format-version',
      '1',
      '--manifest-path',
      'desktop/src-tauri/Cargo.toml',
    ],
    { encoding: 'utf8', windowsHide: true },
  ),
);
const release = join(metadata.target_directory, 'release');
const output = resolve('artifacts/AgentDeck-0.3.0-windows');
mkdirSync(output, { recursive: true });
cpSync(join(release, 'agentdeck-desktop.exe'), join(output, 'AgentDeck.exe'));
// Use the same resource source as NSIS, not the Cargo target's stale copy.
cpSync(resolve('desktop/src-tauri/resources/native-runtime'), join(output, 'runtime'), {
  recursive: true,
});
const installer = join(release, 'bundle/nsis/AgentDeck_0.3.0_x64-setup.exe');
if (!existsSync(installer)) throw new Error('Build the NSIS bundle first');
cpSync(installer, resolve('artifacts/AgentDeck_0.3.0_x64-setup.exe'));
cpSync('docs/history/TAURI_MIGRATION.md', join(output, 'MIGRATION.md'));
writeFileSync(
  join(output, 'README.txt'),
  'AgentDeck 0.3.0\r\nRun AgentDeck.exe. React frontend, Tauri host and native Rust Bridge. No Node/C# runtime required.\r\nRequires Windows 11, WebView2, Git and a logged-in Codex CLI. AgentDeck currently verifies 0.159.2 and can install it alongside your global CLI after SHA-512 validation.\r\nData: %LOCALAPPDATA%\\AgentDeck, or AGENTDECK_DATA_DIR.\r\nClose button hides to tray. Use tray menu to stop and exit.\r\n',
);
const files = [
  'artifacts/AgentDeck_0.3.0_x64-setup.exe',
  'artifacts/AgentDeck-0.3.0-windows/AgentDeck.exe',
  'artifacts/AgentDeck-0.3.0-windows/runtime/agentdeck-service.exe',
];
writeFileSync(
  resolve('artifacts/tauri-package.json'),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      version: '0.3.0',
      backend: 'Native Rust desktop and Bridge',
      binaryNote:
        'NSIS marks the installed binary bundle type as NSS; the portable build retains UNK. These expected Tauri marker bytes differ.',
      files: files.map((path) => ({
        path,
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      })),
    },
    null,
    2,
  ),
);
console.log('Packaged NSIS installer and portable directory in artifacts/.');

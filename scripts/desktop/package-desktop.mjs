import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const portableOnly = process.argv.includes('--portable');
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
if (!portableOnly) {
  if (!existsSync(installer)) throw new Error('Build the NSIS bundle first');
  cpSync(installer, resolve('artifacts/AgentDeck_0.3.0_x64-setup.exe'));
}
writeFileSync(
  join(output, 'README.txt'),
  'AgentDeck 0.3.0\r\nExtract the entire ZIP with Windows Explorer into a normal user directory outside the build workspace, then run AgentDeck.exe. Do not run inside the ZIP or copy only the EXE.\r\nBuild workspaces can carry inherited Low Integrity labels; launching their EXEs from another terminal does not fix this. Do not change sandbox labels or run as administrator.\r\nReact frontend, Tauri host and native Rust Bridge. No Node/C# runtime required.\r\nRequires Windows 11, WebView2, Git and a logged-in Codex CLI. AgentDeck currently verifies 0.159.2 and can install it alongside your global CLI after SHA-512 validation.\r\nData: %LOCALAPPDATA%\\AgentDeck, or AGENTDECK_DATA_DIR.\r\nClose button hides to tray when tray creation succeeds. Use tray menu to stop and exit; without a tray icon the close button exits.\r\n',
);
const files = [
  ...(!portableOnly ? ['artifacts/AgentDeck_0.3.0_x64-setup.exe'] : []),
  'artifacts/AgentDeck-0.3.0-windows/AgentDeck.exe',
  'artifacts/AgentDeck-0.3.0-windows/runtime/agentdeck-service.exe',
];
// ZIP carries file contents, not the restricted build workspace's NTFS labels.
// Extract with Explorer into a normal user directory before launching.
const archive = resolve('artifacts/AgentDeck-0.3.0-windows.zip');
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '$ErrorActionPreference = "Stop"; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $stream = [IO.File]::Open($env:AGENTDECK_PACKAGE_ZIP, [IO.FileMode]::Create); $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create); try { foreach ($entry in @("AgentDeck.exe", "README.txt", "runtime/agentdeck-service.exe", "runtime/runtime-manifest.json")) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $env:AGENTDECK_PACKAGE_SOURCE $entry), $entry) | Out-Null } } finally { $zip.Dispose(); $stream.Dispose() }',
  ],
  {
    windowsHide: true,
    stdio: 'inherit',
    env: { ...process.env, AGENTDECK_PACKAGE_SOURCE: output, AGENTDECK_PACKAGE_ZIP: archive },
  },
);
files.push('artifacts/AgentDeck-0.3.0-windows.zip');
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
console.log(
  `Packaged ${portableOnly ? 'portable ZIP' : 'NSIS installer and portable ZIP'} in artifacts/. Extract ZIP outside the build workspace before launching.`,
);

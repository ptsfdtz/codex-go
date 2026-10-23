// Stage the native Rust service consumed by Tauri in development and bundles.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

if (process.platform !== 'win32') throw new Error('Package on Windows');

const manifest = 'desktop/core/Cargo.toml';
execFileSync('cargo', ['build', '--release', '--locked', '--manifest-path', manifest], {
  stdio: 'inherit',
  windowsHide: true,
});

const metadata = JSON.parse(
  execFileSync(
    'cargo',
    ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', manifest],
    { encoding: 'utf8', windowsHide: true },
  ),
);

const root = resolve('desktop/src-tauri/resources/native-runtime');
mkdirSync(root, { recursive: true });
const source = join(metadata.target_directory, 'release/agentdeck-service.exe');
const target = join(root, 'agentdeck-service.exe');
cpSync(source, target);

const extra = readdirSync(root).filter(
  (name) => !['agentdeck-service.exe', 'runtime-manifest.json'].includes(name),
);
if (extra.length)
  throw new Error('Unexpected files in native runtime staging; inspect before packaging');

writeFileSync(
  join(root, 'runtime-manifest.json'),
  JSON.stringify(
    {
      version: '0.3.0',
      backend: 'Rust',
      codexVersion: '0.159.2',
      schemaLockSha256: createHash('sha256')
        .update(readFileSync('packages/codex-protocol/schema-lock.json'))
        .digest('hex'),
      files: [
        {
          path: 'agentdeck-service.exe',
          sha256: createHash('sha256').update(readFileSync(target)).digest('hex'),
        },
      ],
    },
    null,
    2,
  ),
);
console.log('Rust service staged; no Node/C# runtime bundled.');

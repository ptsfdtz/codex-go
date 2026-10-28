// Build runtime-only download packages. Node is used only during development/release.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
const platform =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : '';
if (
  !arch ||
  !['windows', 'linux', 'macos'].includes(platform) ||
  (platform === 'windows' && arch !== 'x64')
)
  throw new Error('Unsupported release platform');
const version = process.env.AGENTDECK_RELEASE_VERSION || '0.3.0';
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(version) || version.includes('..'))
  throw new Error('Invalid release version');
const manifest = 'desktop/core/Cargo.toml';
execFileSync(
  'cargo',
  [
    'build',
    '--release',
    '--locked',
    '--manifest-path',
    manifest,
    '--bin',
    'agentdeck',
    '--bin',
    'agentdeck-service',
    '--bin',
    'agentdeck-codex-proxy',
  ],
  { stdio: 'inherit', windowsHide: true },
);
const metadata = JSON.parse(
  execFileSync(
    'cargo',
    ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', manifest],
    { encoding: 'utf8', windowsHide: true },
  ),
);
const output = resolve('artifacts/host-downloads');
const releases = join(output, 'releases', version);
const staging = resolve(`artifacts/host-${platform}-${arch}-${version}`);
mkdirSync(staging, { recursive: true });
mkdirSync(releases, { recursive: true });
for (const name of ['agentdeck', 'agentdeck-service', 'agentdeck-codex-proxy']) {
  const file = name + (platform === 'windows' ? '.exe' : '');
  cpSync(join(metadata.target_directory, 'release', file), join(staging, file));
  if (platform !== 'windows') chmodSync(join(staging, file), 0o755);
}
const starter = platform === 'windows' ? 'start.ps1' : 'start.sh';
writeFileSync(join(staging, 'release.txt'), `${version}\n`);
cpSync(`scripts/host/${starter}`, join(staging, starter));
if (platform !== 'windows') chmodSync(join(staging, starter), 0o755);
const filename = `agentdeck-${platform}-${arch}.${platform === 'windows' ? 'zip' : 'tar.gz'}`;
const archive = join(releases, filename);
if (platform === 'windows') {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.File]::Delete($env:AGENTDECK_PACKAGE_ARCHIVE); [IO.Compression.ZipFile]::CreateFromDirectory($env:AGENTDECK_PACKAGE_SOURCE, $env:AGENTDECK_PACKAGE_ARCHIVE)',
    ],
    {
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        AGENTDECK_PACKAGE_SOURCE: staging,
        AGENTDECK_PACKAGE_ARCHIVE: archive,
      },
    },
  );
} else {
  execFileSync('tar', [
    '-czf',
    archive,
    '-C',
    staging,
    'agentdeck',
    'agentdeck-service',
    'agentdeck-codex-proxy',
    starter,
    'release.txt',
  ]);
}
const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(`${archive}.sha256`, `${sha256}\n`);
writeFileSync(
  join(releases, `${platform}-${arch}.json`),
  JSON.stringify({ version, platform, arch, file: filename, sha256 }, null, 2) + '\n',
);
writeFileSync(join(output, 'releases/stable.txt'), `${version}\n`);
for (const script of ['install.sh', 'install.ps1', 'install-codex.ps1'])
  cpSync(`scripts/host/${script}`, join(output, script));
console.log(`Downloads: ${output}\n${filename}: ${sha256}`);

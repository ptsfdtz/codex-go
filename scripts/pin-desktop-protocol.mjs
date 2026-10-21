// Capture the locked desktop baseline as an overlay, never replace the managed CLI schema.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const version = '0.163.0-alpha.10.2';
const [executable, mode, ...extra] = process.argv.slice(2);
if (extra.length || (mode && !['--composer', '--projects'].includes(mode)))
  throw new Error('Unknown capture mode');
const composer = mode === '--composer';
const projects = mode === '--projects';
if (!executable || !isAbsolute(executable))
  throw new Error('Expected absolute baseline CLI executable');
const run = (args) =>
  execFileSync(executable, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
  });
if (run(['--version']).trim() !== `codex-cli ${version}`)
  throw new Error('Desktop baseline version mismatch');
const root = resolve('packages/codex-protocol');
const destination = join(root, 'versions', version);
if (
  existsSync(
    composer
      ? join(destination, 'composer-lock.json')
      : projects
        ? join(destination, 'projects-lock.json')
        : destination,
  )
)
  throw new Error('Baseline already captured; verify instead of overwriting');
const scratch = mkdtempSync(join(tmpdir(), 'agentdeck-desktop-schema-'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const walk = (directory, prefix = '') =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? walk(join(directory, entry.name), path)
      : entry.name.endsWith('.json')
        ? [path]
        : [];
  });
try {
  run([
    'app-server',
    'generate-json-schema',
    '--out',
    scratch,
    ...(composer || projects ? ['--experimental'] : []),
  ]);
  if (composer || projects) {
    const files = (
      projects ? ['ProjectListParams', 'ProjectListResponse'] : ['TurnStartParams']
    ).map((name) => {
      const bytes = readFileSync(join(scratch, `v2/${name}.json`));
      const source = `versions/${version}/experimental/${name}.json`;
      if (existsSync(join(root, source))) throw new Error('Experimental schema already exists');
      mkdirSync(dirname(join(root, source)), { recursive: true });
      writeFileSync(join(root, source), bytes);
      return { name, source, sha256: hash(bytes) };
    });
    writeFileSync(
      join(destination, projects ? 'projects-lock.json' : 'composer-lock.json'),
      `${JSON.stringify(
        {
          codexVersion: version,
          experimental: true,
          files,
        },
        null,
        2,
      )}\n`,
    );
    console.log(JSON.stringify({ version, experimental: true, count: files.length }));
  } else {
    const files = walk(scratch)
      .sort()
      .map((name) => {
        const bytes = readFileSync(join(scratch, name));
        const base = join(root, 'schema', name);
        const inherited = existsSync(base) && hash(readFileSync(base)) === hash(bytes);
        const source = inherited ? `schema/${name}` : `versions/${version}/schema/${name}`;
        if (!inherited) {
          mkdirSync(dirname(join(root, source)), { recursive: true });
          writeFileSync(join(root, source), bytes);
        }
        return { name: name.slice(0, -5), source, sha256: hash(bytes) };
      });
    mkdirSync(destination, { recursive: true });
    writeFileSync(
      join(destination, 'schema-lock.json'),
      `${JSON.stringify(
        {
          codexVersion: version,
          baseCodexVersion: '0.159.2',
          experimental: false,
          evidenceLevel: 'schema-export-not-runtime-acceptance',
          files,
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      JSON.stringify({
        version,
        count: files.length,
        overlay: files.filter((f) => f.source.startsWith('versions/')).length,
      }),
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

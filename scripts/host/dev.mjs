// Develop the headless host using the same state directory as the installed host.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
let data = process.env.AGENTDECK_DATA_DIR;
const previous = resolve('.tmp/desktop-dev-data-dir.txt');
if (!data && existsSync(previous)) data = readFileSync(previous, 'utf8').trim();
if (!data)
  data =
    process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA, 'AgentDeck')
      : join(process.env.XDG_STATE_HOME || join(process.env.HOME, '.local/state'), 'agentdeck');
data = resolve(data);
mkdirSync(data, { recursive: true });
if (existsSync(join(data, 'agentdeck.db')))
  data = dirname(realpathSync.native(join(data, 'agentdeck.db')));
const env = {
  ...process.env,
  AGENTDECK_DATA_DIR: data,
  CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || join(data, 'development/target'),
};
const manifest = resolve('desktop/core/Cargo.toml');
const build = spawnSync(
  'cargo',
  [
    'build',
    '--locked',
    '--manifest-path',
    manifest,
    '--bin',
    'agentdeck',
    '--bin',
    'agentdeck-service',
  ],
  { env, stdio: 'inherit', windowsHide: true },
);
if (build.status !== 0) process.exit(build.status || 1);
const executable = join(
  env.CARGO_TARGET_DIR,
  'debug',
  process.platform === 'win32' ? 'agentdeck.exe' : 'agentdeck',
);
console.log(
  `Host data: ${data}\nCLI: ${executable}\nUse agentdeck restart after changing Rust code.`,
);
const result = spawnSync(executable, [process.argv.includes('--start') ? 'start' : 'status'], {
  env,
  stdio: 'inherit',
  windowsHide: true,
});
process.exitCode = result.status || 0;

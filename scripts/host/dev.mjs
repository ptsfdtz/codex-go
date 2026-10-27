// Develop the headless host using the same state directory as the installed host.
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
// Only the native CLI selects state, exactly as it does for installed releases.
// A stale repository marker must never select a different account or identity.
const buildRoot =
  process.env.AGENTDECK_DATA_DIR ||
  (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA, 'AgentDeck')
    : join(process.env.XDG_STATE_HOME || join(process.env.HOME, '.local/state'), 'agentdeck'));
const env = {
  ...process.env,
  CARGO_TARGET_DIR: resolve(process.env.CARGO_TARGET_DIR || join(buildRoot, 'development/target')),
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
    ...(process.platform === 'win32' ? ['--bin', 'agentdeck-codex-proxy'] : []),
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
  `CLI: ${executable}\nUses the installed Host's state directory and existing instance.\nTo switch to this build, run pnpm host:dev -- --restart when tasks are idle.`,
);
const action = process.argv.includes('--restart')
  ? 'restart'
  : process.argv.includes('--start')
    ? 'start'
    : 'status';
const result = spawnSync(executable, [action], {
  env,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;

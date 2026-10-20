import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const executable = resolve('artifacts/AgentDeck-0.3.0-windows/AgentDeck.exe');
if (process.platform !== 'win32') throw new Error('AgentDeck desktop requires Windows');
if (!existsSync(executable))
  throw new Error(
    'Run pnpm desktop:build then node scripts/package-desktop.mjs; or pnpm desktop:dev',
  );
const child = spawn(executable, [], {
  cwd: resolve('artifacts/AgentDeck-0.3.0-windows'),
  detached: true,
  stdio: 'ignore',
  windowsHide: false,
});
child.on('error', () => {
  console.error('AgentDeck could not start');
  process.exitCode = 1;
});
child.unref();

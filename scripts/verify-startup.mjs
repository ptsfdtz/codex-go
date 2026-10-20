import { mkdtempSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { clearTimeout } from 'node:timers';
const directory = mkdtempSync(join(tmpdir(), 'agentdeck-startup-'));
const child = spawn(process.execPath, ['bridge/dist/bridge/src/main.js'], {
  shell: false,
  windowsHide: true,
  env: {
    ...process.env,
    AGENTDECK_DATA_DIR: directory,
    AGENTDECK_PORT: '49329',
    AGENTDECK_STARTUP_CHECK: '1',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
child.stderr.on('data', (data) => process.stderr.write(data));
const timer = setTimeout(() => child.kill(), 90000);
const code = await new Promise((done, reject) => {
  child.on('error', reject);
  child.on('close', done);
});
clearTimeout(timer);
if (code !== 0) throw new Error(`Production startup verification failed (${code})`);
const report = JSON.parse(readFileSync(join(directory, 'startup-check.json'), 'utf8'));
copyFileSync(join(directory, 'startup-check.json'), resolve('artifacts/startup-check.json'));
console.log(report);

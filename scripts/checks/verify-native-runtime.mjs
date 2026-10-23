// Isolated real Windows DPAPI + MXC boundary + Codex initialize check.
// Does not use a fixture, request an AI task, or auto-approve anything.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const metadata = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--no-deps',
      '--format-version',
      '1',
      '--manifest-path',
      'desktop/core/Cargo.toml',
    ],
    { encoding: 'utf8', windowsHide: true },
  ),
);
const executable = process.argv[2]
  ? resolve(process.argv[2])
  : join(metadata.target_directory, 'debug', 'agentdeck-service.exe');
const directory = mkdtempSync(join(tmpdir(), 'agentdeck-native-check-'));
const child = spawn(executable, [], {
  env: {
    ...process.env,
    AGENTDECK_DATA_DIR: directory,
    AGENTDECK_STARTUP_CHECK: '1',
    AGENTDECK_PORT: '49329',
  },
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let buffer = '';
const failures = [];
let length = 0;
child.stdout.on('data', (b) => {
  length += b.length;
  if (length > 4 * 1024 * 1024) {
    child.kill();
    return;
  }
  buffer += b.toString();
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    try {
      const p = JSON.parse(line);
      if (p.type === 'error') failures.push(p.payload.message);
    } catch {
      failures.push('Invalid native IPC');
    }
  }
});
child.stderr.on('data', () => {});
const timer = setTimeout(() => child.kill(), 130000);
const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', resolve);
});
clearTimeout(timer);
let report;
try {
  report = JSON.parse(readFileSync(join(directory, 'startup-check.json'), 'utf8'));
} catch {
  report = { result: 'FAIL', reason: 'No authoritative startup report' };
}
const result = {
  at: new Date().toISOString(),
  ...report,
  exitCode: code,
  executable,
  directory,
  failures,
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/native-runtime-startup.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (
  code !== 0 ||
  report.result !== 'PASS' ||
  report.backend !== 'Rust' ||
  !report.codexReady ||
  !report.sandboxVerified
)
  process.exitCode = 1;

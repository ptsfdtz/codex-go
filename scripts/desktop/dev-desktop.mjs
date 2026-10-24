// Reuse the installed service identity so restarting development preserves pairing.
// An explicit data directory still allows an isolated development instance.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const cache = resolve(root, '.tmp');
const selectedDataFile = resolve(cache, 'desktop-dev-data-dir.txt');
const selectedData = existsSync(selectedDataFile)
  ? readFileSync(selectedDataFile, 'utf8').trim()
  : '';
const webview = resolve(process.env.AGENTDECK_WEBVIEW_DATA_DIR || resolve(cache, 'webview2'));
let data = resolve(
  process.env.AGENTDECK_DATA_DIR ||
    selectedData ||
    (process.env.LOCALAPPDATA
      ? resolve(process.env.LOCALAPPDATA, 'AgentDeck')
      : resolve(cache, 'agentdeck-data')),
);
mkdirSync(webview, { recursive: true });
mkdirSync(data, { recursive: true });
// MSIX can virtualize individual files beneath LOCALAPPDATA. Pin the physical
// database directory so the separately launched service opens the same identity.
if (existsSync(resolve(data, 'agentdeck.db'))) {
  data = dirname(realpathSync.native(resolve(data, 'agentdeck.db')));
}
// Keep the same selection when the next launch comes from a non-MSIX terminal.
writeFileSync(selectedDataFile, data);
const development = resolve(data, 'development');
const runtime = resolve(development, 'runtime');
mkdirSync(runtime, { recursive: true });
for (const name of ['agentdeck-service.exe', 'runtime-manifest.json']) {
  writeFileSync(
    resolve(runtime, name),
    readFileSync(resolve(root, 'desktop/src-tauri/resources/native-runtime', name)),
  );
}
console.log(`AgentDeck service data: ${data}`);

const args = ['--filter', '@agentdeck/desktop', 'desktop:dev'];
const env = {
  ...process.env,
  AGENTDECK_WEBVIEW_DATA_DIR: webview,
  AGENTDECK_DATA_DIR: data,
  AGENTDECK_RUNTIME_DIR: runtime,
  // Build outside a checkout carrying an inherited Low Integrity label.
  CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || resolve(development, 'target'),
};
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const child = spawn(command, args, {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('error', (error) => {
  console.error(`AgentDeck dev launcher failed: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});

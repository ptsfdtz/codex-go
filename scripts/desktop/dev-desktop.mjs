// Dev-only launcher. Tauri/WebView2 need writable data directories; keep them
// inside the checkout so a sandboxed Windows shell can still start the app.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const cache = resolve(root, '.tmp');
const webview = resolve(cache, 'webview2');
const data = resolve(cache, 'agentdeck-data');
mkdirSync(webview, { recursive: true });
mkdirSync(data, { recursive: true });

const args = ['--filter', '@agentdeck/desktop', 'desktop:dev'];
const env = {
  ...process.env,
  AGENTDECK_WEBVIEW_DATA_DIR: webview,
  AGENTDECK_DATA_DIR: data,
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

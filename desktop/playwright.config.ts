import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '../artifacts/tauri-browser-tests.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:1420',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1000, height: 700 },
  },
  webServer: { command: 'pnpm dev', url: 'http://127.0.0.1:1420', reuseExistingServer: true },
});

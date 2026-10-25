import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function webVersion(): string {
  const hash = createHash('sha256');
  const root = fileURLToPath(new URL('.', import.meta.url));
  const visit = (directory: string) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else hash.update(path).update(readFileSync(join(root, path)));
    }
  };
  visit('src');
  visit('public');
  for (const path of ['index.html', 'package.json', 'vite.config.ts', '../pnpm-lock.yaml'])
    hash.update(readFileSync(join(root, path)));
  hash.update(process.env.VITE_BASE_PATH || '/');
  return hash.digest('hex');
}

function localRequest(request: IncomingMessage): boolean {
  const host = request.headers.host || '';
  return (
    /^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host) &&
    (!request.headers.origin || request.headers.origin === `http://${host}`) &&
    request.headers['sec-fetch-site'] !== 'cross-site'
  );
}

// Keep production identity separate from the local transport address. Only the
// explicit development mode proxies authenticated requests to the real cloud.
export function cloudProxy(target: string): Plugin {
  const allowedUpgrades = new WeakSet<IncomingMessage>();
  return {
    name: 'local-cloud-proxy',
    configureServer(server) {
      // Validate upgrades before changeOrigin replaces the incoming Host header.
      server.httpServer?.prependListener('upgrade', (request, socket) => {
        if (!request.url?.startsWith('/api/v1/')) return;
        if (localRequest(request) && request.headers.origin) allowedUpgrades.add(request);
        else socket.destroy();
      });
      server.middlewares.use((request, response, next) => {
        if (!localRequest(request)) {
          response.writeHead(403).end();
          return;
        }
        next();
      });
    },
    config() {
      const proxy: ProxyOptions = {
        target,
        changeOrigin: true,
        ws: true,
        // Rewriting is intentional for this loopback-only development bridge.
        configure(proxy) {
          proxy.on('proxyReq', (outgoing) => outgoing.setHeader('origin', target));
          proxy.on('proxyReqWs', (outgoing, request, socket) => {
            if (!allowedUpgrades.has(request)) {
              outgoing.destroy();
              socket.destroy();
              return;
            }
            outgoing.setHeader('origin', target);
          });
        },
      };
      return { server: { proxy: { '/api/v1/': proxy }, cors: false } };
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const version = webVersion();
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const target = (env.VITE_CLOUD_ORIGIN || 'https://agent.ptsfdtz.top').replace(/\/$/, '');
  if (command === 'serve' && mode === 'cloud-dev') {
    const url = new URL(target);
    if (url.protocol !== 'https:' || url.origin !== target)
      throw new Error(
        'Cloud development requires an HTTPS cloud origin without a path or credentials',
      );
  }
  return {
    define: { __AGENTDECK_WEB_VERSION__: JSON.stringify(version) },
    base: process.env.VITE_BASE_PATH || '/',
    plugins: [
      react(),
      {
        name: 'web-update-manifest',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({ version }) + '\n',
          });
        },
      },
      ...(command === 'serve' && mode === 'cloud-dev' ? [cloudProxy(target)] : []),
    ],
    resolve: {
      alias: [
        {
          find: /^crypto$/,
          replacement: fileURLToPath(new URL('./src/transport/browser-crypto.ts', import.meta.url)),
        },
      ],
    },
    build: { target: 'es2022' },
  };
});

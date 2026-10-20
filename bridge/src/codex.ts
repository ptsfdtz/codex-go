import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { RpcClient, initializeRpc } from './rpc.js';
import { DeckError, invariant } from './errors.js';
import { log } from './log.js';
import { once } from 'node:events';

export const CODEX_VERSION = '0.159.2';
export function codexEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const environment = { ...source };
  if (platform !== 'win32') return environment;
  // Codex Desktop injects a per-user cached pwsh into PATH. Its runtime cannot be
  // resolved by the isolated Windows execution account. Let Codex discover an
  // installed PowerShell (or Windows PowerShell) without widening the sandbox.
  for (const key of Object.keys(environment).filter((key) => /^path$/i.test(key)))
    environment[key] = (environment[key] ?? '')
      .split(';')
      .filter(
        (entry) =>
          !/[\\/]\.cache[\\/]codex-runtimes[\\/].*[\\/]dependencies[\\/]native[\\/]powershell[\\/]*"?$/i.test(
            entry,
          ) &&
          !/[\\/]AppData[\\/]Local[\\/]Microsoft[\\/]WindowsApps[\\/]*"?$/i.test(entry) &&
          !/[\\/]WindowsApps[\\/]Microsoft\.PowerShell[^;]*$/i.test(entry),
      )
      .join(';');
  return environment;
}
export function findCodex(): string {
  if (process.env.AGENTDECK_CODEX_EXE) {
    const path = resolve(process.env.AGENTDECK_CODEX_EXE);
    invariant(
      path.toLowerCase().endsWith('.exe') || process.platform !== 'win32',
      'CONFIG_ERROR',
      'Codex path must be a native executable',
    );
    return path;
  }
  if (process.platform === 'win32') {
    const paths = execFileSync('where.exe', ['codex'], { encoding: 'utf8', windowsHide: true })
      .trim()
      .split(/\r?\n/);
    for (const path of paths) {
      if (path.endsWith('.exe')) return path;
      const candidate = join(
        dirname(path),
        'node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
      );
      if (existsSync(candidate)) return candidate;
    }
  } else {
    const require = createRequire(import.meta.url);
    try {
      const main = require.resolve('@openai/codex/package.json');
      const path = join(dirname(main), 'vendor/x86_64-unknown-linux-musl/codex/codex');
      if (existsSync(path)) return path;
    } catch {
      /* PATH lookup below */
    }
    return 'codex';
  }
  throw new DeckError('CONFIG_ERROR', 'Native Codex executable not found');
}
export function verifyCodex(path: string): void {
  const version = execFileSync(path, ['--version'], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  }).trim();
  invariant(
    version === `codex-cli ${CODEX_VERSION}`,
    'UPSTREAM_VERSION_UNSUPPORTED',
    `AgentDeck requires codex-cli ${CODEX_VERSION}`,
  );
}
export function serverArgs(): string[] {
  // CLI overrides affect only this child process. Never edit the user's login/config files.
  return [
    'app-server',
    '--listen',
    'stdio://',
    ...(process.platform === 'win32' ? ['-c', 'windows.sandbox="mxc"'] : []),
    '-c',
    'approval_policy="on-request"',
    '-c',
    'approvals_reviewer="user"',
    '-c',
    'default_permissions="agentdeck"',
    '-c',
    'permissions={agentdeck={extends=":workspace",filesystem={":root"="deny",":minimal"="read",":tmpdir"="deny",":slash_tmp"="deny"},network={enabled=false}}}',
    '-c',
    'web_search="disabled"',
    '-c',
    'mcp_servers={}',
    '-c',
    'hooks={}',
    '-c',
    'shell_environment_policy.inherit="core"',
  ];
}
export class Supervisor {
  readonly rpc: RpcClient;
  ready = false;
  generation = '';
  private stopping = false;
  private restarting: NodeJS.Timeout | null = null;
  private failures = 0;
  private switching = false;
  private discovered = false;
  private readonly production: boolean;
  private readonly baseArgs: string[];
  onReady: () => Promise<void> = async () => {};
  onLost: () => void = () => {};
  constructor(executable: string, args?: string[]) {
    this.production = args === undefined;
    this.baseArgs = args ?? serverArgs();
    this.rpc = new RpcClient(
      executable,
      this.baseArgs,
      30000,
      8 * 1024 * 1024,
      this.production ? codexEnvironment() : undefined,
    );
    this.rpc.on('fault', (error) =>
      log('codex.fault', { message: error instanceof DeckError ? error.code : 'UPSTREAM_ERROR' }),
    );
    this.rpc.on('exit', () => {
      if (this.switching) return;
      this.ready = false;
      this.onLost();
      if (!this.stopping) {
        const delay = Math.min(30000, 500 * 2 ** this.failures++);
        this.restarting = setTimeout(() => void this.start().catch(() => {}), delay);
      }
    });
  }
  async start(): Promise<void> {
    if (this.stopping) return;
    this.generation = crypto.randomUUID();
    this.rpc.start();
    try {
      await initializeRpc(this.rpc);
      if (this.production && !this.discovered) {
        const result = (await this.rpc.request('config/read', { includeLayers: false })) as {
          config: Record<string, unknown>;
        };
        const mcp = result.config.mcp_servers as Record<string, { enabled?: boolean }> | undefined;
        const names = Object.entries(mcp ?? {})
          .filter(([, value]) => value.enabled !== false)
          .map(([name]) => name);
        if (names.length) {
          invariant(
            names.length <= 100,
            'UNSAFE_UPSTREAM_CONFIG',
            'Too many configured MCP servers',
          );
          this.switching = true;
          const exited = once(this.rpc, 'exit');
          this.rpc.stop();
          await exited;
          const table =
            '{' + names.map((name) => `${JSON.stringify(name)}={enabled=false}`).join(',') + '}';
          this.rpc.configure([...this.baseArgs, '-c', `mcp_servers=${table}`]);
          this.switching = false;
          this.generation = crypto.randomUUID();
          this.rpc.start();
          await initializeRpc(this.rpc);
        }
        this.discovered = true;
      }
      if (process.platform === 'win32') {
        const readiness = (await this.rpc.request('windowsSandbox/readiness', undefined)) as {
          status: string;
        };
        invariant(
          readiness.status === 'ready',
          'SANDBOX_UNAVAILABLE',
          'Windows sandbox is not ready',
        );
      }
      this.ready = true;
      this.failures = 0;
      await this.onReady();
    } catch (error) {
      this.ready = false;
      this.rpc.stop();
      throw error;
    }
  }
  requireReady(): void {
    invariant(this.ready, 'UPSTREAM_UNAVAILABLE', 'Codex App Server is not ready');
  }
  stop(): void {
    this.stopping = true;
    this.ready = false;
    if (this.restarting) clearTimeout(this.restarting);
    this.rpc.stop();
  }
}

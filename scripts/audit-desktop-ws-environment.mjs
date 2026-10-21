// Read installed application code only; never reads live environment or user logs.
import { openSync, readSync, closeSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const [archive, destination] = process.argv.slice(2);
if (!archive || !isAbsolute(archive)) throw new Error('Expected absolute app.asar path');
const fd = openSync(archive, 'r');
function read(position, size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > 32 * 1024 * 1024)
    throw new Error('Unsupported archive entry size');
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(fd, buffer, offset, size - offset, position + offset);
    if (!count) throw new Error('Truncated archive');
    offset += count;
  }
  return buffer;
}
try {
  const header = read(0, 16);
  const tree = JSON.parse(read(16, header.readUInt32LE(12)).toString());
  const base = 8 + header.readUInt32LE(4);
  const files = tree.files?.['.vite']?.files?.build?.files;
  if (!files) throw new Error('Unsupported archive layout');
  function source(prefix) {
    const names = Object.keys(files).filter(
      (name) => name.startsWith(prefix) && name.endsWith('.js'),
    );
    if (names.length !== 1) throw new Error('Ambiguous installed bundle');
    const name = names[0];
    const entry = files[name];
    if (entry.unpacked || !/^\d+$/.test(entry.offset)) throw new Error('Unsupported entry');
    const bytes = read(base + Number(entry.offset), entry.size);
    return {
      name,
      text: bytes.toString(),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  const main = source('main-');
  const network = source('application-network-startup-');
  const sanitizerExport =
    /Object\.defineProperty\(exports,"Ct",\{enumerable:!0,get:function\(\)\{return (\w+)\}\}\)/.exec(
      network.text,
    )?.[1];
  // Execute only this exactly matched pure sanitizer, never the application bundle.
  const pure =
    /var (\w+)=new Set\((\[[^\]]*\])\);function (\w+)\(e\)\{let t=\{\.\.\.e\};for\(let e of Object\.keys\(t\)\)(\w+)\.has\(e\.toUpperCase\(\)\)&&delete t\[e\];return t\}/.exec(
      network.text,
    );
  if (!pure || pure[1] !== pure[4] || pure[3] !== sanitizerExport)
    throw new Error('Unknown terminal sanitizer; manual audit required');
  const terminal =
    /async buildTerminalEnv\([^)]*\)\{let r=\{\.\.\.process\.env\};[^\n]{0,1200}?return[^\n]{0,300}?\.Ct\(r\)\}/.exec(
      main.text,
    );
  if (!terminal) throw new Error('Unknown terminal inheritance; manual audit required');
  const marker = 'synthetic-no-real-credential';
  const sanitized = runInNewContext(
    `${pure[0]}; ${pure[3]}(input)`,
    {
      input: { CODEX_APP_SERVER_WS_URL: marker, BREAKPAD_DUMP_LOCATION: marker },
    },
    { timeout: 1000 },
  );
  const routeOffset = network.text.indexOf('process.env.CODEX_APP_SERVER_WS_URL');
  if (routeOffset < 0) throw new Error('Local URL environment route not found');
  const cliOverride = network.text.includes('let e=process.env.CODEX_CLI_PATH');
  const defaultDesktopArguments =
    network.text.includes('Os=[`-c`,`features.code_mode_host=true`]') &&
    network.text.includes('[...Os,`app-server`,`--analytics-default-enabled`]');
  // Only execute the exact, reviewed pure argv builder with synthetic inputs.
  // Never evaluate a bundle or pass the real process/environment into the VM.
  const argvBuilder =
    /function rc\(\)\{let e=ks\.flatMap\(\(\{configKey:e,envVar:t\}\)=>\{let n=process\.env\[t\]\?\.trim\(\);return n==null\|\|n===``\?\[\]:\[`-c`,\x60\$\{e\}=\$\{JSON\.stringify\(n\)\}\x60\]\}\);return e\.length===0\?\[\.\.\.Os,`app-server`,`--analytics-default-enabled`\]:\[`app-server`,\.\.\.Os,\.\.\.e,`--analytics-default-enabled`\]\}/.exec(
      network.text,
    );
  const knownMappings =
    'ks=[{configKey:`chatgpt_base_url`,envVar:`CODEX_APP_SERVER_CHATGPT_BASE_URL`},{configKey:`openai_base_url`,envVar:`CODEX_APP_SERVER_OPENAI_BASE_URL`}]';
  if (!defaultDesktopArguments || !argvBuilder || !network.text.includes(knownMappings))
    throw new Error('Unknown desktop argument builder; manual audit required');
  const argvCases = [
    {
      name: 'default',
      env: {},
      expected: ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'],
    },
    {
      name: 'blank',
      env: { CODEX_APP_SERVER_CHATGPT_BASE_URL: '  ' },
      expected: ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'],
    },
    {
      name: 'both-synthetic-overrides',
      env: {
        CODEX_APP_SERVER_CHATGPT_BASE_URL: ' https://chatgpt.invalid/a ',
        CODEX_APP_SERVER_OPENAI_BASE_URL: ' https://openai.invalid/b ',
      },
      expected: [
        'app-server',
        '-c',
        'features.code_mode_host=true',
        '-c',
        'chatgpt_base_url="https://chatgpt.invalid/a"',
        '-c',
        'openai_base_url="https://openai.invalid/b"',
        '--analytics-default-enabled',
      ],
    },
  ].map(({ name, env, expected }) => {
    const actual = runInNewContext(
      `${argvBuilder[0]}; rc()`,
      {
        process: { env },
        Os: ['-c', 'features.code_mode_host=true'],
        ks: [
          { configKey: 'chatgpt_base_url', envVar: 'CODEX_APP_SERVER_CHATGPT_BASE_URL' },
          { configKey: 'openai_base_url', envVar: 'CODEX_APP_SERVER_OPENAI_BASE_URL' },
        ],
      },
      { timeout: 1000 },
    );
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error('Desktop synthetic startup arguments changed');
    return { name, syntheticArguments: actual };
  });
  const overrideChangesWindowsSandbox =
    network.text.includes('r.source!==`override`&&i!=null&&r.executablePath===') &&
    network.text.includes('...a?[`-c`,`features.windows_sandbox_service=true`]:[]') &&
    network.text.includes('a||delete o.CODEX_WINDOWS_REGISTERED_CORE');
  const tunnelCliProbe = main.text.includes('[`tcp-tunnel`,`--help`]');
  const tunnelCliStart = main.text.includes(
    '[`tcp-tunnel`,`--proxy-origins-file`,this.proxyOriginsFile,`--proxy-url`,o.origin,`--target`,i,`--auth-token-stdin`,`--auth-token-updates-stdin`]',
  );
  if (!overrideChangesWindowsSandbox || !tunnelCliProbe || !tunnelCliStart)
    throw new Error('Unknown native auxiliary or sandbox path; manual audit required');
  const report = {
    kind: 'installed-static-code-and-pure-function',
    bundles: [main, network].map(({ name, sha256 }) => ({ name, sha256 })),
    offsets: {
      localRoute: routeOffset,
      terminal: terminal.index,
      sanitizer: pure.index,
      startupArgumentBuilder: argvBuilder.index,
    },
    localUrlEnvironmentRead: true,
    terminalCopiesDesktopEnvironment: true,
    terminalRetainsLocalUrl: sanitized.CODEX_APP_SERVER_WS_URL === marker,
    sanitizerControlRemoved: !Object.hasOwn(sanitized, 'BREAKPAD_DUMP_LOCATION'),
    originalGuiExecuted: false,
    cliExecutablePathOverride: cliOverride,
    desktopAddsConfigAndAnalyticsStartupArguments: defaultDesktopArguments,
    startupArgumentCases: argvCases,
    cliOverrideChangesWindowsSandboxServiceBranch: overrideChangesWindowsSandbox,
    cloudTunnelUsesNativeCli: {
      helpProbe: tunnelCliProbe,
      start: tunnelCliStart,
      originalTunnelExecuted: false,
    },
    scope: 'local-transport-environment-and-native-cli-startup',
    productionRouteApproved: false,
  };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (destination) writeFileSync(destination, output);
  process.stdout.write(output);
} finally {
  closeSync(fd);
}

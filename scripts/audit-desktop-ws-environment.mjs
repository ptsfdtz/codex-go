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
  const report = {
    kind: 'installed-static-code-and-pure-function',
    bundles: [main, network].map(({ name, sha256 }) => ({ name, sha256 })),
    offsets: { localRoute: routeOffset, terminal: terminal.index, sanitizer: pure.index },
    localUrlEnvironmentRead: true,
    terminalCopiesDesktopEnvironment: true,
    terminalRetainsLocalUrl: sanitized.CODEX_APP_SERVER_WS_URL === marker,
    sanitizerControlRemoved: !Object.hasOwn(sanitized, 'BREAKPAD_DUMP_LOCATION'),
    originalGuiExecuted: false,
    cliExecutablePathOverride: cliOverride,
    desktopAddsConfigAndAnalyticsStartupArguments: defaultDesktopArguments,
    scope: 'local-websocket-url-userinfo-in-environment',
    productionRouteApproved: false,
  };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (destination) writeFileSync(destination, output);
  process.stdout.write(output);
} finally {
  closeSync(fd);
}

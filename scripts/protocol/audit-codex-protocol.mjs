// Export installed CLI schemas without replacing the production schema lock.
// Usage: node scripts/protocol/audit-codex-protocol.mjs <absolute-codex.exe> <output-dir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { compareContracts, contract, methodContracts } from '../lib/protocol-contracts.mjs';
import { isStandaloneSchema } from '../lib/protocol-schema-files.mjs';

const [executable, destination] = process.argv.slice(2);
if (!executable || !isAbsolute(executable) || !destination) {
  throw new Error('Expected absolute CLI executable and output directory');
}
const output = resolve(destination);
const workspace = mkdtempSync(join(tmpdir(), 'agentdeck-protocol-audit-'));
const run = (args) =>
  execFileSync(executable, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
  });
const version = run(['--version']).trim();
const methods = (value, result = new Set()) => {
  if (!value || typeof value !== 'object') return result;
  const method = value.properties?.method;
  if (typeof method?.const === 'string') result.add(method.const);
  for (const item of method?.enum ?? []) if (typeof item === 'string') result.add(item);
  for (const child of Object.values(value)) methods(child, result);
  return result;
};
const inventories = {};
const contractDifferences = {};
const pinnedRoot = resolve('packages/codex-protocol');
const lock = JSON.parse(readFileSync(join(pinnedRoot, 'schema-lock.json'), 'utf8'));
const fingerprint = (directory) => {
  const walk = (path) =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
      const full = join(path, entry.name);
      return entry.isDirectory() ? walk(full) : isStandaloneSchema(entry.name) ? [full] : [];
    });
  return Object.fromEntries(
    walk(directory)
      .sort()
      .map((file) => [
        relative(directory, file).replaceAll('\\', '/'),
        createHash('sha256')
          .update(JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))))
          .digest('hex'),
      ]),
  );
};
const pinnedFiles = fingerprint(join(pinnedRoot, 'schema'));
const read = (directory, file) => JSON.parse(readFileSync(join(directory, file), 'utf8'));
const contracts = (directory) => {
  const result = Object.fromEntries(
    ['ClientRequest', 'ServerRequest', 'ServerNotification'].map((name) => [
      name,
      methodContracts(read(directory, `${name}.json`)),
    ]),
  );
  result.responses = Object.fromEntries(
    Object.keys(fingerprint(directory))
      .filter((name) => name.endsWith('Response.json'))
      .sort()
      .map((name) => {
        const document = read(directory, name);
        const branch = Object.fromEntries(
          Object.entries(document).filter(([key]) => !['definitions', '$schema'].includes(key)),
        );
        return [name, contract(document, branch)];
      }),
  );
  return result;
};
const pinnedContracts = contracts(join(pinnedRoot, 'schema'));
try {
  for (const experimental of [false, true]) {
    const directory = join(workspace, experimental ? 'experimental' : 'stable');
    run([
      'app-server',
      'generate-json-schema',
      '--out',
      directory,
      ...(experimental ? ['--experimental'] : []),
    ]);
    const source = readFileSync(join(directory, 'ClientRequest.json'));
    const installed = [...methods(JSON.parse(source))].sort();
    const files = fingerprint(directory);
    const installedContracts = contracts(directory);
    const mode = experimental ? 'experimental' : 'stable';
    contractDifferences[mode] = Object.fromEntries(
      Object.entries(installedContracts).map(([name, values]) => [
        name,
        compareContracts(pinnedContracts[name], values),
      ]),
    );
    const pinned = [
      ...methods(
        JSON.parse(
          readFileSync(resolve('packages/codex-protocol/schema/ClientRequest.json'), 'utf8'),
        ),
      ),
    ].sort();
    inventories[experimental ? 'experimental' : 'stable'] = {
      methods: installed,
      addedSincePinned: installed.filter((method) => !pinned.includes(method)),
      removedSincePinned: pinned.filter((method) => !installed.includes(method)),
      clientRequestSha256: createHash('sha256').update(source).digest('hex'),
      comparisonBaseline: 'pinned-stable-export',
      contracts: Object.fromEntries(
        Object.entries(contractDifferences[mode]).map(([name, diff]) => [
          name,
          {
            count: diff.count,
            added: diff.added.length,
            removed: diff.removed.length,
            changed: diff.changed.length,
            unchanged: diff.unchanged.length,
          },
        ]),
      ),
      schemas: {
        scope: 'standalone-message-schemas',
        count: Object.keys(files).length,
        added: Object.keys(files).filter((file) => !Object.hasOwn(pinnedFiles, file)),
        changed: Object.keys(files).filter(
          (file) => Object.hasOwn(pinnedFiles, file) && files[file] !== pinnedFiles[file],
        ),
        removed: Object.keys(pinnedFiles).filter((file) => !Object.hasOwn(files, file)),
        manifestSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
      },
    };
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
mkdirSync(output, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  cliVersion: version,
  pinnedCliVersion: lock.codexVersion,
  evidenceLevel: 'local-schema-export-only',
  sharedDesktopRuntimeVerified: false,
  note: 'Methods in a schema do not prove runtime support, account availability or desktop sharing.',
  contractDifferencesFile: 'protocol-contract-differences.json',
  inventories,
};
writeFileSync(
  join(output, 'protocol-contract-differences.json'),
  `${JSON.stringify(
    {
      cliVersion: version,
      pinnedCliVersion: lock.codexVersion,
      comparisonBaseline: 'pinned-stable-export',
      compatibilityVerdict: 'not-established',
      note: 'Transitive schema drift, including documentation changes, requires review. Unchanged schemas do not prove behavioral compatibility. Experimental comparisons include newly exposed experimental contracts. Values above 2048 JSON characters use canonical SHA256 and byte length; regenerate the local export for full schema values.',
      inventories: contractDifferences,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(join(output, 'protocol-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    cliVersion: version,
    output: join(output, 'protocol-audit.json'),
    stableMethods: inventories.stable.methods.length,
    experimentalMethods: inventories.experimental.methods.length,
  }),
);

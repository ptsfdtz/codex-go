// Read-only installed-code audit. Execute only the matched pure routing function.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { runInNewContext } from 'node:vm';

const [archivePath, destination] = process.argv.slice(2);
if (![archivePath, destination].every((p) => p && isAbsolute(p)))
  throw new Error('Expected absolute archive and report paths');
const archive = readFileSync(archivePath);
const tree = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
const assets = tree.files?.webview?.files?.assets?.files;
const names = Object.keys(assets ?? {}).filter((name) => /^app-initial-.*\.js$/.test(name));
if (names.length !== 1) throw new Error('Unknown desktop routing bundle');
const entry = assets[names[0]];
if (
  entry.unpacked ||
  !/^\d+$/.test(entry.offset) ||
  !Number.isSafeInteger(Number(entry.offset)) ||
  !Number.isSafeInteger(entry.size) ||
  entry.size < 1 ||
  entry.size > 32 * 1024 * 1024
)
  throw new Error('Unsupported desktop routing entry');
const start = 8 + archive.readUInt32LE(4) + Number(entry.offset);
if (!Number.isSafeInteger(start) || start + entry.size > archive.length)
  throw new Error('Desktop routing entry out of bounds');
const bytes = archive.subarray(start, start + entry.size);
const source = bytes.toString();
const matches = [...source.matchAll(/function mPs\(\{[^}]+\}\)\{return[^}]+\}/g)];
if (matches.length !== 1) throw new Error('Unknown onboarding route function');
const matched = matches[0];
const expected =
  'function mPs({auth:e,codexFeatureAccess:t,backendOnboardingCompleted:n,bedrockLoginPending:r=!1,gatewayOAuthLoginPending:i=!1,gatewayOAuthReadiness:a=`ready`,forcedOverride:o,isOnboardingContextFetched:s,isOnboardingContextLoading:c,projectlessOnboardingCompleted:l,workspaceRootsData:u,workspaceRootsIsLoading:d,workspaceRootsTimedOut:f}){return i||r?`login`:e.isLoading?null:!e.authMethod&&e.requiresAuth||e.authMethod===`chatgpt`&&e.hasChatGptToken===!1?`login`:t.status===`loading`?null:t.status===`allowed`?a===`loading`?null:a===`required`?`login`:o||(n||l||f||(u?.roots.length??0)>0?`app`:c&&!s||d?null:`welcome`):`app`}';
if (matched[0] !== expected) throw new Error('Onboarding routing baseline changed');
const base = {
  auth: { isLoading: false, authMethod: 'apikey', requiresAuth: false },
  codexFeatureAccess: { status: 'allowed' },
  isOnboardingContextFetched: true,
  workspaceRootsData: { roots: [] },
};
const cases = [
  ['fresh-local-context', {}, 'welcome'],
  ['workspace-present', { workspaceRootsData: { roots: ['synthetic-project'] } }, 'app'],
  ['backend-completed', { backendOnboardingCompleted: true }, 'app'],
  ['projectless-completed', { projectlessOnboardingCompleted: true }, 'app'],
  ['workspace-timeout', { workspaceRootsTimedOut: true }, 'app'],
  ['workspace-loading', { workspaceRootsIsLoading: true }, null],
  [
    'auth-required-with-workspace',
    { auth: { requiresAuth: true }, workspaceRootsData: { roots: ['synthetic-project'] } },
    'login',
  ],
  [
    'chatgpt-token-missing',
    { auth: { authMethod: 'chatgpt', hasChatGptToken: false }, backendOnboardingCompleted: true },
    'login',
  ],
  [
    'gateway-required',
    { gatewayOAuthReadiness: 'required', backendOnboardingCompleted: true },
    'login',
  ],
  ['feature-loading', { codexFeatureAccess: { status: 'loading' } }, null],
];
const results = cases.map(([name, changes, expectedResult]) => {
  const result = runInNewContext(
    `(${matched[0]})(input)`,
    { input: { ...base, ...changes } },
    { timeout: 1000 },
  );
  if (result !== expectedResult) throw new Error('Unexpected synthetic route result');
  return { name, result, passed: true };
});
const report = {
  evidenceLevel: 'installed-code-pure-function-with-synthetic-state',
  bundle: {
    name: names[0],
    sha256: createHash('sha256').update(bytes).digest('hex'),
    functionOffset: matched.index,
  },
  productionStateRead: false,
  productionStateModified: false,
  onboardingBypassed: false,
  guiAcceptance: false,
  supportedFixtureSetupVerified: false,
  cases: results,
  passed: true,
};
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');

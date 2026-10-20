import {
  mkdirSync,
  mkdtempSync,
  cpSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
mkdirSync(resolve('artifacts'), { recursive: true });
const stage = mkdtempSync(resolve('artifacts/.package-'));
const root = join(stage, 'AgentDeck-0.1.0-windows-source');
mkdirSync(root, { recursive: true });
for (const path of [
  'android',
  'bridge/src',
  'bridge/test',
  'bridge/generated',
  'bridge/schema-lock.json',
  'bridge/package.json',
  'bridge/tsconfig.json',
  'packages/protocol',
  'scripts',
  'docs',
  '.github',
  '.env.example',
  '.gitignore',
  '.prettierignore',
  '.prettierrc.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'README.md',
  'TECHNICAL_DESIGN.md',
  'CHANGELOG.md',
  'eslint.config.mjs',
  'vitest.config.ts',
]) {
  cpSync(path, join(root, path), {
    recursive: true,
    filter: (source) =>
      !source
        .split(/[\\/]/)
        .some((part) =>
          ['node_modules', 'dist', 'build', '.gradle', '.kotlin', 'local.properties'].includes(
            part,
          ),
        ),
  });
}
mkdirSync(join(root, 'android-apk'), { recursive: true });
const apk = 'android/app/build/outputs/apk/debug/app-debug.apk';
if (!existsSync(apk)) throw new Error('Build android assembleDebug before packaging');
cpSync(apk, join(root, 'android-apk/AgentDeck-0.1.0-debug.apk'));
mkdirSync(join(root, 'verification'), { recursive: true });
for (const name of [
  'chat-build.txt',
  'chat-lint.txt',
  'chat-final-verification.json',
  'chat-final-physical-ui-retest.txt',
  'chat-real-result.json',
  'chat-real-landscape.png',
  'chat-real-portrait.png',
  'android-conversation-tests.xml',
  'bridge-tests.xml',
  'codex-smoke.json',
  'real-bridge-smoke.json',
  'real-wss-smoke.json',
  'real-approval-smoke.json',
  'startup-check.json',
  'windows-native.json',
  'android-physical-ui.json',
  'android-physical-ui-first-settings-run.json',
  'android-rotation-first-settings-run.txt',
  'android-physical-lan.txt',
  'pad-lan-tcp-probe.json',
  'pad-lan-tcp-probe.txt',
  'android-physical-lan-retest.txt',
  'physical-lan-result.json',
  'physical-lan-bridge-evidence.json',
  'physical-lifecycle-result.json',
  'physical-human-approval-rejected.json',
  'physical-human-approval-approved.json',
  'physical-git-result.json',
  'physical-coding-result.json',
  'physical-connected-ui-result.json',
  'physical-production-restart-result.json',
  'production-restart-coordinator.json',
  'android-physical-lifecycle.txt',
  'android-physical-git.txt',
  'android-physical-git-first.txt',
  'android-physical-coding.txt',
  'android-physical-connected-ui.txt',
  'android-physical-production-restart.txt',
  'android-physical-production-restart-first.txt',
  'android-physical-approval-instrumentation-first.txt',
  'real-shell-smoke.json',
  'real-shell-smoke-msix-failure.json',
  'pad-connected-landscape.png',
  'pad-connected-portrait.png',
  'android-diff-tests.xml',
  'android-protocol-tests.xml',
  'android-lint.txt',
  'pad-landscape.png',
  'pad-portrait.png',
  ...readdirSync('artifacts').filter((name) =>
    /^android-(?:pairingDialog|launchesWithout|physicalRotation|keystoreRoundTrip|offlineWorkbench|settingsTheme|gitReview|temporaryMask).+\.txt$/.test(
      name,
    ),
  ),
]) {
  if (existsSync(join('artifacts', name)))
    cpSync(join('artifacts', name), join(root, 'verification', name));
}
writeFileSync(
  join(root, 'INSTALL.cmd'),
  '@echo off\r\ncd /d "%~dp0"\r\ncall pnpm install --frozen-lockfile\r\nif errorlevel 1 exit /b 1\r\ncall pnpm build\r\nif errorlevel 1 exit /b 1\r\necho Installation complete. Run scripts\\start-bridge.cmd\r\npause\r\n',
);
function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)],
  );
}
const manifest =
  files(root)
    .filter((path) => path !== join(root, 'SHA256SUMS.txt'))
    .map(
      (path) =>
        `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${relative(root, path).replaceAll('\\', '/')}`,
    )
    .join('\n') + '\n';
writeFileSync(join(root, 'SHA256SUMS.txt'), manifest);
const zip = resolve('artifacts/AgentDeck-0.1.0-windows-source.zip');
execFileSync('tar.exe', ['-a', '-c', '-f', zip, '-C', stage, 'AgentDeck-0.1.0-windows-source'], {
  shell: false,
  windowsHide: true,
});
writeFileSync(
  zip + '.sha256',
  createHash('sha256').update(readFileSync(zip)).digest('hex') +
    '  AgentDeck-0.1.0-windows-source.zip\n',
);
console.log(`Source distribution (requires Node/pnpm + install): ${zip}`);

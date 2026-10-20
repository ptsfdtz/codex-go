import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const zip = resolve(process.argv[2] ?? 'artifacts/AgentDeck-0.1.0-windows-source.zip');
const prefix = 'AgentDeck-0.1.0-windows-source';
const entries = execFileSync('tar.exe', ['-t', '-f', zip], {
  shell: false,
  windowsHide: true,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
})
  .split(/\r?\n/)
  .filter(Boolean);
for (const entry of entries) {
  const parts = entry.replaceAll('\\', '/').split('/');
  if (
    parts[0] !== prefix ||
    parts.includes('..') ||
    parts.includes('node_modules') ||
    parts.includes('local.properties') ||
    /\.(?:dpapi|db|keystore|jks|pfx|pem)$/i.test(entry) ||
    basename(entry) === 'auth.json'
  )
    throw new Error('Unexpected distribution entry: ' + entry);
}
mkdirSync(resolve('artifacts'), { recursive: true });
const extracted = mkdtempSync(resolve('artifacts/.verify-package-'));
execFileSync('tar.exe', ['-x', '-f', zip, '-C', extracted], { shell: false, windowsHide: true });
const root = join(extracted, prefix);
const manifest = readFileSync(join(root, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
for (const line of manifest) {
  const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
  if (!match || match[2].split('/').includes('..'))
    throw new Error('Invalid package checksum record');
  const path = join(root, match[2]);
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== match[1])
    throw new Error('Checksum mismatch: ' + match[2]);
}
for (const path of [
  'android-apk/AgentDeck-0.1.0-debug.apk',
  'android/gradlew.bat',
  'android/gradle/wrapper/gradle-wrapper.jar',
  'bridge/test/appserver-fixture.mjs',
  'bridge/generated/schema/v2/TurnStartResponse.json',
  'scripts/native/HostUi.cs',
  'INSTALL.cmd',
  'docs/ACCEPTANCE.md',
])
  if (!existsSync(join(root, path))) throw new Error('Missing distribution file: ' + path);
const report = {
  at: new Date().toISOString(),
  result: 'PASS',
  archive: zip,
  sha256: createHash('sha256').update(readFileSync(zip)).digest('hex'),
  verifiedFiles: manifest.length,
  extractedRoot: root,
  scope: 'Archive contents and every SHA-256; clean build is recorded separately',
};
writeFileSync(resolve('artifacts/package-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

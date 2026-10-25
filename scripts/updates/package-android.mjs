// Package the actual Gradle APK and metadata; never infer the Android version from a Git tag.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const version = process.env.AGENTDECK_RELEASE_VERSION;
if (!version || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(version) || version.includes('..'))
  throw new Error('Set an immutable AGENTDECK_RELEASE_VERSION');
const source = resolve(process.argv[2] || 'android/app/build/outputs/apk/debug');
const output = resolve(process.argv[3] || 'artifacts/host-downloads');
const metadata = JSON.parse(readFileSync(join(source, 'output-metadata.json'), 'utf8'));
if (metadata.applicationId !== 'dev.agentdeck.app' || metadata.elements?.length !== 1)
  throw new Error('Only the production package and a single universal APK can be published');
const entry = metadata.elements[0];
if (
  !Number.isInteger(entry.versionCode) ||
  entry.versionCode < 1 ||
  typeof entry.versionName !== 'string' ||
  !/^[a-zA-Z0-9._-]+\.apk$/.test(entry.outputFile)
)
  throw new Error('Invalid APK metadata');
const bytes = readFileSync(join(source, entry.outputFile));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const directory = join(output, 'releases', version);
mkdirSync(directory, { recursive: true });
copyFileSync(join(source, entry.outputFile), join(directory, 'AgentDeck-android.apk'));
writeFileSync(join(directory, 'AgentDeck-android.apk.sha256'), sha256 + '\n');
mkdirSync(join(output, 'android'), { recursive: true });
const manifest =
  JSON.stringify(
    {
      versionName: entry.versionName,
      versionCode: entry.versionCode,
      file: `releases/${version}/AgentDeck-android.apk`,
      sha256,
    },
    null,
    2,
  ) + '\n';
writeFileSync(join(directory, 'android.json'), manifest);
writeFileSync(join(output, 'android', 'stable.json'), manifest);
console.log(`Android ${entry.versionName} (${entry.versionCode}): ${sha256}`);

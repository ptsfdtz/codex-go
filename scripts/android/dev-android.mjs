import { spawn, execFileSync } from 'node:child_process';
import { watch, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Native Android uses rebuild/install/restart here, not Compose Live Edit.
const root = fileURLToPath(new URL('../../', import.meta.url));
const android = join(root, 'android');
const once = process.argv.includes('--once');
if (process.argv.includes('--help')) {
  console.log(
    'pnpm android:dev [--once]\nSave Android sources to rebuild, install and restart. Set ANDROID_SERIAL when multiple devices are connected. Ctrl+C stops watching. App data is retained; process/UI state may reset.',
  );
  process.exit(0);
}
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  join(process.env.LOCALAPPDATA ?? '', 'Android/Sdk');
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const devices = execFileSync(adb, ['devices'], { encoding: 'utf8', windowsHide: true })
  .split(/\r?\n/)
  .map((line) => line.trim().split(/\s+/))
  .filter((row) => row[1] === 'device')
  .map((row) => row[0]);
const serial = process.env.ANDROID_SERIAL ?? (devices.length === 1 ? devices[0] : undefined);
if (!serial || !devices.includes(serial))
  throw new Error(
    'Connect and authorize one Android device, or set ANDROID_SERIAL to a connected device.',
  );
console.log(
  `Android development preview: ${serial}. Updates restart the app; no uninstall or data clearing.`,
);
let child;
let stopped = false;
let dirty = false;
let running = false;
let timer;
const watchers = [];
function run(command, args, cwd = root) {
  return new Promise((accept, reject) => {
    child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true, shell: false });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? accept() : reject(new Error(`Command failed (${code}): ${command}`)),
    );
  });
}
async function refresh() {
  if (running || stopped) return;
  running = true;
  dirty = false;
  try {
    if (process.platform === 'win32') {
      await run(
        process.env.ComSpec ?? 'cmd.exe',
        ['/d', '/c', 'gradlew.bat --console=plain :app:assembleDebug'],
        android,
      );
    } else {
      await run('./gradlew', ['--console=plain', ':app:assembleDebug'], android);
    }
    // A newer save supersedes this build before deploying it.
    if (dirty || stopped) return;
    await run(adb, [
      '-s',
      serial,
      'install',
      '-r',
      join(android, 'app/build/outputs/apk/debug/app-debug.apk'),
    ]);
    if (stopped) return;
    await run(adb, ['-s', serial, 'shell', 'am', 'force-stop', 'dev.agentdeck.app']);
    await run(adb, [
      '-s',
      serial,
      'shell',
      'am',
      'start',
      '-W',
      '-n',
      'dev.agentdeck.app/.MainActivity',
    ]);
    console.log('Preview updated. Waiting for Android source changes…');
  } catch (error) {
    console.error(
      `${error.message}\nFix the build/device issue and save again. Installation failures never trigger uninstall.`,
    );
    if (once) process.exitCode = 1;
  } finally {
    running = false;
    if (dirty && !stopped && !once) schedule();
  }
}
function schedule() {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    void refresh();
  }, 600);
}
if (!once) {
  for (const relative of ['app/src/main', 'app/src/debug', 'gradle']) {
    const path = resolve(android, relative);
    if (existsSync(path)) watchers.push(watch(path, { recursive: true }, schedule));
  }
  for (const relative of [
    'app/build.gradle.kts',
    'build.gradle.kts',
    'settings.gradle.kts',
    'gradle.properties',
  ]) {
    watchers.push(watch(join(android, relative), schedule));
  }
}
process.on('SIGINT', () => {
  stopped = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  child?.kill();
  process.exit(130);
});
await refresh();

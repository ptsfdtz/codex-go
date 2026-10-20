import { spawn, execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout, clearTimeout } from 'node:timers';

// Explicit UI test driver. Does not pair devices, change permissions, or approve operations.
const adb = join(
  process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? '', 'Android/Sdk'),
  'platform-tools/adb.exe',
);
const serial = process.env.ANDROID_SERIAL;
if (!serial) throw new Error('Set ANDROID_SERIAL to the authorized test device');
const args = ['-s', serial];
execFileSync(adb, [...args, 'get-state'], { stdio: 'pipe', shell: false });
const tests = process.env.AGENTDECK_UI_TESTS?.split(',') ?? [
  'conversationRendersMarkdownAndKeepsExecutionCollapsed',
  'chatComposerKeepsSeparateDraftsAndNeverSendsOffline',
  'pairingDialogExplainsLocalConfirmation',
  'launchesWithoutDemoAndSurvivesRecreation',
  'physicalRotationKeepsPairingReachable',
  'keystoreRoundTripAndRoomTransaction',
  'offlineWorkbenchRendersLongLogsAndDisablesApprovalInBothOrientations',
  'settingsThemePersistsAndNotificationsRemainOptIn',
  'gitReviewFiltersRenameAndDisplaysSourceLineNumbersInBothOrientations',
  'temporaryMaskHidesLogsAndDiffButKeepsApprovalContext',
];
if (
  process.env.AGENTDECK_PHYSICAL_LAN === 'true' &&
  !tests.includes('realChatComposerCompletesAndRestoresDraft')
)
  tests.push('realChatComposerCompletesAndRestoresDraft');
const results = [];
mkdirSync(resolve('artifacts'), { recursive: true });
for (const test of tests) {
  const child = spawn(
    adb,
    [
      ...args,
      'shell',
      'am',
      'instrument',
      '-w',
      '-r',
      ...(process.env.AGENTDECK_PHYSICAL_LAN === 'true' ? ['-e', 'physicalLan', 'true'] : []),
      '-e',
      'class',
      `dev.agentdeck.app.AppTest#${test}`,
      'dev.agentdeck.app.test/androidx.test.runner.AndroidJUnitRunner',
    ],
    { shell: false, windowsHide: true },
  );
  let output = '',
    assisted = false,
    launchTimer;
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(text);
    if (!launchTimer && output.includes('INSTRUMENTATION_STATUS_CODE: 1'))
      launchTimer = setTimeout(() => {
        // HyperOS can leave ActivityScenario waiting for its LAUNCHER intent. Use the exact standard intent.
        try {
          const activities = execFileSync(
            adb,
            [...args, 'shell', 'dumpsys', 'activity', 'activities'],
            {
              shell: false,
              windowsHide: true,
              timeout: 10000,
              encoding: 'utf8',
            },
          );
          // Never relaunch a test Activity that is already running, especially during rotation.
          if (/topResumedActivity=.*dev\.agentdeck\.app\//.test(activities)) return;
          execFileSync(
            adb,
            [
              ...args,
              'shell',
              'am',
              'start',
              '-W',
              '-a',
              'android.intent.action.MAIN',
              '-c',
              'android.intent.category.LAUNCHER',
              '-f',
              '0x10008000',
              '-n',
              'dev.agentdeck.app/.MainActivity',
            ],
            { shell: false, windowsHide: true, timeout: 15000, stdio: 'pipe' },
          );
          assisted = true;
        } catch (error) {
          output += `\nLaunch assist failed: ${error.message}\n`;
        }
      }, 1000);
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  const timeout = setTimeout(() => {
    child.kill();
    execFileSync(adb, [...args, 'shell', 'am', 'force-stop', 'dev.agentdeck.app'], {
      shell: false,
      windowsHide: true,
    });
  }, 90000);
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  clearTimeout(timeout);
  clearTimeout(launchTimer);
  const passed =
    code === 0 &&
    /OK \(1 test\)/.test(output) &&
    !/FAILURES!!!|INSTRUMENTATION_FAILED/.test(output);
  writeFileSync(resolve(`artifacts/android-${test}.txt`), output);
  results.push({ test, result: passed ? 'PASS' : 'FAIL', standardLauncherAssist: assisted });
}
const report = {
  at: new Date().toISOString(),
  source:
    'Physical Android device; actual Compose assertions, standard launcher assist for HyperOS',
  result: results.every((r) => r.result === 'PASS') ? 'PASS' : 'FAIL',
  tests: results,
};
writeFileSync(resolve('artifacts/android-physical-ui.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.result === 'FAIL') process.exitCode = 1;

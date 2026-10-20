# Development

Windows Bridge is tested on Windows 11 and Node 22.22.3. Android uses AGP 8.13.2, Kotlin 2.2.21, Gradle 8.14.3, JDK 21, minSdk 28 and target/compileSdk 36. Exact dependencies are locked; do not independently update Codex or edit generated contracts.

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm test
pnpm schema:verify
pnpm audit --prod
pnpm dev
```

Build before test because the shared protocol package exports its compiled JS. `pnpm build` also copies JSON schema assets alongside compiled Bridge modules. `pnpm start` runs compiled production JS; `pnpm dev` uses tsx. Run from the repository root so native sources resolve correctly. Helpers are cached by source SHA-256; changes compile a new binary. No PowerShell execution-policy bypass is used.

Android SDK can be selected with `ANDROID_HOME` or ignored `android/local.properties` (`sdk.dir=C\:/Users/user/AppData/Local/Android/Sdk` on this machine). Do not commit machine-local paths. Gradle downloads dependencies and the pinned wrapper distribution on a clean machine.

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
# Physical device or configured emulator; installation must be allowed
.\gradlew.bat connectedDebugAndroidTest
```

Room schema v1 is exported under `android/app/schemas`; future schema changes must add explicit migrations. Android unit tests include QR validation, terminal labels, pin match/mismatch, real public-certificate checks, additive response compatibility, and timeline item isolation. Instrumentation covers no-demo first launch, activity recreation, pairing guidance, Keystore/Room, rotation, persisted appearance and opt-in notifications, and a clearly isolated UI fixture with 6,000 log entries and disabled offline approvals. Instrumentation requires an unpaired test installation; do not run it on an active production pairing.

HyperOS on the physical Pad can leave ActivityScenario waiting for its standard LAUNCHER intent. The reproducible driver below isolates each method and supplies that exact intent after the runner starts. It still executes all actual Compose assertions; it never changes device permissions, provisions devices or approves requests. Results explicitly record `standardLauncherAssist`.

```powershell
$env:ANDROID_SERIAL='d1420d4'
node scripts/android-physical-ui.mjs
```

Use `bridge/test/physical-host.ts` and the separately opted-in physical tests only on a trusted reachable LAN, with human Windows pairing confirmation. Default Android runs skip these tests. The host grants only temporary fixture projects, never business repositories. `AGENTDECK_PHYSICAL_RESUME_ROOT` may resume a directory marked by this harness. Local stdin commands are `invite`, `approval`, `crash` (deliberate abrupt exit) and `stop`; none is a network API. The `approval` command waits for a real human and verifies the authenticated tablet decision, duplicate refusal, upstream terminal and (on allow) exit code/output. `prepare-physical-git.ts` prepares real rename/binary/oversize fixtures only inside a marked temporary harness. See [ACCEPTANCE](ACCEPTANCE.md) for successful physical LAN, human decisions, production restart evidence and remaining release gates.

Real smoke commands and evidence:

| Command                         | Evidence                                                            |
| ------------------------------- | ------------------------------------------------------------------- |
| pnpm smoke:codex                | artifacts/codex-smoke.json                                          |
| pnpm smoke:bridge               | artifacts/real-bridge-smoke.json                                    |
| pnpm smoke:approval             | artifacts/real-approval-smoke.json; requires human Windows decision |
| pnpm verify:windows             | artifacts/windows-native.json                                       |
| node scripts/verify-startup.mjs | artifacts/startup-check.json                                        |

Smoke output distinguishes PASS, FAIL, SKIPPED. Real API usage may consume account quota. Authentication checks request only account availability; no credential files or token contents are inspected. Raw locally captured protocol samples in `artifacts/` must be sanitized before promoting to test fixtures. Regenerate the public-only long-lived Android test certificate with `pnpm exec tsx scripts/test-certificate.ts`; no private key is saved.

`pnpm package:windows` creates a source distribution requiring a normal install/build on the target PC; it does not bundle Node or native SQLite. GitHub Actions checks Windows build/tests/audit/schema and Android lint/unit/APK build. It does not authenticate a Codex account, open a LAN listener, approve real tasks or claim physical-device acceptance.

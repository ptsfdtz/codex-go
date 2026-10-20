# Development

Windows uses React/Tauri and a native Rust service. Node 22.22.x / pnpm 12.3.4 are development tools only. Install Rust MSVC, Visual Studio C++ tools and WebView2. Both Cargo.lock files and pnpm-lock.yaml must be retained. Do not independently update Codex or edit exported JSON schemas.

```powershell
pnpm install --frozen-lockfile
pnpm schema:verify
pnpm check
pnpm build
pnpm desktop:prepare
pnpm test
pnpm --filter @agentdeck/desktop exec playwright test
cargo clippy --locked --manifest-path desktop/core/Cargo.toml --all-targets -- -D warnings
cargo clippy --locked --manifest-path desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm desktop:build
pnpm package:windows
```

Rust integration fixtures live in desktop/core/tests/fixtures and validate protocol framing, lifecycle, approvals, paths, SQLite recovery, Git, TLS and WebSocket authentication. They use Node as an isolated mock App Server; no mock data is used in the default product. The native application does not launch Node.

Real checks are explicit, separate from unattended CI:

```powershell
cargo build --locked --manifest-path desktop/core/Cargo.toml
pnpm native:check
# Real text-only model turns including resume; consumes account quota
pnpm smoke:codex
# Optional: isolated SQLite backup of existing user data; never mutates source
node scripts/check-native-data.mjs
```

The startup check uses a temporary data directory and verifies real DPAPI, TLS, MXC inside/outside boundaries and Codex initialization without starting an AI task. check-native-data and migration tooling use Node's built-in node:sqlite (experimental warning on Node 22); it is not part of the shipped runtime. Real tests require the current user's logged-in CLI 0.159.2. No login files or token values are read. Human pairing/approvals are never automated. CI runs fixture tests and builds only, not authenticated model requests or physical-device acceptance.

Android uses AGP 8.13.2, Kotlin 2.2.21, Gradle 8.14.3, JDK 21 and SDK 36 (minSdk 28). Set ANDROID_HOME or ignored android/local.properties; do not commit machine-local paths.

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
# Unpaired dedicated test installation with USB install allowed
.\gradlew.bat connectedDebugAndroidTest
```

The public-only Android test certificate stays in test resources; no private key is needed. Room schemas are exported under android/app/schemas and future changes need explicit migrations. Instrumentation covers first launch, rotation/recreation, Keystore/Room, long logs, offline approvals, themes and opt-in notifications. HyperOS may require the exact LAUNCHER intent; scripts/android-physical-ui.mjs isolates methods and records standardLauncherAssist without granting system permissions.

The old Node physical-host harness was removed with its implementation. Opted-in Android physical tests remain available, but their local fixture orchestration must be adapted to the native service before rerunning; they are not part of default unattended tests. Fresh Rust physical LAN/pairing/approval verification is pending, as recorded in ACCEPTANCE.md. Historical reports do not establish native-version acceptance.

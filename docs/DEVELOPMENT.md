# Development

## GitHub CI与Pre-release

分支 push、PR 和手动运行 `AgentDeck CI` 执行现有 Windows/Android 检查与构建，并上传 `release-windows`、`release-android` 下载附件。

统一发布入口为 `.github/workflows/release.yaml`：推送 `release` 分支自动发布 Pre-release，标签为 `pre-运行号-重试号`；推送任意标签时，先验证标签提交属于远端 `main` 历史，再构建并创建正式 Release（Latest）。不属于 main 的标签会被拒绝。Git 标签本身不属于分支，因此用提交祖先关系验证来源。两个平台检查全部通过后，独立的 `contents: write` job 才发布附件。重复发布同一标签会失败，不覆盖既有 Release。普通 main push 和 PR 只运行 CI。

Release Assets 包含 Windows x64 NSIS 安装器、包含 runtime 的便携 ZIP、可安装的 Android debug APK，以及 `SHA256SUMS.txt`。无需额外发布密钥，使用 GitHub 自动生成的 `GITHUB_TOKEN`；仓库/组织策略需允许 Actions 创建 Release。PR 构建不执行发布。

Android 暂未配置正式签名，GitHub runner 的临时 debug 证书不保证不同构建间可覆盖升级；卸载会清除本地配对与数据。Windows 未配置代码签名。标签不修改应用内部版本（当前 0.3.0 / Android versionCode 2）。这仅是阶段版分发，不代表完整迁移验收。认证 Codex 请求及真机测试不在 CI 自动执行。


Windows uses React/Tauri and a native Rust service. Node 22.22.3 / pnpm 12.3.4 are development tools only. Install Rust MSVC, Visual Studio 2022 C++ tools, Windows 11 SDK 10.0.26100.0 and WebView2. Both Cargo.lock files and pnpm-lock.yaml must be retained. Do not independently update Codex or edit exported JSON schemas.

On Windows, run `scripts\setup-windows-dev.ps1` from PowerShell to install the Node, Rust and Java toolchains under the current user's profile, set up Android SDK 36, and install the pnpm workspace dependencies. The script writes `android/local.properties` and configures Android SDK environment variables for the current Windows user. Visual Studio Build Tools, the Windows SDK and WebView2 remain machine prerequisites. If PowerShell blocks local scripts, run `Set-ExecutionPolicy -Scope Process Bypass` in that terminal before starting setup.

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

The startup check uses a temporary data directory and verifies real DPAPI, TLS, MXC inside/outside boundaries and Codex initialization without starting an AI task. check-native-data and migration tooling use Node's built-in node:sqlite (experimental warning on Node 22); it is not part of the shipped runtime. Real tests require the current user's logged-in CLI 0.159.2. The desktop can install that verified Windows x64 binary alongside other CLI installs from the npm registry after checking its SHA-512 integrity; it does not replace global Codex. Newer CLI versions remain unsupported until their schemas, sandbox and approval behavior are revalidated. No login files or token values are read. Human pairing/approvals are never automated. CI runs fixture tests and builds only, not authenticated model requests or physical-device acceptance.

Android uses AGP 8.13.2, Kotlin 2.2.21, Gradle 8.14.3, JDK 21 and SDK 36 (minSdk 28). Set ANDROID_HOME or ignored android/local.properties; do not commit machine-local paths.

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
# Unpaired dedicated test installation with USB install allowed
.\gradlew.bat connectedDebugAndroidTest
```

The public-only Android test certificate stays in test resources; no private key is needed. Room schemas are exported under android/app/schemas and future changes need explicit migrations. Instrumentation covers first launch, rotation/recreation, Keystore/Room, long logs, offline approvals, themes and opt-in notifications. HyperOS may require the exact LAUNCHER intent; scripts/android-physical-ui.mjs isolates methods and records standardLauncherAssist without granting system permissions.

The old Node physical-host harness was removed with its implementation. Opted-in Android physical tests remain available, but their local fixture orchestration must be adapted to the native service before rerunning; they are not part of default unattended tests. Fresh Rust physical LAN/pairing/approval verification is pending, as recorded in ACCEPTANCE.md. Historical reports do not establish native-version acceptance.

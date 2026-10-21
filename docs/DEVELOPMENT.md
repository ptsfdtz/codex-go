# Development

## 完整 Codex 安卓迁移开发

接手此项工作先阅读 [迁移计划](CODEX_PARITY_PLAN.md) 和 [当前进度与接手记录](CODEX_PARITY_STATUS.md)。根目录 `AGENTS.md` 提供 Agent 接手规则。历史“简化远程客户端”范围不是新的最终目标；现有构建、版本和权限约束在完成兼容验证前仍然有效。

桌面版本与候选接口证据见 [桌面技术基准](CODEX_DESKTOP_BASELINE.md)。运行 `node scripts/audit-codex-protocol.mjs <绝对路径codex.exe> artifacts/parity-baseline` 可重新导出对比报告；不会修改生产 schema lock。按用户最新要求，每轮完成并验证后选择性提交有用改动，其他任务不混入提交；轮次提交不代表阶段验收完成。

审计同时输出 `protocol-contract-differences.json`，覆盖传递引用后的请求、审批、通知和响应合约；changed 包含描述字段变化，不代表自动判定破坏兼容。大差异值提供 SHA-256/长度而非重复完整 schema，可重新导出查看来源。工具回归：`node --test scripts/lib/protocol-contracts.test.mjs`。实验结果比较对象为固定稳定基准，不能把全部新增计为版本新增。

共享运行时隔离检查：`node scripts/check-shared-codex-runtime.mjs <绝对路径codex.exe> artifacts/parity-shared` 默认不执行模型轮次。添加 `--synthetic-turn` 使用本机合成模型验证双客户端同轮次追加、中断与恢复，不使用账户额度；固定版 0.159.2 验证已有历史时再加 `--prime-turn`。脚本启动临时认证回环服务，不接入用户已有任务，也不能代替原版桌面/安卓真实验收。报告不包含测试 token 或完整消息。

Rust WS 传输测试：`cargo test --locked --manifest-path desktop/core/Cargo.toml --test runtime_websocket`。真实隔离无模型检查需显式设置 `AGENTDECK_SHARED_PROBE_EXE` 为固定版本 Codex 可执行文件，再运行同命令并追加 `real_pinned_runtime_accepts_two_rust_clients -- --ignored --nocapture`。测试不修改生产配置或启动运行中的原版桌面；不能用新版 CLI 绕过固定 schema 版本验证。

新版连接级 schema 检查：`cargo test --locked --manifest-path desktop/core/Cargo.toml --test protocol_versions`。真实桌面基准检查设置 `AGENTDECK_DESKTOP_PROBE_EXE` 为精确 0.163.0-alpha.10.2 二进制，再运行 `cargo test --locked --manifest-path desktop/core/Cargo.toml --test runtime_websocket real_desktop_baseline_uses_versioned_rust_contracts -- --ignored --nocapture`。它仅操作隔离认证服务，不能代替原版桌面或完整任务验收。版本 overlay 已捕获，不运行 pin-desktop-protocol.mjs 覆盖；schema:verify 同时核验旧版和 overlay。该真实检查包含实际服务二进制入口、同版本 boundary、版本报告及 Core 重连。勿单改版本判断绕过业务/实验 schema 与权限验证。

本机服务监督现可通过同时设置 `AGENTDECK_RUNTIME_WS_URL=ws://127.0.0.1:<端口>` 和 `AGENTDECK_RUNTIME_TOKEN_FILE=<凭据文件绝对路径>` 连接已运行的认证服务。凭据文件由该本机服务的管理者提供，内容为 32–4096 字符 base64url token，可带末尾换行；不得提交仓库或传给安卓。地址只允许精确回环 IP、显式端口、根路径，不允许远程主机、用户信息或 query。每次重连重新读取文件；错误不会启动替代服务。实际握手版本、沙箱 readiness、现有 AgentDeck 权限 profile 和本机 boundary gate 都必须通过，不自动修改共享配置来满足检查。该入口目前仅用于迁移开发；默认使用 0.159.2，可额外设置 `AGENTDECK_RUNTIME_PROTOCOL_VERSION=0.163.0-alpha.10.2` 及 `AGENTDECK_CODEX_EXE=<匹配版本exe绝对路径>` 接入基准新版。版本选项不能脱离 WS 配置单独使用，未知版本拒绝。可执行文件、实际服务握手和 boundary 使用同一版本；没有匹配 exe 时明确失败，不自动切换。原版桌面认证连接、真实模型及安卓全链路尚未验收，不能宣称已接管桌面会话。

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

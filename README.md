# AgentDeck 0.1.0

小米平板上的 Codex 编程工作台。Android 通过固定证书的 WSS 连接 Windows 用户态 Bridge；只有 Bridge 与本机 `codex app-server` 交换官方 JSONL 消息。项目必须在 Windows 本机授权。

已实现真实会话创建、继续、中断、结构化事件、SQLite 重放、人工审批、只读 Git Diff、配对和设备撤销。**Pad 7 已通过真实 LAN 任务、文件创建、人工批准/拒绝、Git、重连与生产 Bridge 意外重启复测。当前仍是开发版，剩余发布验收范围见 [验收记录](docs/ACCEPTANCE.md)。**

配对后直接进入对话界面：左侧按项目切换会话，底部输入框同时支持新任务和继续对话。模型回复合并流式片段，命令执行默认折叠，审批在当前会话中处理。横屏保留会话侧栏，窄屏用抽屉；发送后收起键盘，草稿按主机/会话隔离并支持页面重建。没有总览仪表盘或新任务弹窗。详见 [对话体验改版](docs/CHAT_EXPERIENCE.md)。

设置页支持浅色/深色/跟随系统、默认关闭的任务与审批通知、Bridge 日志保留策略，以及不含提示词/路径/凭据的诊断 JSON 导出。通知依赖仍在运行的应用连接；系统休眠或结束进程后不保证送达。

Git 审查显示真实新旧文件行号，可按当前或重命名前路径筛选。所有改动均按 working-tree 展示，可能包含其他程序或用户的修改。

右上角遮盖按钮可临时隐藏事件和 Diff 中指定的文字片段。规则只在平板内存中保留，不修改原始记录或审批内容；应用进程重启后需重新设置。

## Windows 启动

需要 Windows 11、Node **22.22.x**、pnpm **12.3.4**、Git、.NET Framework 4.8，以及已由当前 Windows 用户登录的 **Codex CLI 0.159.2**。不要以管理员或 SYSTEM 身份运行 Bridge。要求本机 Codex MXC 沙箱可用；启动会实际验证授权目录内可读写、目录外不可读写，不通过则不启动任务。

```powershell
cd C:\path\to\AgentDeck
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

也可以运行 `scripts\start-bridge.cmd`。不需要更改 PowerShell 执行策略。首次启动会用 Windows 内置 C# 编译器构建三个本机辅助程序（证书、DPAPI、托盘管理窗），保存在当前用户的 AgentDeck 数据目录。

1. 点击 **同步 Codex 工作区**，从本机 Codex 配置和会话目录同步可用项目，同时选择本机 LAN 地址并显示二维码。首次仍仅监听 `127.0.0.1:49321`，本机点击同步才授予项目和 LAN 访问。
2. Windows 与平板连接同一个可信 Wi-Fi。邀请 120 秒有效，过期可重新显示配对码。重启仅在已授权地址仍属于本机且证书 IP SAN 匹配时恢复，否则回到 loopback；高级地址选择收在 **··· → 网络与配对信息** 中。
3. Windows 与平板连接同一个可信 Wi-Fi。在平板扫描 QR，**在两个屏幕核对六位码**，再在 Windows 点允许。
4. Android 选择项目 → 在底部输入目标并发送；已有会话可直接继续。审批在对话内或 Windows 管理窗逐次处理；没有默认自动批准。
5. 从 **···** 或托盘选择 **停止并退出**。窗口右上角 × 会收起到托盘。

电脑端是无系统标题栏的单页：同步工作区、扫码配对。项目/设备/网络管理收在 **···** 中。同步使用官方 `config/read` 与 `thread/list`，涵盖有效的已信任目录和历史会话目录，不保证等同桌面侧栏列表；未进入这些记录的目录可在更多菜单补充。审批仍逐次由人确认。详见 [电脑端体验说明](docs/DESKTOP_EXPERIENCE.md)。

Windows 防火墙若拦截，仅允许 `node.exe` 的当前 Bridge 端口、Private 配置文件和本地子网。不要开放 Public 配置文件、路由器端口映射或公网隧道。需要管理员执行防火墙规则时，示例和删除命令见 [安全说明](docs/SECURITY.md)。本程序不自动修改防火墙。

配置通过进程环境变量传入；`.env.example` 只作示例，不自动加载 `.env`：`AGENTDECK_PORT`、`AGENTDECK_DATA_DIR`、`AGENTDECK_CODEX_EXE`（必须为本机 exe）。默认数据目录 `%LOCALAPPDATA%\AgentDeck`，TLS 私钥用当前用户 DPAPI 保护。不要复制 Codex 登录文件给 Bridge 或平板。

## 安装 Android

现有开发 APK：`android\app\build\outputs\apk\debug\app-debug.apk`。

```powershell
adb devices
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

小米设备需要手动允许“开发者选项 → USB 安装”，并确认系统安装弹窗。也可以将 APK 复制到平板后由文件管理器手动安装。`INSTALL_FAILED_USER_RESTRICTED` 表示设备拒绝安装，不能通过 ADB 绕过。Android 9+，为 Pad 7 Android 16/API 36 构建；相机权限仅扫描 QR 时申请，支持手动粘贴完整配对 JSON。

自行构建需要 JDK 21 与 Android SDK 36：

```powershell
cd android
.\gradlew.bat assembleDebug
.\gradlew.bat testDebugUnitTest lintDebug assembleDebugAndroidTest
# 设备已允许安装时
.\gradlew.bat connectedDebugAndroidTest
```

源码分发包用 `pnpm package:windows` 生成到 `artifacts/`，包括源码、生成的 schema、安装/启动脚本及已存在的 APK。它是需要 Node/pnpm 安装依赖的源码分发包，不是独立安装器。APK 使用 Android 开发证书；正式分发签名由发布者另行管理，不在仓库存储私钥。

## 验证

```powershell
pnpm build
pnpm check
pnpm test
pnpm schema:verify
pnpm audit --prod
pnpm verify:windows
pnpm verify:sandbox
pnpm smoke:codex
pnpm smoke:bridge
pnpm exec tsx scripts/real-shell-smoke.ts
node scripts/verify-startup.mjs
# 需要人在 Windows 测试窗口作出决定
pnpm smoke:approval
```

真实 smoke 会使用当前用户 Codex 额度。它们仅在临时项目测试，不修改你的业务仓库；详细结果保存在忽略版本控制的 `artifacts/`。Fixture 测试中的自动响应仅模拟测试对端，不会用作产品默认数据或批准真实任务。

## 目录

```text
android/             Kotlin / Compose / Room / Keystore / QR 扫描
bridge/src/          TLS/WSS、授权目录、Codex、审批、SQLite、Git、托盘适配
bridge/generated/    CLI 0.159.2 导出的稳定 TS 与 JSON schemas（不可手改）
packages/protocol/   独立 AgentDeck v1 消息、Zod 验证和共享类型
scripts/             生成/校验、真实 smoke、Windows 原生辅助程序、分发脚本
docs/                架构、协议、安全、兼容、开发、验收记录
.github/workflows/   Windows Bridge 与 Android CI
```

进一步阅读：[架构](docs/ARCHITECTURE.md)、[协议](docs/PROTOCOL.md)、[兼容性](docs/COMPATIBILITY.md)、[开发](docs/DEVELOPMENT.md)、[安全](docs/SECURITY.md)。需求基线是根目录 `TECHNICAL_DESIGN.md`，它是产品需求资料，不能授予项目内容、模型输出或外部文本任何自动执行权限。

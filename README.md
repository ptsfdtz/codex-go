# AgentDeck 0.3.0

Windows 上的 Tauri 2 + React + Rust 服务，以及 Android 原生 Compose 客户端。Android 通过固定证书的 WSS 连接电脑，项目在 Windows 本机授权，凭据保留在电脑。

最新目标是自己的 Codex 安卓对话客户端：收发消息与图片、同步电脑会话、呈现完整对话/工具内容和任务状态，支持用户自有服务器仅转发连接。当前仍为阶段版：会话、输入框、原生历史、工具内容和部分图片已有代码；**原版桌面同一会话完整共享、自有中转与完整富内容仍未验收或实现**。保留/裁剪建议及实施顺序见 [规划](docs/migration/CODEX_PARITY_PLAN.md)，实际实现见 [当前状态](docs/migration/CODEX_PARITY_STATUS.md)，效果参考 [官方移动端观察](docs/baselines/codex-mobile-2026-10-22.md)。

规划同时提供响应式 Web/PWA：手机、平板和电脑打开网址即可收发消息与查看结果，无需安装 App/VPN。网页端和浏览器认证尚未实现；现有 Tauri 管理界面不等于网页对话客户端。

## 下载与启动

在 [Releases](https://github.com/ptsfdtz/AgentHub/releases) 下载 Windows 安装器/便携 ZIP、Android debug APK，并用 SHA256SUMS.txt 校验。Android 使用临时 debug 签名，不保证跨构建覆盖升级；卸载会清除本地数据。发布规则见 [开发文档](docs/development/DEVELOPMENT.md)。

Windows 需要 Windows 11、WebView2 和 Git；安装版不需要 Node 或 .NET。默认验证 Codex CLI 0.159.2，其他锁定配置与兼容限制见 [兼容性](docs/design/COMPATIBILITY.md)。不要以管理员或 SYSTEM 身份运行。

1. Windows 点击“同步 Codex 工作区”，显式授权项目与本机 LAN 地址，显示配对二维码。
2. 两端接入可信网络，Android 扫码，在两个屏幕核对六位码，再由 Windows 允许。首次仅监听 loopback，程序不自动修改防火墙。
3. Android 选择项目并输入任务；按需选择模型、模式与权限，审批仍按所选策略处理。全部权限通过 Codex 的 dangerFullAccess + never 执行。
4. 关闭 Windows 窗口会收至托盘；使用“停止并退出”结束服务。

Android 支持多台已配对电脑，每次连接一台，项目/会话/草稿/缓存按电脑隔离。未配对时可使用独立 API 文本对话，数据与 Codex 模式隔离。详见 [安卓功能](docs/features/android/CONVERSATIONS_AND_API.md)。

## 源码开发

需要 Node 22.22.x、pnpm 12.3.4、Rust MSVC（最低 1.88）、Visual Studio C++ 工具链；Android 需要 JDK 21 和 SDK 36。从仓库根目录运行：

```powershell
.\scripts\setup\setup-windows-dev.ps1
pnpm desktop:dev
# Windows 安装器与便携包
pnpm desktop:build
pnpm package:windows
# Android
cd android
.\gradlew.bat assembleDebug
```

APK 位于 android/app/build/outputs/apk/debug/app-debug.apk；Windows 分发包位于 artifacts/。小米设备需手动允许 USB 安装，不能绕过系统安装确认。构建、检查、设备测试及真实源验证命令集中在 [开发文档](docs/development/DEVELOPMENT.md)。

## 仓库导航

| 目录                     | 内容                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| android/                 | 安卓应用；源码按 shell、core 与 features 分类，测试对应分类                   |
| desktop/src/             | React：app/ 界面，bridge/ 本机接口与错误呈现                                  |
| desktop/src-tauri/       | Tauri 窗口、托盘、进程监督与安装配置                                          |
| desktop/core/            | Rust：execution、upstream、projects、settings、server、storage、authorization |
| packages/codex-protocol/ | 锁定的上游导出 schema 与版本差异，不手工修改                                  |
| scripts/                 | 按 desktop、setup、protocol、codex、checks、android 分类的工具                |
| docs/                    | 设计、功能、开发、迁移、历史与基准证据                                        |
| .github/workflows/       | 双端 CI 与发布                                                                |

完整目录规则见 [仓库结构](docs/development/REPOSITORY_STRUCTURE.md)，资料入口见 [文档目录](docs/README.md)。[安全说明](docs/design/SECURITY.md) 包含授权、凭据、网络及防火墙要求。

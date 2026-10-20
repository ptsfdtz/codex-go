# Windows 桌面迁移 · 0.3.0

当前实现为 React 19 + Tauri 2 + 原生 Rust Bridge。旧 Node Bridge、WinForms、C# 证书/DPAPI 辅助程序和兼容服务打包脚本均已删除。Node/pnpm 仅用于源码构建与隔离测试，安装版不依赖它们。

## 运行边界

React 本地资产 → Tauri typed commands → Rust host → 私有 stdio JSONL → Rust agentdeck-service.exe → 固定 Codex CLI 0.159.2。

Rust host 负责无系统标题栏窗口、托盘、单实例、原生目录选择、数据目录锁、有界 IPC 和 Windows Job Object。Rust service 负责 TLS/WSS、SQLite、路径授权、配对、Windows DPAPI、Codex 生命周期、人工审批、事件重放和只读 Git。

Android v1 协议保持兼容。CLI 稳定 JSON schema 位于 packages/codex-protocol，Rust 构建验证每份 SHA-256；没有手写替代上游字段。测试所需 JSONL fixture 单独放在 desktop/core/tests/fixtures，不参与产品运行。

## 使用方式

首页沿用 Android 黑白灰样式，以两行显示工作区同步和设备连接；二维码按需显示，项目/设备/网络/审批收在更多菜单。窗口 × 收起到托盘；更多菜单或托盘可停止退出。同步通过官方 config/read、thread/list 发现可信配置和历史目录，不能保证与 Codex 桌面侧栏完全一致。所有授权只由 Windows 本机操作发起。

扫码需两屏核码并在 Windows 人工确认，命令/文件/权限审批仍逐次人工处理。断线、上游丢失、过期和未知方法不会自动允许。任务只有权威 terminal 才可完成；Bridge 重启先将未完成任务置为 unknown，再核实上游状态。

## 构建

需要 Windows 11、WebView2、Rust MSVC（service 最低 1.88）、Visual Studio C++ 工具链、Node 22.22.x、pnpm 12.3.4。运行需要已登录的 Codex CLI 0.159.2 和 Git。

```powershell
pnpm install --frozen-lockfile
pnpm desktop:dev
pnpm desktop:build
pnpm package:windows
```

prepare-native-desktop.mjs 构建 release service，暂存内容只有 Rust EXE 与 manifest。Tauri 将其复制到 runtime。Cargo target 路径由 cargo metadata 获取，支持 CARGO_TARGET_DIR。打包输出为 artifacts/AgentDeck_0.3.0_x64-setup.exe 和 AgentDeck-0.3.0-windows 便携目录。安装器尚未签名。

## 数据兼容

默认沿用 %LOCALAPPDATA%\AgentDeck，支持 AGENTDECK_DATA_DIR、AGENTDECK_PORT、AGENTDECK_CODEX_EXE。Rust DPAPI 使用与原实现相同的 CurrentUser 熵标识，保留 TLS 证书指纹、host ID、项目授权和设备记录。路径身份使用兼容的 Windows volume/file ID。

清理不修改已安装程序、不重置证书或配对记录。升级前需正常退出旧版，释放端口。不要同时运行两版管理同一数据库。需要迁移旧临时目录时，在停止旧服务后执行 node scripts/migrate-desktop-data.mjs <原目录> <原端口>；脚本拒绝覆盖现有数据，保留来源，不读取 Codex 登录文件。

## 验证边界

Rust 集成测试、React/浏览器 fixture 验证不等于真机 LAN 验收。此前真实 Codex 文本任务、DPAPI/MXC 启动和隔离旧数据兼容检查已有报告；当前清理后的测试结果见 ACCEPTANCE.md。新 Rust 安装版的平板扫码、真实人工审批、断线重连与意外重启仍需实机复测。历史 Node 版本记录仅保留为历史证据。

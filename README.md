# AgentDeck

自己的 Codex 对话客户端：电脑运行 Codex、保存凭据与权威会话；安卓和响应式网页/PWA 收发文字与图片、同步历史、显示工具结果与任务状态、处理审批和追问。网页打开即用，安装可选。

目标连接：`安卓 / 浏览器 → 自有 VPS（仅转发 TCP）→ 电脑服务 → Codex`。
电脑主动建立反向隧道，应用 TLS 在电脑终止；网页与 API 优先由电脑同源提供。VPS 不存聊天/媒体、不持有 OpenAI 凭据、不运行模型。此路线尚未落地。

## 当前事实与下一步（2026-10-22）

- 已有：Windows React/Tauri 管理与 Rust 服务；Android Compose 配对、会话/历史、输入框、工具内容、审批、草稿、通知及部分图片展示。
- 未完成：原版 Codex 桌面同一会话完整共享（`sharedDesktopRuntime=false`）、自有中转、Web 客户端及浏览器认证。
- 富内容缺口：完整图文内联、公式和代码高亮；附件合计上限 512 KiB，图片读取限授权项目内部分来源、8 MiB。现有 Diff 主要展示工作区差异，不等于历史任务 Diff。
- 当前 Android 支持多电脑缓存隔离、一次连接一台；服务端 `Store::replace_device` 会撤销旧设备，不能宣称同一电脑已支持多客户端共存。通知依赖应用连接，不保证系统休眠后的推送。
- 清理：删除旧设计/迁移/历史/盘点文档、独立 API 聊天、高级配置/账户/技能管理页面和一次性桌面盘点脚本。保留对话内模型/权限选择、技能引用、资源预览、Diff、核心协议及兼容接口。
- 下一步按顺序推进：原生会话共享 → 中转与浏览器认证/多设备 → Web 对话与安卓富内容 → 集中真实源、设备和视觉验收。桌面终端/编辑器/扩展管理界面不在本轮目标内，其对话结果仍需呈现。
- 本次验证：安卓主程序/设备测试源码编译、81 项 JVM 测试、删除引用/脚本导入检查通过；未进行真实上游、真机或部署验收。

## 代码地图（按需读取）

| 路径                                                    | 内容                                                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `android/app/src/main/java/dev/agentdeck/app/`          | `shell` 入口；`core` 数据/网络/存储；`features` 会话、设置、配对、技能、Diff 等                                |
| `android/app/src/test/`、`android/app/src/androidTest/` | JVM 与设备测试，按同功能归类                                                                                   |
| `desktop/src/`、`desktop/src-tauri/`                    | 电脑 React 管理界面；Tauri 托盘、窗口、进程监督                                                                |
| `desktop/core/src/`                                     | Rust：`execution` 会话；`upstream` Codex；`server` 协议；`storage` 缓存；`projects`/`authorization`/`settings` |
| `desktop/core/tests/`                                   | Rust 协议、安全、会话与真实源检查                                                                              |
| `packages/codex-protocol/`                              | 锁定版本、导出 schema、能力锁；大文件用 `rg --no-ignore` 指定目录搜索                                          |
| `scripts/`                                              | `setup` 环境；`desktop` 构建；`protocol` 导出/校验；`codex` 共享接入诊断；`checks`/`android` 验收工具          |
| `.github/workflows/`                                    | 双端构建与发布                                                                                                 |

## 开发命令

Windows：Node 22.22.x、pnpm 12.3.4、Rust MSVC ≥1.88、Visual Studio C++、WebView2；Android：JDK 21、SDK 36。仓库根目录执行：

```powershell
.\scripts\setup\setup-windows-dev.ps1
pnpm desktop:dev
pnpm --filter @agentdeck/desktop check
pnpm --filter @agentdeck/desktop test
cargo test --locked --manifest-path desktop/core/Cargo.toml
pnpm schema:verify
.\android\gradlew.bat -p android testDebugUnitTest compileDebugAndroidTestKotlin
# 按需构建
.\android\gradlew.bat -p android assembleDebug
pnpm desktop:build
pnpm package:windows
```

APK：`android/app/build/outputs/apk/debug/app-debug.apk`；Windows 包：`artifacts/`。Android debug 签名不保证跨构建升级，勿为测试卸载用户应用。正式发布使用现有流水线；不自动改防火墙或绕过设备安装确认。

本地使用：Windows 授权项目与 LAN 地址 → Android 扫码、双端核对六位码并批准 → 选择项目/会话。首次仅监听回环，不以管理员/SYSTEM 运行。关闭窗口收至托盘，“停止并退出”才结束服务。

## 必须保留的实现边界

- 电脑 Codex 是权威源；沿用原 `thread/turn/item` 身份。发送 ACK 不等于任务完成，结果未知时先核对，不自动重发。
- 不复制/写入 Codex 私有数据库，不暴露任意 RPC，不因远程访问放宽项目授权或执行确认；凭据不进入文档、日志和测试产物。
- 现有 WSS 使用固定自签名证书，`server/transport.rs` 拒绝浏览器 Origin；浏览器 WebSocket 不能自定义 Authorization。Web 接入需明确 Origin 白名单、浏览器会话/CSRF、防护不降级、公开信任证书及独立设备授权，不能直接部署 Tauri 管理页替代。
- 默认 CLI 基线 `0.159.2`，锁定附着协议 `0.163.0-alpha.10.2`。协议入口见 Rust `server/protocol.rs`、`server/capabilities.rs` 与 Android `core/network`；设置等 Rust 兼容接口仍保留。
- 附着配置：`AGENTDECK_RUNTIME_WS_URL`、`AGENTDECK_RUNTIME_TOKEN_FILE`，可选 `AGENTDECK_RUNTIME_PROTOCOL_VERSION`；只支持带认证的回环连接，附着成功不代表原版桌面共享已完成。
- 共享接入必要诊断保留在 `scripts/codex/check-shared-codex-runtime.mjs`、`check-desktop-gui-runtime.mjs`（参数见文件头）；不默认启动真实 GUI/模型实验。

官方效果按需参考：[移动端](https://learn.chatgpt.com/docs/mobile)、[远程连接](https://learn.chatgpt.com/docs/remote-connections)。

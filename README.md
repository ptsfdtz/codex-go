# AgentDeck

自己的 Codex 对话客户端，按桌面端、移动端、服务端三端组织：

- 桌面端（`desktop/src/`、`desktop/src-tauri/`）：电脑上的 React/Tauri 管理与控制界面，负责项目授权、设备与网络、审批和托盘常驻；仅 Windows，不呈现对话。
- 移动端（`android/`）：Android Compose 客户端，收发文字与图片、同步历史、显示工具结果与任务状态、处理审批和追问。当前仅 Android，免安装网页/PWA 尚未实现。
- 服务端 `agentdeck-service`（源码在 `desktop/core/`）：当前随桌面端安装、在电脑后台运行。保存凭据与权威会话，附着并执行 Codex，提供 TLS WebSocket、六位码配对、审批、未知结果核对和重连恢复；仅 Windows。

目标连接：`移动端 / 浏览器 → 自有 VPS（仅转发 TCP）→ 服务端（电脑）→ Codex`。电脑主动建立反向隧道，TLS 在服务端终止；网页与 API 优先由服务端同源提供。VPS 不存聊天/媒体、不持有 OpenAI 凭据、不运行模型。此路线尚未落地。

## 三端现状与下一步（2026-10-22）

| 端     | 已有                                                                                                                       | 缺口 / 风险                                                                                                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 桌面端 | React/Tauri 管理界面：项目授权、设备撤销、配对网络地址、待审批、Codex 安装检查、托盘与进程监督                             | 仅 Windows；不呈现对话；终端/编辑器/扩展管理界面不在本轮目标内，其对话结果仍需呈现                                                                                                     |
| 移动端 | Compose 手机抽屉/平板横屏常驻侧栏、单行顶栏、消息气泡、圆角输入栏与建议卡；配对、会话/历史、审批、草稿、通知及部分图片展示 | 仅 Android；网页/PWA 与浏览器认证未实现；未按指定 ChatGPT 版本逐屏及真机对照，设置、配对、会话详情页尚未完成重排；多电脑缓存已隔离但一次仅连接一台；通知依赖应用连接，休眠后不保证推送 |
| 服务端 | Rust 服务；TLS WSS；配对；项目授权；会话与历史存储；审批；Codex 附着与执行                                                 | 原版 Codex 桌面同一会话完整共享（`sharedDesktopRuntime=false`）；自有中转；浏览器认证；`Store::replace_device` 会撤销旧设备，同一电脑的多客户端共存尚未实现                            |

- 移动端 UI：手机端改为抽屉会话列表、单行顶栏、ChatGPT 风格消息气泡/输入栏/建议卡，平板横屏使用常驻侧栏；仅改界面，协议与数据流未动。审批、未知结果、离线提示与发送约束保留，仍不能视为“完全一致”。
- 富内容缺口：完整图文内联、公式和代码高亮；附件合计上限 512 KiB，图片读取限授权项目内部分来源、8 MiB。现有 Diff 主要展示工作区差异，不等于历史任务 Diff。
- 已有会话同步（2026-10-23）：服务端启动、重新连接上游和新增本地项目授权后自动读取原会话索引；手机连接后主动同步，列表新增“同步电脑已有对话”，在线时服务端每 15 秒核对授权项目索引，选中会话更新时间变化后刷新历史。沿用原线程 ID，通过公开历史/恢复接口续聊，不复制私有数据库。原版桌面仍持有写入权时保留占用提示；同一运行时双端实时操作仍未完成。
- 会话同步验证：Rust 6 项定向测试（含自动发现/持续核对、授权边界、原 ID 历史与续聊、占用及缺失保护）通过；Android 主程序/设备测试源码编译及 3 项同步单测通过。未做真实桌面/手机续聊、真实模型与打包验收；下一步核验原版桌面同一运行时附着和双向可见性。
- 清理：删除旧设计/迁移/历史/盘点文档、独立 API 聊天、高级配置/账户/技能管理页面和一次性桌面盘点脚本。保留对话内模型/权限选择、技能引用、资源预览、Diff、核心协议及兼容接口。
- 下一步：按参考截图完成移动端设置、配对、会话详情页与平板细排，再在真机做明暗主题、键盘、横竖屏逐屏对照；之后推进原生会话共享 → 中转与浏览器认证/多设备 → Web 对话与移动端富内容。
- 本次验证：移动端 UI 重构后 Android `compileDebugKotlin`、`compileDebugAndroidTestKotlin`、`assembleDebug` 通过，JVM 单测通过；未安装真机/模拟器，未做逐像素视觉、真实上游或部署验收。
- 连接恢复：修复手机端将连接/请求超时误作取消、导致重连循环退出的问题；断线首次立即重试，持续失败退避至 30 秒，网络变化/回到前台主动探测并唤醒重试。手机心跳 30 秒，服务端保留 15 秒探测、允许 60 秒无入站数据；旧协议兼容，证书固定、授权、历史回放和未知发送结果约束保留，不自动重发消息。Android JVM 单测、设备测试编译及 APK 构建、Rust 心跳测试和 WSS 鉴权/回放回归通过；下一步在真机验证短断网、锁屏恢复和 Wi‑Fi 切换。

## 代码地图（按需读取）

| 端     | 路径                                                    | 内容                                                                                                                      |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 桌面端 | `desktop/src/`、`desktop/src-tauri/`                    | React 管理界面；Tauri 托盘、窗口、进程监督                                                                                |
| 移动端 | `android/app/src/main/java/dev/agentdeck/app/`          | `shell` 入口；`core` 数据/网络/存储；`features` 会话、设置、配对、技能、Diff 等                                           |
| 移动端 | `android/app/src/test/`、`android/app/src/androidTest/` | JVM 与设备测试，按同功能归类                                                                                              |
| 服务端 | `desktop/core/src/`                                     | Rust：`execution` 会话；`upstream` Codex；`server` 协议与 TLS 服务；`storage` 缓存；`projects`/`authorization`/`settings` |
| 服务端 | `desktop/core/tests/`                                   | Rust 协议、安全、会话与真实源检查                                                                                         |
| 共用   | `packages/codex-protocol/`                              | 锁定版本、导出 schema、能力锁；大文件用 `rg --no-ignore` 指定目录搜索                                                     |
| 工具   | `scripts/`                                              | `setup` 环境；`desktop` 构建；`protocol` 导出/校验；`codex` 共享接入诊断；`checks`/`android` 验收工具                     |
| 工具   | `.github/workflows/`                                    | 桌面端/服务端与移动端构建发布                                                                                             |

## 开发命令

构建环境：桌面端与服务端需要 Windows、Node 22.22.x、pnpm 12.3.4、Rust MSVC ≥1.88、Visual Studio C++、WebView2；移动端需要 JDK 21、SDK 36。仓库根目录执行：

```powershell
.\scripts\setup\setup-windows-dev.ps1   # 桌面端与服务端
pnpm desktop:dev                        # 桌面端（同时拉起服务端）
pnpm --filter @agentdeck/desktop check  # 桌面端
pnpm --filter @agentdeck/desktop test
cargo test --locked --manifest-path desktop/core/Cargo.toml   # 服务端
pnpm schema:verify
.\android\gradlew.bat -p android testDebugUnitTest compileDebugAndroidTestKotlin   # 移动端
# 按需构建
.\android\gradlew.bat -p android assembleDebug
pnpm desktop:build                      # 桌面端与服务端
pnpm package:windows
```

`pnpm desktop:dev` 使用 `.tmp/webview2` 与 `.tmp/agentdeck-data` 保存开发态 WebView2/服务数据，删除 `.tmp` 即重置开发状态。若构建工作区带有继承的 Low Integrity 标签，生成的桌面端和服务 EXE 会以低完整性运行；换普通终端仍然失败。服务在访问数据前检查完整性级别，不更改安全标签或提权。使用便携 ZIP，由资源管理器解压到工作区外的普通用户目录后运行；开发需使用正常开发目录。

启动诊断：低完整性、文件/目录、数据锁/端口、凭据和 MXC 失败有独立提示；隔离探针仅提取有界 stderr 中的已知错误。已验证同一 Codex 直接启动为 Medium 且隔离通过、经低标签 EXE 后为 Low 且 MXC 失败；新服务准确返回 `LOW_INTEGRITY_HOST`。桌面类型检查、16 项前端测试、Rust 定向测试及前后端 release 构建通过，ZIP 四项文件与构建产物哈希一致。便携包命令：`pnpm --filter @agentdeck/desktop tauri build --no-bundle` 后 `node scripts/desktop/package-desktop.mjs --portable`（先执行 `pnpm desktop:prepare`）；ZIP 在 `artifacts/AgentDeck-0.3.0-windows.zip`。下一步由用户解压到普通目录验收完整启动，工作区内不视为通过。

移动端 APK：`android/app/build/outputs/apk/debug/app-debug.apk`；桌面端/服务端安装包：`artifacts/`。移动端 debug 签名不保证跨构建升级，勿为测试卸载用户应用。正式发布使用现有流水线；不自动改防火墙或绕过设备安装确认。

本地使用：桌面端授权项目与 LAN 地址 → 移动端扫码、双端核对六位码并批准 → 选择项目/会话。服务端首次仅监听回环，不以管理员/SYSTEM 运行。关闭桌面端窗口收至托盘，“停止并退出”才结束服务端。

桌面端右上角“更多 → 开机自启动”可开启/关闭当前用户的 Windows 登录启动项，无需管理员权限；便携版移动位置后需重新开启。已通过桌面类型检查、18 项前端测试和 Rust `cargo check --locked`；未实际重启登录验收，下一步在安装版/便携版验证登录启动与关闭后的行为。

## 必须保留的实现边界

- 服务端附着的 Codex 是权威源；沿用原 `thread/turn/item` 身份。发送 ACK 不等于任务完成，结果未知时先核对，不自动重发。
- 不复制/写入 Codex 私有数据库，不暴露任意 RPC，不因远程访问放宽项目授权或执行确认；凭据不进入文档、日志和测试产物。
- 现有 WSS 使用固定自签名证书，`server/transport.rs` 拒绝浏览器 Origin；浏览器 WebSocket 不能自定义 Authorization。Web 接入需明确 Origin 白名单、浏览器会话/CSRF、防护不降级、公开信任证书及独立设备授权，不能直接部署桌面端管理界面替代。
- 默认 CLI 基线 `0.159.2`，锁定附着协议 `0.163.0-alpha.10.2`。协议入口见 Rust `server/protocol.rs`、`server/capabilities.rs` 与移动端 `core/network`；设置等 Rust 兼容接口仍保留。
- 附着配置：`AGENTDECK_RUNTIME_WS_URL`、`AGENTDECK_RUNTIME_TOKEN_FILE`，可选 `AGENTDECK_RUNTIME_PROTOCOL_VERSION`；只支持带认证的回环连接，附着成功不代表原版桌面共享已完成。
- 共享接入必要诊断保留在 `scripts/codex/check-shared-codex-runtime.mjs`、`check-desktop-gui-runtime.mjs`（参数见文件头）；不默认启动真实 GUI/模型实验。

官方效果按需参考：[移动端](https://learn.chatgpt.com/docs/mobile)、[远程连接](https://learn.chatgpt.com/docs/remote-connections)。

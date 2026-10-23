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

- Android reconnect UI (2026-10-23): ordinary disconnects and timeouts now show only subtle gray reconnecting text; certificate, authorization and protocol errors retain error prompts. compileDebugKotlin passed; device reconnect recovery and light/dark appearance remain unverified.

- Codex 错误显示（2026-10-23）：移动端解析 Codex `ErrorNotification` 的 `message`、`additionalDetails`、`codexErrorInfo` 与 `willRetry`；重试通知按上游原文显示 `Reconnecting N/5`，最终错误与 `turn.failed` 合并并保留原始诊断，不再统一隐藏为“操作未完成”；过载、限流、额度、响应流中断、鉴权与隔离错误有对应中文提示。Conversation/UserErrors 定向单测通过；真机复现该重连场景与明暗主题展示未验证。

- Android usage UI (2026-10-23): composer usage is now a compact context ring, percentage and cumulative tokens in K/M; tap for one compact table showing latest and cumulative counters together, context progress and input/output proportion bars; no tabs or expandable sections. Input/output series and their counters use distinct blue/orange colors independent of the neutral app palette. Missing values remain unreported. assembleDebug, data-preserving device install and Activity restart passed; visual appearance on device, narrow screens and light theme remain unverified.

- Android UI (2026-10-23): composer uses one rounded surface with text above a shared 44dp action row; model/effort popover is now compact: two inline label/value rows with thin discrete sliders and small solid thumbs; removed the extra header, border, dividers, endpoint labels, effort buttons and footer. Removed the mistake disclaimer; native token/context usage sits above the composer, aligned right (unknown values remain unreported). Updated picker passed `compileDebugKotlin`, `assembleDebug`, data-preserving installation and Activity startup checks on the connected Android tablet; earlier dark-theme device screenshots confirmed the composer row and usage placement. Dark-theme tablet screenshot confirmed the compact popup with aligned values and thin sliders; selection interaction, multiline input, narrow screens and light theme remain unverified.

- 侧边栏（2026-10-23）：新对话使用无背景普通样式，搜索收为同行图标、按需展开，压缩顶部与分组留白，当前会话加粗；底部移除连接状态。电脑列表逐台编辑别名并沿用加密持久化，未命名显示简短电脑标识，常规列表与设置不再直接显示 IP。HostBook 定向测试、assembleDebug、保留数据安装与启动存活检查通过；明暗主题、窄屏和别名编辑实机交互待验证。

- 移动端 UI：手机端改为抽屉会话列表、单行顶栏、ChatGPT 风格消息气泡/输入栏/建议卡，平板横屏使用常驻侧栏；仅改界面，协议与数据流未动。审批、未知结果、离线提示与发送约束保留，仍不能视为“完全一致”。
- 运行区（2026-10-23）：发送后运行过程默认展开，任务完成且收到最终答案后自动收为“已工作… ›”，最终答案保持可见；运行中与完成后均可手动展开/收起；计划正文独立输出、不进入工作折叠，Plan/Goal 标记在加号右侧。输入框上方新增原生 Goal 状态、累计执行时间与完成结果摘要，可打开目标详情；仅选择草稿模式不创建目标。计时优先任务起止，历史回退使用公开条目时间，分页未齐标注范围。自动折叠状态定向单测及 assembleDebug 通过；此前实机确认 Plan 标记和计划正文；本次真实任务自动折叠时序尚待实机验证；Goal 真实任务状态/结果更新、明色/窄屏尚待验证。
- 输入栏补充：Goal 图标统一为 TrackChanges 靶心；会话目标详情精简为状态、正文、用量/时长和预算，管理操作收进更多菜单，原有权限与确认约束保留；构建安装及实机深色竖屏展示通过，明色/窄屏与管理操作交互未验证。Goal 与输入框共用一个圆角容器，移除状态栏左右 12dp 外边距、独立边框及交界圆角，消除缝隙和两侧留白；token/上下文位于其上方。assembleDebug、保留数据覆盖安装和重启通过；实机深色竖屏截图确认状态栏与输入框同宽、交界无缝，明色及键盘展开仍待验证。当前轮文件改动徽标独立居中放在输入框上方，点击查看原生修改步骤；文件去重，增删行数按成功步骤累计（非净差异），未加载完整时提示。统计和 Plan 折叠回归测试通过；最新布局 assembleDebug 构建、保留数据覆盖安装通过，实机确认改动徽标居中浮在输入框上方、详情可打开，Goal 状态栏与输入框无间隙，上下文显示在其上方。
- 停止按钮（2026-10-23）：两处输入栏统一使用居中的 14dp 实心圆角方块，沿用按钮前景色和中断语义；APK 构建、保留数据安装及启动检查通过，运行中视觉待实机确认。
- 右上角菜单（2026-10-23）：统一为图标+文字的菜单项，移除重复的搜索入口；保留草稿、工作区审查、会话查找/历史/队列/管理、文字遮盖和设置。定向测试、assembleDebug、保留数据安装及启动检查通过。
- 文件改动（2026-10-23）：每轮结束后在结果下方保留紧凑摘要卡，含文件数、累计增删行、前三个文件及展开列表；点击文件或查看改动打开弹窗，按文件切换并显示行号和彩色 Diff。运行中输入框上方保留徽标，完成后由轮次卡片承接；详情使用原轮次记录，不读取当前文件冒充历史。重复文件聚合及增删统计定向测试、APK 构建通过；真实任务自动收尾、弹窗布局及明暗主题实机交互待验证。
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

发布构建修复（2026-10-23）：补齐 CommonJS 测试夹具的 ESLint 环境、排除开发临时文件并统一格式；Compose 按订阅状态更新消息操作，Rust 测试使用规范授权路径以兼容 Windows runner 短路径临时目录。桌面检查、22 项前端测试、4 项浏览器回归、Rust 测试与 Clippy、Android 单测/lint/APK 构建通过；线上构建与发布结果见 release 提交对应的 Actions，未做真机或真实模型验收。后续默认在 `release` 开发，提交与推送按用户授权执行。

## 开发命令

构建环境：桌面端与服务端需要 Windows、Node 22.22.x、pnpm 12.3.4、Rust MSVC ≥1.88、Visual Studio C++、WebView2；移动端需要 JDK 21、SDK 36。仓库根目录执行：

```powershell
.\scripts\setup\setup-windows-dev.ps1   # 桌面端与服务端
pnpm desktop:dev                        # 桌面开发：React/CSS 热更新，Tauri Rust 修改自动编译重启
pnpm android:dev                        # 安卓开发预览：保存后增量构建、覆盖安装并重启
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

隔离探针修复（2026-10-23）：MSIX 会重定向 AppData，探针使用逻辑路径时出现目录内可读但不可写；启动 MXC 前现将探针内外目录和服务 EXE 解析为真实路径，隔离规则及目录权限保持不变。同一 Codex/规则下真实路径四项读写边界检查通过，诊断分类单测及服务 release 构建通过；已更新本机安装的服务并确认桌面显示“Codex 已就绪”。未运行真实模型任务或手机续聊；本次已重新构建并覆盖安装 NSIS 安装包，包含此修复；旧便携 ZIP 尚未更新。

会话同步修复（2026-10-23）：真实上游列表会重复返回同一 ID 的不同元数据，现通过公开 `thread/read` 核实后只索引一次，保留授权目录、归档冲突、分页限制与原子提交检查；桌面请求保留错误码并分类显示同步失败。Rust 会话索引 3 项定向测试（含重复记录核实）、前端 22 项测试、类型检查及完整 NSIS 构建通过；已覆盖安装，真实同步返回 17 个工作区、51 个会话索引成功，桌面再次点击同步时间更新且无错误，显示“Codex 已就绪”。未验证手机续聊或运行真实模型任务。

工作区移除（2026-10-23）：再次“同步工作区”跳过本地已移除目录，全部被跳过时正常完成；可通过“添加目录”手动恢复授权。复用持久化停用状态，无协议或迁移变更。Rust 定向回归覆盖同步、移除、重复同步及手动恢复，格式检查通过；服务 release 编译并暂存、开发版启动完成。首次启动曾出现窗口未响应，结束该开发进程并重启后连续两次响应检查通过，新增托盘初始化阶段诊断；卡死根因尚未确认。未打包或验收已安装桌面端，下一步实测移除后同步并观察启动稳定性。

移动端 APK：`android/app/build/outputs/apk/debug/app-debug.apk`；桌面端/服务端安装包：`artifacts/`。移动端 debug 签名不保证跨构建升级，勿为测试卸载用户应用。正式发布使用现有流水线；不自动改防火墙或绕过设备安装确认。

本地使用：桌面端授权项目与 LAN 地址 → 移动端扫码、双端核对六位码并批准 → 选择项目/会话。服务端首次仅监听回环，不以管理员/SYSTEM 运行。关闭桌面端窗口收至托盘，“停止并退出”才结束服务端。

桌面端右上角“更多 → 开机自启动”可开启/关闭当前用户的 Windows 登录启动项，无需管理员权限；便携版移动位置后需重新开启。已通过桌面类型检查、18 项前端测试和 Rust `cargo check --locked`；未实际重启登录验收，下一步在安装版/便携版验证登录启动与关闭后的行为。

安卓开发预览：`pnpm android:dev` 首次构建并启动，监听主代码、debug 资源与 Gradle 配置，保存后合并连续修改、串行更新；构建失败后修复再保存可重试。需已授权 ADB 设备，多设备时先设置 `$env:ANDROID_SERIAL="设备序列号"`；`--once` 仅更新一次，Ctrl+C 结束监听。沿用现有应用 ID，使用 `adb install -r` 保留数据，签名冲突不会卸载；更新会重启进程，未发送界面状态可能重置，勿在执行任务/处理审批时开启。此命令是自动重建预览，不是 Compose Live Edit；真正的 Compose 实时替换需在 Android Studio 启用 Live Edit 并从 IDE 运行 debug 应用。

开发预览验证（2026-10-23）：脚本 ESLint、debug 增量构建、已连接手机覆盖安装与 Activity 启动通过；文件变更事件触发自动重建已验证。未验收真实代码修改后的视觉效果或 Android Studio Live Edit；下一步在日常 UI 调整中核验预览与重连恢复。

桌面开发热更新（2026-10-23）：`pnpm desktop:dev` 启动开发窗口，保存 `desktop/src` 下 React/CSS 即自动更新，React 组件兼容时保留状态；Tauri Rust 修改自动重编译并重启窗口。开发 CSP 仅允许回环地址的 Vite WebSocket 和刷新脚本，正式 CSP 不变；Vite 忽略 Rust 构建目录。类型检查、Vite HMR WebSocket 连接和样式变更事件推送通过。已安装的正式版窗口不热更新；独立服务 `desktop/core` 修改需退出开发进程后重新运行此命令，重新构建并暂存服务。

桌面开发启动验证：debug 构建、格式检查通过，开发窗口进程已与已安装正式版同时启动；debug 跳过正式版单实例插件，避免开发启动被正式版接管，应用 ID 与正式版行为不变。开发服务仍使用隔离数据目录，未验收其配对/真实模型任务、窗口内视觉热替换或 Rust 自动重启；已有 Low Integrity 限制仍适用。

开发构建修复（2026-10-23）：schema 构建脚本显式监听自身变更，避免旧生成文件缺失 `desktop_schema` 阻断编译。服务 release 构建、格式检查、`desktop:prepare` 及 `desktop:dev` 通过，桌面进程输出 `setup complete`；未验收窗口交互或真实模型任务。

开发环境修复（2026-10-23）：Windows setup 改为在用户 npm 目录安装 `package.json` 锁定的 pnpm，不再生成指向 fnm 特定 Node 目录的 Corepack shim。本机已修复，pnpm 12.3.4 在 Node 22/24 下入口验证通过；项目仍使用 `.node-version` 的 22.22.3。PowerShell 脚本解析、桌面类型检查、服务构建及 Vite 启动通过；未重跑完整环境安装。已有终端可执行 `fnm env --shell powershell | Out-String | Invoke-Expression`、`fnm use 22.22.3` 后启动开发。

安卓启动修复（2026-10-23）：安装包因缺失 `androidx.startup.R$string` 在初始化阶段闪退；停用监听后 clean assembleDebug --no-build-cache 完整重建并保留数据覆盖安装，连续两次冷启动、前台 Activity 与进程存活核对通过，当前进程无崩溃日志。开发监听新增启动后 2.5 秒存活检查，脚本 ESLint 通过；构建产物异常的具体触发原因未完全确认，后续编译与监听需串行运行。

## 必须保留的实现边界

- 服务端附着的 Codex 是权威源；沿用原 `thread/turn/item` 身份。发送 ACK 不等于任务完成，结果未知时先核对，不自动重发。
- 不复制/写入 Codex 私有数据库，不暴露任意 RPC，不因远程访问放宽项目授权或执行确认；凭据不进入文档、日志和测试产物。
- 现有 WSS 使用固定自签名证书，`server/transport.rs` 拒绝浏览器 Origin；浏览器 WebSocket 不能自定义 Authorization。Web 接入需明确 Origin 白名单、浏览器会话/CSRF、防护不降级、公开信任证书及独立设备授权，不能直接部署桌面端管理界面替代。
- 默认 CLI 基线 `0.159.2`，锁定附着协议 `0.163.0-alpha.10.2`。协议入口见 Rust `server/protocol.rs`、`server/capabilities.rs` 与移动端 `core/network`；设置等 Rust 兼容接口仍保留。
- 附着配置：`AGENTDECK_RUNTIME_WS_URL`、`AGENTDECK_RUNTIME_TOKEN_FILE`，可选 `AGENTDECK_RUNTIME_PROTOCOL_VERSION`；只支持带认证的回环连接，附着成功不代表原版桌面共享已完成。
- 共享接入必要诊断保留在 `scripts/codex/check-shared-codex-runtime.mjs`、`check-desktop-gui-runtime.mjs`（参数见文件头）；不默认启动真实 GUI/模型实验。

官方效果按需参考：[移动端](https://learn.chatgpt.com/docs/mobile)、[远程连接](https://learn.chatgpt.com/docs/remote-connections)。

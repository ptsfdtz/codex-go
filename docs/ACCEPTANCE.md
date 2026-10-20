# AgentDeck 验收记录

## 当前 0.3.0 原生 Rust 与旧代码清理（2026-10-20）

旧 Node Bridge、WinForms/C# 辅助程序、Zod 协议包、无用生成 TS 和对应启动/测试/打包脚本已删除。保留 React/Tauri/Rust、Android 和 314 份原样 JSON schema。用户数据库、证书、项目授权、配对记录及已安装旧程序均未修改。

清理后已实际通过：Rust service 18 项集成测试、Tauri host 4 项、React 7 项、Playwright 4 项（共 33 项）；schema 校验 314/314；TypeScript、ESLint、Prettier、两 crate 的 cargo fmt/Clippy；React 生产构建；pnpm audit --prod 未发现已知漏洞（不等于完整安全审计）。新 release service 已在隔离目录通过真实 DPAPI 证书、MXC 沙箱边界和 Codex 初始化检查，exitCode 0，见 artifacts/cleanup-native-startup.txt。Android 源码未改，本轮未重跑 Android/真机测试。默认测试中的两个真实环境用例为 ignored，不能声称在默认测试中通过。此前原生真实 Codex 两次文本回合与 resume、DPAPI/MXC 初始化、旧数据隔离副本验证报告分别为 artifacts/native-real-codex.json、native-runtime-startup.json、native-data-compatibility.json。

Windows release/NSIS 构建及便携打包已通过：artifacts/AgentDeck_0.3.0_x64-setup.exe、AgentDeck-0.3.0-windows/。包内 runtime 仅 Rust EXE + manifest，SHA-256 匹配；21 个旧源码打包暂存目录及 0.2.0 便携包已删除。新的 node:sqlite 备份工具实际生成隔离副本并通过旧数据兼容检查：20 个授权目录、1 个设备、原 host ID、端口和证书均可读取（见 artifacts/cleanup-data-compatibility.txt）。源码数据未修改。

原生版本的安装后窗口、平板 LAN 扫码、人工审批及异常重启仍待真机复测；下文所有 0.2.0/Node、旧脚本命令和真机记录均为历史证据，不代表当前 Rust 发布验收。

## 历史记录：Windows Tauri 0.2.0 迁移复测（2026-10-20）

本次新增 React/Tauri/Rust Windows 桌面，不重写 Android。Rust 负责本机控制，Node Bridge 仍作为明确标注的兼容服务，尚未完成全 Rust 后端迁移。

| 检查             | 当前证据                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React 交互测试   | 7 PASS；真实动作只由用户操作触发、重复点击抑制、二次审批确认、配对确认、过期拒绝、错误可读、revision 去重；`artifacts/tauri-react-tests.txt`              |
| Rust 边界测试    | 4 PASS；有界完整帧、严格动作/字段、跨会话/失效请求拒绝、Windows 资源路径规范化；`artifacts/tauri-rust-tests.txt`                                          |
| Bridge 回归      | 37 PASS（原有 36 + 本机 stdio 请求关联/非法动作测试）；`artifacts/tauri-bridge-regression.txt`                                                            |
| 浏览器交互和布局 | 4 PASS；1000×700、780×600、1200×800，工作区搜索、键盘退出、二维码过期、连接/断开；`artifacts/tauri-playwright.txt`。数据均为隔离 fixture，不是 LAN 验收。 |
| 真实调试版       | 实际窗口显示 Codex 就绪、20 个工作区、旧证书对应平板 `Xiaomi 2410CRP4CC` 在线；未重新签发设备凭据。                                                       |

历史 Android/LAN/人工审批记录继续保留，但不当作本次安装器的全新验收。全 Rust Bridge、安装后的完整真机任务/人工审批复测和正式签名仍未完成；发布版实际启动/打包结果在下方追加。

记录日期：2026-10-20。**可安装开发版；核心 Pad LAN 链路已实际通过，完整发布门槛仍有未验收项。** Fixture、PC 真实 Codex、真机 UI、真机 LAN 和人工决定分别记录，不能互相替代。

## 环境与构建

Windows 11 Pro build 26300；Node 22.22.3；pnpm 12.3.4；Git 2.54.0；JDK 21；Android SDK 36；Gradle 8.14.3；AGP 8.13.2；Kotlin 2.2.21；已登录的 Codex CLI 0.159.2。真机 Xiaomi Pad 7 `2410CRP4CC`，Android 16/API 36。Schema 共 1,048 文件，manifest SHA-256 `0ef515a4f603f09721a85560dfc42534f02eabcccf66ee62668d1f6b0c9a69f8`。

| 检查                                                                             | 实际结果                                                                                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`、`pnpm check`                                                       | PASS，严格 TypeScript、ESLint 和生成资产                                                                                   |
| Vitest                                                                           | **33 PASS**：16 integration、6 RPC、11 core；`artifacts/bridge-tests.xml`                                                  |
| `pnpm schema:verify`、`pnpm audit --prod`                                        | PASS；依赖检查不是完整安全审计                                                                                             |
| `pnpm verify:windows`、`node scripts/verify-startup.mjs`                         | PASS，真实 DPAPI、证书、窗口及编译后生产入口；首次仍只监听 loopback                                                        |
| Android assembleDebug / assembleDebugAndroidTest / testDebugUnitTest / lintDebug | PASS；14 JVM tests；lint 0 errors / 24 warnings                                                                            |
| 已安装 APK                                                                       | 主 APK 和 instrumentation APK 在 Pad 安装成功；主 APK v2 debug 签名验证、从真机拉回的 base.apk SHA 匹配交付 APK            |
| 独立真机 UI                                                                      | **8/8 PASS**，横竖屏、重建、Keystore/Room、6,000 条日志、离线禁用、主题/通知、Git 行号/筛选和临时遮盖                      |
| 新增真机 LAN                                                                     | **6 个独立场景 PASS**，见下表；生产入口重启另重跑同一 restart 测试并通过                                                   |
| 分发复核                                                                         | 每个 manifest 文件 SHA 验证、全新解压目录安装依赖和 Windows 构建/检查/测试；Android 主源码未变，其先前干净构建结果单独保留 |

## 真机 LAN 与真实操作

用户将 WLAN 调整为 Private 后，PC `10.10.17.165/24`、Pad `10.10.17.164/24`，平板到实际 Bridge listener `49323` 的 TCP 探测成功。没有修改防火墙、设备权限或关闭证书检查。测试项目全是专用临时目录，未授权业务目录；普通启动仍要求本机选择项目。

| 场景                      | 已证明的结果与证据                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PhysicalLanTest`         | 固定证书 TLS/WSS、Windows 人工确认的设备凭据、两个不同项目/线程完成真实 Codex 任务、实时事件和真实 Git Diff；客户端 36 events；独立读取 Bridge SQLite 确认一台设备、两个 completed。`physical-lan-result.json`、`physical-lan-bridge-evidence.json`、`android-physical-lan-retest.txt`                                                                      |
| `PhysicalLifecycleTest`   | 错误 pin 被拒绝、未配对 WSS 返回 401、未授权 project 被拒绝；原线程继续 completed、上游确认 interrupted、保存凭据重连并有序补发 17 events，无重复。`physical-lifecycle-result.json`                                                                                                                                                                         |
| `PhysicalGitTest`         | Windows 实际 Git 仓库的 staged rename、tracked binary、超大未跟踪文件明确截断、任务前就存在的外部改动。`physical-git-result.json`                                                                                                                                                                                                                           |
| `PhysicalConnectedUiTest` | 真实连接后的横竖屏 Git 页面及 Diff 行号；实际关闭 Wi-Fi 后显示离线缓存，再开启后自动恢复，Activity 重建可用；Wi-Fi 最终恢复开启。`physical-connected-ui-result.json`、`pad-connected-{landscape,portrait}.png`                                                                                                                                              |
| `PhysicalCodingTest`      | 平板通过真实 Bridge 启动 Codex apply_patch，创建 `agentdeck-produced.txt`；随后从真实 Git 读取并精确验证 `AGENTDECK_REAL_CODE_EDIT_OK\n`。`physical-coding-result.json`                                                                                                                                                                                     |
| `PhysicalRestartTest`     | pending 真审批时故意非正常退出 Bridge，平板观察到断线；原凭据重连，旧审批不可用，待审批 turn 恢复为 interrupted，已有其他线程实际 resume 并 completed。先通过测试 host，再对编译后的 **生产 `main.js`** 强制结束进程并重跑通过。`physical-production-restart-result.json`、`android-physical-production-restart.txt`、`production-restart-coordinator.json` |

生产重启复测使用原本已人工配对的临时数据副本，并在本机测试准备中预置同一个 listener grant；它验证生产入口如何恢复已存授权，不声称该预置本身是用户点击授权的证据。生产代码只在 Windows 管理窗的本机动作中保存监听授权；WSS 没有修改监听地址的接口。原地址不再属于本机或证书 SAN 不匹配时回到 loopback。

首次 LAN 用仪器将 QR JSON 送入 Android 配对入口，**没有据此宣称已完整观察相机扫码和两屏人工核码**。该流程仍需独立人工复核。

## 真实人工审批

- 正常平板 UI **拒绝**：SQLite 确认来自已配对 Xiaomi 的认证 `approvals.decide` 请求，状态 rejected，上游 interrupted，重复决定被拒绝。`physical-human-approval-rejected.json`。
- 正常平板 UI **允许一次**：认证决定恰好一条，状态 approved，命令退出码 **0**，实际输出精确为 **AGENTDECK_APPROVAL_OK**，上游 completed，重复决定被拒绝。`physical-human-approval-approved.json`。
- 真实 pending 请求遇到进程意外退出：恢复后不可重用，未误批准；独立 fixture 还覆盖跨会话、未知方法、超时、socket loss、file/permissions 的不同响应 schema。
- 所有真实决定由用户操作产品窗口/平板，测试不会代替用户点击允许或拒绝。仅自动发送同一个已处理决定验证拒绝重复，不批准新请求。

PC 窗口早期允许测试只证明审批传输；其子命令因 Desktop 缓存 PowerShell 无法启动，记录已修正为 PARTIAL，不能当作命令执行成功。当前生产子进程过滤不兼容的 Desktop 缓存 PowerShell 和 MSIX alias PATH 项，正常安装的 PowerShell/Windows PowerShell 仍可发现，父环境及沙箱权限未改。修复后的 `real-shell-smoke.json` 以及上述 Pad 允许测试均验证实际 exitCode 0 和输出标记。

## A–I 对照

| 项目                     | 状态                           | 实际覆盖与剩余边界                                                                                                                                            |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A 启动、配对、未配对拒绝 | PARTIAL                        | 生产启动、真实 LAN 固定 TLS、Windows 人工确认、设备 DB、未配对拒绝通过；相机扫描并两屏核码的完整观察仍待补测                                                  |
| B 授权工作区与目录隔离   | PASS（临时授权项目范围）       | Pad 只看到本机测试授权的两个项目；无授权 project 被拒绝；实际 MXC inside/outside 读写边界、路径/junction fixture 通过；活动期间恶意替换 junction 仍需安全审查 |
| C 实际任务与权威状态     | PASS（已测路径）               | Pad 两任务 completed、继续、真实文件创建、上游 interrupted；failed/unknown 由 fixture 覆盖，命令失败与 turn completed 分开记录                                |
| D 人工审批恰好一次       | PARTIAL                        | 真实 command 的 Pad 允许、拒绝、重复、进程丢失后失效已通过；真实 fileChange/permissions 变体尚未触发，当前只有 generated-schema fixture 覆盖                  |
| E 两个项目/线程隔离      | PASS（双线程范围）             | 真实 Pad 两项目/两线程事件归属断言、独立 Bridge DB 及 PC WSS 并发                                                                                             |
| F 真实 Git 与截断        | PASS（已测仓库范围）           | Pad 真 Git 外部未跟踪、staged rename、tracked binary、oversize 截断；source gutters 横竖屏；working-tree 不归因单一 AI 任务                                   |
| G Bridge 意外重启恢复    | PASS（同 IP/证书的已存 grant） | 编译后的生产入口实际 kill/restart、Pad 离线/凭据/失效审批/终态/原线程继续；地址变化安全回退由集成测试覆盖                                                     |
| H 布局、长日志和断线     | PASS（已测范围）               | 真机横竖屏、6,000 条日志、重建、正常 LAN Git、实际 Wi-Fi off/on 与离线提示；不同 AP 漫游、长时间休眠另待补测                                                  |
| I 测试与可安装产物       | PASS（开发版范围）             | 真实执行构建、检查、单测、集成、真机测试和产物校验；debug APK + Windows 源码启动分发；GitHub CI 尚未远端运行，非签名正式 release                              |

## 保留的失败与修正

- 原 Public WLAN 下 Pad TCP 超时，ICMP 可达；listener 与本机 TCP 正常，不能唯一断定原因。`android-physical-lan.txt`、`pad-lan-tcp-probe.*` 保留；用户调整网络后真实复测通过。
- 一次整组 connectedDebugAndroidTest 被 HyperOS 启动挂起，终止后报 process crashed；后续逐项使用标准 MAIN/LAUNCHER Intent 辅助并实际断言通过。辅助不替代安装/安全权限确认。一次额外 uiautomator dump 与 instrumentation 的 UiAutomation 冲突，没有拿该输出认定产品崩溃。
- 最早旋转 fixture 在 Activity 销毁间隙访问实例，修正生命周期等待后通过；历史报告保留。
- `PhysicalApprovalTest` 人工等待期间 instrumentation 报 process crashed，未留下人工决定，不能算通过。随后改用正常应用界面，由 Bridge 认证请求审计和真实上游结果证明允许/拒绝。
- 首次 PhysicalGitTest 将 attribution 误预期为简写，实际返回明确的外部改动说明；修正测试预期后通过，`android-physical-git-first.txt` 保留。
- 生产 restart 初次测试把网络重连当作上游就绪，提前检查旧审批得到 UPSTREAM_UNAVAILABLE；修正等待真实 `snapshot.host.status=connected` 后，通过同一实际 kill/restart。`android-physical-production-restart-first.txt` 保留。
- 首次源码包格式检查将原始证据 JSON 当源码；分发 `verification/` 排除后通过。早期 Android 并发编辑时 lint 缺少 kapt stub，结束编辑后构建再 lint 通过。

## 补测与范围限制

正式启动：`pnpm install --frozen-lockfile` → `pnpm build` → `pnpm start` → Windows 项目工作区 / 添加项目 → 本机选择可信 LAN 地址并生成 QR → Pad 扫码 → 两屏核码 → Windows 人工确认。必要时按 [SECURITY](SECURITY.md) 由管理员配置仅 Private/LocalSubnet/当前 Node/Bridge 端口的防火墙规则，不关闭整机防火墙。

真机仪器测试只在明确设置 `-e physicalLan true` 时运行。先启动 `bridge/test/physical-host.ts`（设置 `AGENTDECK_TEST_ADDRESS`），人工配对，再逐项运行 PhysicalLifecycleTest、PhysicalGitTest、PhysicalConnectedUiTest、PhysicalCodingTest。Git 特殊用例先在本机用 `prepare-physical-git.ts` 准备**标记过的临时 harness**；实际 restart 需要协调在 READY_TO_CRASH 后停止/恢复目标测试进程。原始输出与设备 result JSON 必须同时核对。PhysicalApprovalTest 是可选人工 UI 仪器，不能仅凭它的进程退出码宣称审批通过；正常应用+认证审计更可靠。

未完成的发布项：完整相机扫码/两屏核码观察；真实文件/权限审批变体；不同 AP 漫游、长时间休眠/高负载、恶意流量耐久、活动 junction 替换安全审查；正式 APK 签名与远端 CI 执行。Android 只有前台连接，无系统结束进程后的后台推送保证；Room v1 无历史迁移样本。Windows 分发依赖 Node/pnpm/Codex/Git/.NET，不是独立 exe/MSI。外置 Git 元数据/worktree 暂拒绝；精确锁定 CLI 0.159.2，升级必须重新生成/核对 schema 并复测。

仍有 PARTIAL 时不宣称“完整 A–I 发布验收全部成功”。

## 对话体验改版复测（2026-10-20）

用户反馈原界面使用体验差，Android 已重做为项目/会话侧栏、连续聊天、常驻输入框、折叠执行过程和内联审批。移除总览主入口、新任务弹窗和默认协议事件卡片。范围见 [CHAT_EXPERIENCE](CHAT_EXPERIENCE.md)。

本轮实际执行：assembleDebug、assembleDebugAndroidTest、21 个 JVM 测试全部通过；Android lint 0 error / 26 warning；pnpm check 与 format:check 通过。覆盖安装成功，原配对与缓存保留。11 个逐项真机测试通过，其中 10 个界面/本地存储回归和 1 个真实正常输入框发起 Codex 对话；实际收到 AGENTDECK_CHAT_UX_OK 与 completed，并验证草稿重建、旋转和会话抽屉。基础 Markdown/代码复制入口、工具折叠、6,000 消息滚动、离线审批禁用、敏感文字遮盖和横竖屏 Git 也已断言。

最终证据：artifacts/chat-final-verification.json、chat-final-physical-ui-retest.txt、chat-real-result.json、chat-build.txt、chat-lint.txt、android-conversation-tests.xml，截图 chat-real-landscape.png / chat-real-portrait.png。前几轮的真实回复已到达但键盘/测试定位失败、Git 懒加载定位失败、遮盖消息滚出视口等原始日志保留，最终复测修复后才记 PASS。

本轮没有重新要求用户触发实时人工审批或相机配对；既有上游审批验证属于之前版本，新的内联控件本轮由 fixture 验证上下文与禁用条件。前述 PARTIAL 发布门槛仍未消除；本记录不表示桌面全功能一致或正式 release 已完成。旧 delivery-verification / clean-final-package 记录属于改版前产物，当前 APK 以 chat-final-verification.json 中哈希为准。

## Windows 管理窗口改版复测（2026-10-20）

本轮将原生管理窗重做为中文侧栏的配对、项目、审批和设备四页，改善 DPI 缩放、窗口调整、完整路径、配对有效期、完整审批上下文、确认取消默认值、重复提交保护及行内反馈。设备在线状态来自完成 hello 的真实认证 socket。详见 [DESKTOP_EXPERIENCE](DESKTOP_EXPERIENCE.md)。

实际通过：`pnpm build`、`pnpm check`、`pnpm format:check`；Vitest **33/33**（含设备 hello 前后及撤销后的在线状态断言）。`pnpm verify:windows` 通过真实 DPAPI 与证书持久化、原生窗口启动、12 组页面/尺寸布局、中文与长上下文、刷新保留所选项目、过期及不支持审批禁用和过期二维码清除。原生状态测试使用隔离 fixture，不提交真实审批或配对。

在确认没有活动任务或 pending 审批后，使用原数据目录与端口重新启动编译后的生产 Bridge；实际窗口显示原有两个授权测试项目、Codex 已连接，以及原配对 Xiaomi 在线。未重置凭据、证书或平板数据。通过 Computer Use 查看实际窗口和页面；没有代替用户点击真实审批或配对确认。本轮不重新构建或重测 Android；原 APK 保持此前哈希。

证据：`artifacts/windows-native.json`、`bridge-tests.xml`、`desktop-final-verification.json`；最新源码包校验以 `package-verification.json` 为准。本轮没有触发新窗口的真实人工批准/拒绝或相机扫码，既有发布 PARTIAL 项仍需独立补测。

## Windows 极简单页与项目同步（2026-10-20）

后续按用户反馈移除系统标题栏和侧栏：首页只保留工作区同步与扫码配对；项目、设备、审批与网络管理收在更多菜单。保留自定义拖动、调整大小、最小化和托盘关闭。同步使用生成 schema 验证的 `config/read` 和全分页 `thread/list`，不读取桌面私有文件，不接管桌面活动任务。

实际执行 `pnpm build`、`pnpm check`、`pnpm format:check` 通过；Vitest **36/36**，包括新增的分页/归档/去重、ID 保持、安全路径跳过、重复 cursor 和非法响应；远程 `workspaces.sync` 被拒绝。12 组原生页面/尺寸检查调整为 700×560、780×620、1120×740，增加无系统标题栏和无侧栏断言，保留 DPAPI/证书/审批和 QR 检查。

真实 Codex 只读 smoke 发现 18 个有效目录、跳过 62 个无效或临时目录，内存注册表重复同步 ID 不变。随后生产入口通过显式本机 `--sync-workspaces` 执行相同同步：原有两个测试授权保留，加导入 18 个目录共 20 个，实际保存时间；真实窗口显示 QR、无系统标题栏、原平板在线。官方 App 工具列出的六个本机项目中，两个目录实际存在并全部覆盖，另外四个已不存在，未静默创建。同步还包含有效的历史会话目录，不声称精确镜像桌面侧栏。

本轮没有重新触发用户扫码核码或人工审批，不重新构建 Android，不将此前真实审批记录混作本轮验收。证据：`workspace-sync-smoke.json`、`desktop-simple-verification.json`、`windows-native.json`、`bridge-tests.xml`。此前 `desktop-final-verification.json` 属于四页设计；以本节及新报告为当前结果。发布 PARTIAL 项继续保留。

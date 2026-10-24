# AgentDeck

自己的 Codex 对话客户端，按桌面端、移动端、服务端三端组织：

- 桌面端（`desktop/src/`、`desktop/src-tauri/`）：电脑上的 React/Tauri 管理与控制界面，负责项目授权、设备与网络、审批和托盘常驻；仅 Windows，不呈现对话。
- 移动端（`android/`）：Android Compose 客户端，收发文字与图片、同步历史、显示工具结果与任务状态、处理审批和追问；同时连接多台已配对电脑。
- 服务端 `agentdeck-service`（源码在 `desktop/core/`）：当前随桌面端安装、在电脑后台运行。保存凭据与权威会话，附着并执行 Codex，提供 TLS WebSocket、六位码配对、审批、未知结果核对和重连恢复；仅 Windows。

- 云端连接服务（`server/`）：Linux VPS 上独立部署，保存账户、设备归属、登录会话、配额和管理记录，提供管理网页与 WSS 转发。电脑上的服务仍是 Codex 会话、项目授权和审批的权威源。

连接：`Android → 局域网直连电脑`，或 `Android → 云端 WSS 转发 → 电脑 → Codex`。公网的内层标准 TLS 在电脑终止；VPS 只看到加密业务字节，不存聊天/媒体，不持有 OpenAI 凭据，不运行模型。本轮客户端为 Windows 和 Android；网页只用于云端管理，不提供网页/PWA 对话客户端。

- Logo（2026-10-23）：采用纯黑白三重交织标记，表达三端共享同一会话；SVG、透明 PNG 与预览位于 `assets/branding/`，已用于桌面标题栏、窗口/托盘图标、favicon 和 Android 自适应/主题图标及单色通知图标。桌面前端构建、Android 资源编译及跨端路径一致性检查通过；安装后系统图标、通知栏和主题图标实机展示待验证，下一步核对系统裁切与小尺寸显示。

- Android timeline (2026-10-23): infer native turn identity from live events and preserve history merge direction; pagination explicitly pauses following live output, and layout changes no longer re-enable it. TimelineHistory/Conversation unit tests, assembleDebug and device data-preserving install passed. On the connected real session, two older-page clicks retained the visible answer/question and viewport while output continued; automated real-session pagination assertions compiled, but helper installation was blocked by Android USB-install restrictions. Immediate post-completion pagination remains unverified.

- Android 追问交互（2026-10-23）：原生追问与消息异步问题统一为卡片内直接提交，取消检查弹窗与加入主草稿步骤；提交、核对不占全局 busy，成功就地收起，不再把成功提示显示为顶部红色错误。按原电脑/会话发送，保留重复提交保护、未知结果与原生历史核对；本地只持久化回执身份，不保存回答内容，发送前在 IO 线程确认回执落盘。20 项定向 JVM 测试、lint、APK/设备测试编译通过；小米平板经实际云端完成深色异步问题和浅色原生双题的真实模型回复验证，提交期间切换会话、保留草稿、无全局错误均通过，截图在 `artifacts/mobile-questions/`，已保留数据更新平板及 `artifacts/AgentDeck-0.3.0-android.apk`。真机断网/进程被杀后的未知结果恢复、手机窄屏仍待验收，下一步补验这些场景。

## 多用户远程连接（2026-10-23）

- 周期性重连（2026-10-23）：Android 每 30 秒探测的 `system.hello` 缺少必需的 `client/version`，服务端拒绝且无可关联请求 ID，10 秒后触发断开；已统一初连、探测和 LAN 恢复的握手报文。修复前小米平板 180 秒出现 6 次异常重连，严格协议回归复现超时；修复后定向单测、真实 TLS 云端/路由切换回归和 APK 构建通过，已保留数据安装并核对安装 APK 哈希。平板经生产云端界面发送两轮真实模型对话，计算上下文 `14175 → 14176` 正确、收到 411 个流式增量事件，主动重连后两轮原生历史完整恢复；随后前台持续观察 660 秒，0 次异常重连。恢复后的后台只读请求不再留下过期网络错误，真机截图确认无错误横幅；跨网络切换、长期后台/休眠仍未验收。
- 客户端切换（2026-10-23）：两端默认服务器为 `https://agent.ptsfdtz.top`，登录提示区分普通账户与管理员。小米平板已完成本机公网扫码与本地批准，保存为“仅云端”；重启后仍为 cloud 策略并连接云端。经生产域名持续 180 秒、51 次真实状态读取，仅建立 1 条探测隧道、0 次失败，不创建模型任务；其他电脑网络、蜂窝切换与长期休眠尚未验收。物理测试仅显式启用，材料经一次性 ADB 本地套接字传递。
- 配对入口（2026-10-23）：Android 区分仅 LAN 与当前账户云端授权，为不可用的“仅云端”提供原因和公网扫码入口；已保留数据安装，用户确认按钮恢复可用。桌面按实际二维码版本显示公网/LAN 类型，工作区同步不再重新签发 LAN 码覆盖公网码。桌面 22 项测试、类型/格式检查、Rust release 检查、Android/设备测试与 Windows NSIS/ZIP 构建通过。桌面文件已备份替换并核对哈希，正在运行的旧进程未重启，桌面这两项修复下次重启生效；重启后的桌面展示仍待验证。
- 云端转发积压（2026-10-23）：Android 原先在接收队列或发送队列短时积压时立即关闭隧道，已改为有界等待，持续阻塞 10 秒仍中止。真实套接字回归复现旧版丢失 4 MiB 突发流，修复后下载/上传各 4 MiB 完整通过，现有 3 项云端 TLS/路由回归、APK 和设备测试编译通过；已保留数据更新小米平板。实际公网持续读取已通过上方 180 秒验收，其他电脑网络及蜂窝切换尚未验收。
- 管理员创建用户名/临时密码账户；首次登录必须改密。支持重置密码、停用账户、撤销设备、电脑解绑、设备/连接/带宽配额与管理记录；账户彼此隔离，不提供跨账户分享。
- Windows 与 Android 登录同一服务器、同一账户；手机扫描桌面 v3 公网二维码，核对六位码并在电脑批准。账户归属不代替电脑的本地授权；每个移动设备独立授权，可定向撤销。同一账户可绑定多台电脑与手机，每部手机同时维护多台电脑的连接、缓存、游标、任务与审批通知。
- 独立 LAN 配对无需账户、互联网或 VPS；v1/v2 二维码仍兼容，原证书与设备身份保留。公网配对可选择自动（LAN 优先、云端备用）、仅 LAN、仅云端。mDNS 只为已配对身份提供新地址，证书固定与主机身份校验始终保留。云端恢复 LAN 时先核验身份，切换决策与请求登记互斥，避开待确认请求；任何路径切换均不自动重发变更操作。
- 云端使用认证外层 WSS、一次性短期连接票据、有界二进制转发与心跳；内层为原电脑 TLS/授权协议，不为每台电脑开放公网端口。Windows 使用 DPAPI、Android 使用 Vault 加密保存登录凭据；云端刷新凭据轮换并检测重复使用。退出账户立即隔离该账户的移动端连接与界面，独立 LAN 电脑保留。
- Android 可自愿开启前台服务保持连接，显示持续通知和停止入口；通知权限独立申请。系统休眠、强制结束或省电限制仍需真机验收，不承诺离线推送。
- 已验证：7 项真实 PostgreSQL/HTTPS/浏览器集成，覆盖账户、刷新竞争与重放、账户隔离、票据、内层 TLS、定向撤销、配额、管理网页和实际 pg_dump/pg_restore；恢复保留账户/设备/电脑身份并使旧访问及刷新凭据失效。Windows 原生服务与真实 HTTPS 云端的登录→扫码请求→电脑批准→RPC→定向撤销→解绑闭环通过。100 账户、200 电脑、200 手机、400 同时在线隧道及 12.5 MiB 本地转发通过；这不等于公网性能或持续压测结论。
- 构建检查：Rust native 64 项及其余默认回归、Clippy、桌面前端 22 项、Tauri 4 项、浏览器 4 项、314 份基线及版本化 schema 校验通过；Android 116 项 JVM 测试、设备测试代码编译、lint（0 错误）及 APK 构建通过。真实套接字/TLS 测试覆盖 LAN→云端→LAN、待确认发送阻止切换、并发发送与切换、证书错误阻止回退、仅云端策略和不重发变更。
- 本地包验收：Windows NSIS/ZIP 哈希一致；ZIP 解压至工作区外独立目录，分别启动随包服务和桌面主程序，均通过 DPAPI、Windows 隔离边界及 Codex 0.159.2 初始化，无模型任务、无已有安装/数据变更。APK 签名有效，包名 `dev.agentdeck.app`、版本 `0.3.0`（2）保持不变。交付：`artifacts/AgentDeck_0.3.0_x64-setup.exe`、`artifacts/AgentDeck-0.3.0-windows.zip`、`android/app/build/outputs/apk/debug/app-debug.apk`；验收结果在 `artifacts/package-acceptance.json`。Windows 包未做代码签名，APK 为 debug 签名；本轮未执行 NSIS 安装、APK 真机安装或桌面界面人工验收。
- 公网部署（2026-10-23）：`yecaoyun` 已部署 `https://agent.ptsfdtz.top`（管理页 `/admin`），Cloudflare 为仅 DNS；复用现有 Nginx SNI 分流，原订阅/代理服务保留，Rust 1.90 release 程序以独立 `agentdeck` 用户由 systemd 常驻，PostgreSQL 17 通过本地 peer 认证，应用仅监听 `127.0.0.1:18082`。源码基于 `08216a61c873`，程序位于 `/opt/agentdeck/current/agentdeck-cloud`，配置位于 `/etc/agentdeck/cloud.env`；已创建管理员及普通账户 `ptsfdtz`，普通账户首次登录必须改密。公开证书、外部 HTTPS 健康检查、浏览器管理页、经公网 HTTPS 的账户登录/改密要求/退出、WSS 未授权拦截、续证模拟及数据库备份恢复到隔离数据库通过；本机—小米平板公网配对与真实云端对话验收见上方；蜂窝网络、真机多设备、IP 变化与休眠/切换待验收，Docker/Caddy 路径本轮未使用。现有 SNI 分流未传递来源 IP，应用的 IP 限流按共享入口计；下一步验证其他电脑网络和蜂窝切换。
- VPS 运维：`ssh yecaoyun 'systemctl status agentdeck-cloud --no-pager'` 查看服务，`ssh yecaoyun 'journalctl -u agentdeck-cloud -n 50 --no-pager'` 查看日志；`ssh yecaoyun 'systemctl start agentdeck-backup.service'` 手动备份，`agentdeck-backup.timer` 每日 UTC 03:20 起随机延迟最多 10 分钟执行。数据库与私有配置备份仅 root 可读，存于 `/var/backups/agentdeck/`，目前保留全部归档且仍需异机备份；未对生产库执行恢复。证书由 Certbot 自动续期并重载 Nginx。

云端部署（仓库根目录；Linux Docker Compose，域名 A/AAAA 指向 VPS，开放 80/443）：

```sh
cd server/deploy
cp .env.example .env
# 编辑 .env：域名不带协议或路径；两个秘密分别用 openssl rand -hex 32 生成
chmod 600 .env
docker compose up -d --build --wait
docker compose exec cloud agentdeck-cloud create-admin admin
# 终端交互输入临时密码，然后访问 https://你的域名/admin 修改并创建普通账户
curl --fail https://你的域名/health/ready
sh backup.sh /安全备份目录/agentdeck.dump
# 仅在空数据库的停止/替换部署上恢复；会撤销备份中的登录会话，客户端重新登录
sh restore.sh /安全备份目录/agentdeck.dump
```

PostgreSQL 与 cloud 端口只在 Compose 网络中可达；Caddy 自动申请公网证书。备份还需另存 `.env`、部署版本与 Caddy 数据卷；云端数据库不包含电脑上的 Codex 数据、项目或本地配对授权。迁移电脑需另行保留本机数据与证书，不可用云端备份代替。

云端验收（隔离测试 PostgreSQL；测试创建并删除随机数据库，账户需具备 CREATEDB）：

```powershell
$env:AGENTDECK_TEST_DATABASE_URL='host=127.0.0.1 port=5432 user=测试用户 dbname=postgres'
# pg_dump/pg_restore 使用匹配 PostgreSQL 版本的 PATH，或指定 AGENTDECK_TEST_PG_BIN
cargo test --locked --manifest-path server/Cargo.toml
cargo test --locked --manifest-path server/Cargo.toml --test cloud -- --ignored --test-threads=2
cargo test --locked --manifest-path desktop/core/Cargo.toml --lib actual_cloud_and_pc_login_pair_rpc_revoke_and_unbind -- --ignored
```

浏览器验收需 `pnpm install --frozen-lockfile` 和 Playwright 浏览器；Windows 默认 Edge，Linux 默认 Chromium（`pnpm --filter @agentdeck/desktop exec playwright install --with-deps chromium`）。管理界面验收截图在 `artifacts/cloud-admin/`。

## 三端现状与下一步（2026-10-22）

| 端     | 已有                                                                                                       | 缺口 / 风险                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 桌面端 | React/Tauri 管理界面：项目授权、设备撤销、配对网络地址、待审批、Codex 安装检查、托盘与进程监督             | 仅 Windows；不呈现对话；终端/编辑器/扩展管理界面不在本轮目标内，其对话结果仍需呈现               |
| 移动端 | Compose 手机/平板界面；会话/历史、审批、草稿、图片；云端账户、独立多电脑连接与缓存、LAN/云端路径、后台保持 | 仅 Android；真实网络切换与后台行为待验收，富内容与部分设置布局仍有缺口                           |
| 服务端 | 电脑 Rust 服务负责 Codex 权威状态、TLS、配对授权与审批；Linux 云端负责多用户账户、管理网页与加密转发       | 原版 Codex 桌面同一运行时完整共享（`sharedDesktopRuntime=false`）；本机与平板公网配对/读取通过，其他网络待验收 |

- Android reconnect UI (2026-10-23): ordinary disconnects and timeouts now show only subtle gray reconnecting text; certificate, authorization and protocol errors retain error prompts. compileDebugKotlin passed; device reconnect recovery and light/dark appearance remain unverified.

- Codex 错误显示（2026-10-23）：移动端解析 Codex `ErrorNotification` 的 `message`、`additionalDetails`、`codexErrorInfo` 与 `willRetry`；重试通知按上游原文显示 `Reconnecting N/5`，最终错误与 `turn.failed` 合并并保留原始诊断，不再统一隐藏为“操作未完成”；过载、限流、额度、响应流中断、鉴权与隔离错误有对应中文提示。Conversation/UserErrors 定向单测通过；真机复现该重连场景与明暗主题展示未验证。

- 任务错误后恢复（2026-10-23）：查询原生最新轮次时核对并回写同 ID 的终止状态；导入会话仅在上游空闲且无未决本地发送时解除未知状态。手机打开、重连和活动期间定期核对，追加遇到已结束轮次时刷新并保留草稿，不自动改成新任务；停止前核对，避免对已结束轮次反复中断。Rust 通知丢失、轮次控制、未知发送保护与 Goal 停止定向测试，Android TurnControl/LatestTurn 单测、APK 和服务 release 构建通过；已保留数据更新平板和当前开发服务，实机原 429 会话不再卡在“状态未知”，停止按钮消失并恢复发送入口。未新增真实模型任务验证续聊，429 限流本身仍由上游决定；下一步观察下一次真实错误后的自动恢复。

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
- 下一步：完成远程连接三端集中构建和实际部署/真机验收；原生同一运行时共享、移动端富内容与布局另行推进，网页对话不在本轮范围。
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
| 云端   | `server/src/`、`server/admin/`、`server/deploy/`        | 账户与加密转发、管理员网页、Docker/Caddy/PostgreSQL 与备份恢复                                                            |
| 共用   | `packages/connection-protocol/`                         | 云端设备身份、控制消息与隧道票据协议（不改上游 Codex schema）                                                             |
| 共用   | `packages/codex-protocol/`                              | 锁定版本、导出 schema、能力锁；大文件用 `rg --no-ignore` 指定目录搜索                                                     |
| 工具   | `scripts/`                                              | `setup` 环境；`desktop` 构建；`protocol` 导出/校验；`codex` 共享接入诊断；`checks`/`android` 验收工具                     |
| 工具   | `.github/workflows/`                                    | 桌面端/服务端与移动端构建发布                                                                                             |

发布构建修复（2026-10-23）：补齐 CommonJS 测试夹具的 ESLint 环境、排除开发临时文件并统一格式；Compose 按订阅状态更新消息操作，Rust 测试使用规范授权路径以兼容 Windows runner 短路径临时目录。桌面检查、22 项前端测试、4 项浏览器回归、Rust 测试与 Clippy、Android 单测/lint/APK 构建通过；线上构建与发布结果见 release 提交对应的 Actions，未做真机或真实模型验收。后续默认在 `release` 开发，提交与推送按用户授权执行。

## 开发命令

移动端同步排查（2026-10-23）：本机服务日志确认新会话首次历史/目标/最新轮次读取遇到上游空 rollout，以及持续输出期间索引同步出现 `SYNC_CONFLICT`。服务端已对精确的空 rollout `thread/read` 错误增加最多 750ms 退避重试（不重发变更），索引允许完整日志中仅含条目输出/计划/用量的并发事件，保留会话修改、授权、状态变化和日志缺口保护。25 项 Rust 单测及原会话导入/分页/原子提交集成回归通过；原版桌面共享运行时仍未打通，不能据此宣称双端实时协作。当前真实任务仍运行，修复尚未替换运行中的服务；下一步在空闲时更新服务并验收新建/输出中同步及连接恢复。

本机更新检查（2026-10-23）：当前 release 源码的 Windows NSIS/ZIP 与 Android APK 构建通过，桌面 22 项测试、Android 116 项单测及工作区移除后同步的 Rust release 定向回归通过（临时目录使用工作区 `.tmp/build-temp`）。Windows 静默安装返回成功但未替换旧文件，备份旧二进制后覆盖安装目录的桌面/服务和运行时清单，哈希与最新构建一致，窗口响应正常。Android 平板原签名不匹配，经用户授权使用桌面 debug.keystore 重新签名并卸载旧版后安装最新 APK，签名校验、安装及冷启动通过，进程存活且 Activity 位于前台；旧版本地数据已清除，需重新配对。安装包为 `artifacts/AgentDeck-0.3.0-android.apk`。未做真实模型、手机续聊或公网验收。

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

启动诊断：低完整性、文件/目录、数据锁/端口、凭据和 MXC 失败有独立提示；隔离探针仅提取有界 stderr 中的已知错误。已验证同一 Codex 直接启动为 Medium 且隔离通过、经低标签 EXE 后为 Low 且 MXC 失败；新服务准确返回 `LOW_INTEGRITY_HOST`。桌面类型检查、16 项前端测试、Rust 定向测试及前后端 release 构建通过，ZIP 四项文件与构建产物哈希一致。便携包命令：`pnpm --filter @agentdeck/desktop tauri build --no-bundle` 后 `node scripts/desktop/package-desktop.mjs --portable`（先执行 `pnpm desktop:prepare`）；ZIP 在 `artifacts/AgentDeck-0.3.0-windows.zip`。最新包在普通目录的启动验证见上方“多用户远程连接”；工作区内运行不作为此项验收依据。

隔离探针修复（2026-10-23）：MSIX 会重定向 AppData，探针使用逻辑路径时出现目录内可读但不可写；启动 MXC 前现将探针内外目录和服务 EXE 解析为真实路径，隔离规则及目录权限保持不变。同一 Codex/规则下真实路径四项读写边界检查通过，诊断分类单测及服务 release 构建通过；已更新本机安装的服务并确认桌面显示“Codex 已就绪”。未运行真实模型任务或手机续聊；此前已重新构建并覆盖安装包含此修复的 NSIS 包，当前 NSIS 与便携 ZIP 均已重新生成。

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

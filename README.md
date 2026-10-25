# AgentDeck

用 Android 或网页操作电脑上的 Codex。电脑端是 **AgentDeck Host：CLI＋后台服务**，不再提供独立桌面窗口、托盘或 Tauri/WebView2 安装器。VPS 保存账户和设备归属、提供 Web 与加密连接转发；电脑上的服务保存会话权威状态并执行 Codex。

Web 侧栏搜索左侧的气泡图标提供“普通聊天”：无需授权或选择用户项目，首次发送才创建会话，支持连续追问、断线保留草稿及刷新恢复会话；未发送内容只保存在当前页面内存。Host 在自己的状态目录下使用独立 `chat-workspace`，保留原有沙箱/审批；不提供项目技能、Goal/Plan 或完整访问。沿用现有项目/会话协议及数据库结构，以保留旧客户端的非空 projectId 兼容性；Android 旧版会将其显示为“普通聊天”分类，新入口仅在 Host 宣告 `projectlessChat` 时可用。

2026-10-25 验证：65 项 Host 原生回归、61 项 Web 单测、类型/ESLint、工作区及普通聊天浏览器回归通过，包含零用户项目、重复发送、刷新恢复、旧 Host 降级和目录被替换后拒绝访问；真实浏览器已进入普通聊天，未发送真实模型消息。更新入口的 unnecessary_to_owned 告警已修复，CLI/库严格 Clippy 检查通过。本机空闲时已切换至 `%LOCALAPPDATA%/AgentDeck/development/host-goal-20261025/` 中的开发版 Host，原安装及自启入口未替换；正式下载包/Web 未发布，原安装版本重启后需重新使用该目录下的 `agentdeck.exe restart` 启用开发版。

连接：`Android/Web → 自动 LAN 或云端 WSS → Host → Codex → 已授权项目`。内层 TLS 在 Host 终止；VPS 不保存聊天和媒体、不持有 OpenAI 凭据、不运行模型。各客户端登录同一账户即可访问电脑，正常流程不需要扫码、配对或本机批准；项目授权和任务审批继续保留。

## 安装与使用

下载入口使用现有域名，安装器识别系统和架构，校验 SHA-256，安装到当前用户目录，不需要管理员权限。发布包不依赖 Node、pnpm、Rust 或 WebView2；执行任务需要兼容的 Codex 运行时及其认证。AgentDeck 账户与 Codex/OpenAI 认证彼此独立。

```powershell
# Windows x64，PowerShell
irm https://agent.ptsfdtz.top/install.ps1 | iex
agentdeck login --username 你的用户名
agentdeck projects add "D:\Projects\MyApp"
agentdeck start
agentdeck autostart enable
```

```sh
# Linux x64 / ARM64：只会下载安装已发布的对应架构包
curl -fsSL https://agent.ptsfdtz.top/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
agentdeck login --username NAME
agentdeck projects add /绝对路径/项目
# 执行任务前还需配置下面的 Linux 本机运行时
agentdeck start
agentdeck autostart enable
```

Windows 安装位置为 `%LOCALAPPDATA%/Programs/AgentDeck`，Linux 为 `~/.local/share/agentdeck`，命令入口为 `~/.local/bin`。Windows 安装后如当前终端找不到命令，请新开终端。ZIP/tar.gz 内另有 `start.ps1` / `start.sh`，可直接启动已配置的 Host。macOS 暂不支持；ARM64 是否可下载以服务器已发布的包为准，不以 CI 配置代替运行验收。

密码在终端隐藏输入，不支持明文 `--password` 参数。临时密码会在登录过程中引导修改并重新登录。登录、项目管理等命令会按需启动本机管理服务；Codex 缺失或配置错误时仍能登录、查看状态和诊断。

Windows 如缺少兼容的原生 Codex，可单独安装锁定版本（保留官方辅助程序布局）：

```powershell
irm https://agent.ptsfdtz.top/install-codex.ps1 | iex
& "$env:LOCALAPPDATA\AgentDeck\tools\codex-cli\0.159.2\bin\codex.exe" login
agentdeck restart
```

也可用 `agentdeck configure --codex-exe 原生程序绝对路径` 指定已有版本；更改运行时配置前先停止 Host。默认 managed 协议为 `0.159.2`，另支持锁定的附着协议 `0.163.0-alpha.10.2`；不会自动升级到未知 Codex 版本。

## 后台运行与持久化

`agentdeck start` 在后台启动监督进程和 Rust 服务，关闭终端后继续运行；重复启动复用现有实例。服务异常退出时退避重启，连续失败达到限制后停止并留下诊断。网络暂时不可用时服务继续运行并重连。恢复未知发送结果时先核对，不自动重发。

Windows 自启使用当前用户的 `HKCU/Software/Microsoft/Windows/CurrentVersion/Run`，启动无窗口 Host；沿用旧版 `AgentDeck` 启动项名称，启用时替换其程序路径。Linux 使用 systemd 用户服务。二者默认都是用户登录后启动，不以管理员或 SYSTEM 运行；Linux 未登录开机运行需要管理员另行配置用户 lingering，不由安装器自动开启。

状态目录：Windows `%LOCALAPPDATA%/AgentDeck`；Linux `${XDG_STATE_HOME:-~/.local/state}/agentdeck`；可显式设置 `AGENTDECK_DATA_DIR`。CLI 与服务使用同一规则，并解析已有数据库的真实路径以兼容 Windows MSIX 重定向。目录锁阻止同一份状态被多个服务占用。

保留电脑身份和证书、登录刷新凭据、项目授权、设备撤销、会话索引、审批和恢复信息；`host.json` 保存运行时地址、令牌文件路径等配置，不保存账户密码。Windows 凭据继续使用 CurrentUser DPAPI；Linux 使用私有目录和文件权限，不能把它视作 DPAPI 加密。`host.log` / `host.log.1` 只记录有界脱敏诊断，不落盘完整状态或聊天事件。

| 操作                | 命令                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| 启动 / 停止 / 重启  | `agentdeck start / stop / restart`                                    |
| 查看状态与脚本输出  | `agentdeck status`、`agentdeck status --json`                         |
| 查看日志 / 持续跟踪 | `agentdeck logs`、`agentdeck logs --follow`                           |
| 检查环境            | `agentdeck doctor`                                                    |
| 配置自启            | `agentdeck autostart enable / disable / status`                       |
| 项目授权与同步      | `agentdeck projects list / add PATH / remove ID / sync`               |
| 设备管理            | `agentdeck devices list / revoke ID`                                  |
| 本机审批            | `agentdeck approvals list / approve ID / reject ID / cancel ID`       |
| 账户管理            | `agentdeck password`、`agentdeck logout`、`agentdeck logout --unbind` |
| 前台调试服务        | `agentdeck serve`                                                     |

`stop` 会真正停止服务，包括运行中的任务；使用前确认任务状态。它保留下次登录自启设置，禁用自启需单独执行 `autostart disable`。日常审批与追问继续在 Android/Web 操作；CLI 不自动批准权限，也不提供任意 RPC。

升级可重复运行安装命令，指定旧版本可回退程序：Windows 下载脚本后用 `-Version 版本号` 执行；Linux 在管道右侧使用 `AGENTDECK_VERSION=版本号 sh`。安装器使用独立版本目录并保留旧程序，不覆盖正在运行的二进制，不更改账户和项目状态；已运行的 Host 在显式 `agentdeck restart` 后切到新版本。回退程序不等同于回退数据库，跨不兼容数据迁移不能直接降级。

新增更新入口（尚未发布）沿用 **yecaoyun / `https://agent.ptsfdtz.top`**，未迁移到 aly。Host 使用 `agentdeck update --check` 检查、`agentdeck update` 下载校验并安装；只执行程序内置的安装脚本，保留旧版本和正在运行的服务，空闲后显式 `agentdeck restart`。旧 Host 首次仍需重跑安装命令才能获得更新命令；更新源可用 `--origin HTTPS_ORIGIN` 或 `AGENTDECK_DOWNLOAD_ORIGIN` 指定，安装器保存来源和发布版本。Android 在“设置→通用→应用更新”检查、下载并交由系统确认安装，校验 SHA-256、包名、递增版本和相同签名；网页/PWA 在“设置→常规”检查当前站点的新构建，提示手动重新加载，不自动丢弃草稿。

更新功能验证（2026-10-25）：Windows/Linux x64 发布编译及真实 HTTPS 检查/下载安装通过；Windows 隔离验收确认运行进程、身份、证书和项目保留，Linux 确认命令链接、旧程序和来源/版本记录保留。更新输入定向 Rust 回归、CLI/库严格 Clippy、63 项 Web 单测及构建/类型/ESLint、129 项 Android 单测及 APK/Lint/仪器测试编译通过；yecaoyun 独立目录验证真实 APK 发布、重复发布、篡改拒绝、旧版本保留和 Host 指针独立，Nginx 下载规则检查通过。未切换正式下载或部署 Web，未验收真机覆盖安装及 ARM64；下一步配置固定 Android 签名并按阶段发布，未推送。

Web 设备更新提醒（尚未发布）：连接支持版本检查的 Host 后检查官方稳定版本，页面可见时每 30 分钟复查；旧 Host 显示“版本待确认”，开发版不误报过期。点击提醒可选择工作区、预览提示词，确认后新建独立更新会话交给这台电脑的本地 AI，保留原会话草稿、工作区权限及正常审批；提示词要求保留身份、自启及数据，只安装不重启，空闲后手动重启生效。2026-10-25：3 项组件单测、浏览器提醒/确认后单次发送/独立会话/草稿保留/手机布局回归及 Web 生产构建通过；未发送真实 AI 更新任务，未部署。

旧桌面实例仍运行时，先在任务空闲后从旧托盘“停止并退出”，再启动 Host。不会强杀原实例或生成另一套身份。开发脚本保留读取 `.tmp/desktop-dev-data-dir.txt` 的兼容入口；已有 MSIX 私有数据需要沿用该实际目录，不能仅凭云端账户恢复电脑证书。

## Linux 运行时

当前 Linux 执行仍使用**带认证的本机回环 app-server**，安装 Host 不会自动完成运行时和隔离配置。准备私有令牌文件和匹配版本的原生 Codex，再保存附着配置：

```sh
agentdeck stop
agentdeck configure --runtime-ws ws://127.0.0.1:4500 \
  --runtime-token-file /绝对路径/runtime-token --protocol 0.163.0-alpha.10.2
# 只有实际核验隔离后，才增加 --sandbox-verified
agentdeck start
agentdeck status
```

运行时令牌文件必须绝对路径、权限 0600；配置在重启及 systemd 启动时复用。也兼容 `AGENTDECK_RUNTIME_WS_URL`、`AGENTDECK_RUNTIME_TOKEN_FILE`、`AGENTDECK_RUNTIME_PROTOCOL_VERSION` 和 `AGENTDECK_LINUX_SANDBOX_VERIFIED` 环境变量，环境变量优先。没有显式隔离核验时不放开执行。

必须保留原生 `codex`、`codex-code-mode-host`、`codex-linux-sandbox` 辅助入口，并放到隔离配置允许的路径。已知 alpha 命令工具仍可能因私有 `CODEX_HOME/tmp/arg0-linux/` 入口返回 `ENOENT`；没有通过放宽隔离绕过。systemd 保留 `ProtectSystem=strict`、`ProtectHome=read-only`、`PrivateTmp` 等限制；附件需要写入已授权项目时，在 drop-in 的 `ReadWritePaths=` 显式列出路径。

## 下载发布与 VPS

正式 Web：[agent.ptsfdtz.top](https://agent.ptsfdtz.top/)，管理端 [/admin](https://agent.ptsfdtz.top/admin)。生产使用现有 Nginx、Rust/systemd 和 PostgreSQL 17，Cloudflare 仅做 DNS。云端账户 schema v3 支持电脑证书/地址登记、会话绑定的短期凭据、撤销和刷新轮换；VPS 继续只转发加密业务字节。

Web 已补齐 PWA 清单、安装图标及独立窗口配置，登录页与设置提供安装入口；Android 使用浏览器菜单安装，iPhone/iPad 使用 Safari 分享→添加到主屏幕，从图标打开后隐藏浏览器地址栏与工具栏，系统状态栏/手势区由系统管理。支持安全区、可视高度和输入框适配；Service Worker 仅转发首页网络请求并提供离线提示，不缓存账户、聊天、媒体或 API。当前代码尚未部署：Web 构建、57 项单测、PWA 生产包子目录/安装/离线恢复和手机尺寸布局回归通过，未验收 Android/iOS 真机安装；已有会话回归在切换会话的读取提示断言超时，待与会话改动一起核对。

Web 动效统一使用 CSS 过渡与浏览器原生动画：按钮 120–160ms、菜单/弹窗 180–200ms、侧栏 280ms，覆盖进出、折叠、状态提示和新消息淡入；流式片段不重播、不移动历史阅读锚点，快捷键即时响应，减少动态效果时保留短淡入。构建、60 项单测、手机布局、动效、工作区操作与流式重连回归通过；真机触控体验未验收，尚未部署。

下拉框跟随主题，支持浏览器使用圆角面板、选中勾选和短过渡，旧浏览器保留原生选择器。侧栏取消常驻搜索框，放大镜或 Ctrl+K 打开独立搜索弹窗；类型/ESLint、手机尺寸和工作区（含搜索及快捷键焦点）回归通过，本地浏览器已核验深色项目菜单；未验收旧浏览器及真机，尚未部署。

侧栏项目区移除重复下拉选择器，直接点击项目列表切换。类型/ESLint、生产构建及手机布局/项目切换回归通过；会话回归在既有工具命令预览断言处失败，未跑到项目切换，尚未部署。

侧栏和会话区域共用响应式宽度，修复宽窗口侧栏 300px 而内容仅让出 280px 导致标题菜单被遮挡的问题。900/1200/1600px 菜单可见性与点击命中、原有手机侧栏及动效回归通过；尚未部署。

改动预览使用相对项目路径标签，支持横向滚动和方向键切换，固定内容高度；移除顶部标题、重复路径及累计说明，消息文件列表同步缩短路径。本地真实会话预览/切换已检查，61 项单测、类型/ESLint、手机布局与弹窗动效回归通过；尚未部署，真机未验收。

差异代码行共享完整内容宽度，修复横向滚动后短行高亮背景在右侧提前结束的问题。`browser-diff.mjs` 已验证桌面/手机尺寸下长短行背景、内容末尾可达及切换文件重置滚动；类型/ESLint 通过，尚未部署。

Web 问答逐题填写：选择选项自动进入下一题，文字回答按回车或点击“下一个”前进；最后一题需点击右下角“提交回答”，同处提供“上一个”并保留已填答案。异步追问和原生问答审批共用交互，发送确认、未知结果核对及敏感回答仅存内存的规则保留。桌面/手机尺寸三轮浏览器回归通过，未提交真实会话回答，尚未部署。

Web 用量弹窗使用紧凑的上下文进度条和中文表格，对照最近一次与会话累计的 Token 用量；缺失数据显示“—”，不再展示原始 JSON。类型/ESLint 通过，本地真实会话已核验数字和深色布局；尚未部署，手机真机未验收。

Web 管理会话弹窗精简重复标题与状态，改名支持回车保存、Esc 恢复及未修改时禁用保存；常用操作统一排列，删除独立分区，确认按钮明确操作且失败保留确认区。类型/ESLint、格式及工作区浏览器回归通过，包含改名键盘操作、置顶和整理上下文；未对真实会话执行管理操作，尚未部署。

Web 模型与思维强度合并为紧凑的桌面风格弹出控件：分档滑条、当前模型入口、带选中标记的模型列表及默认强度重置；档位沿用 Host 返回的模型能力，切换模型清除旧强度。面板展开/收起、视图切换和档位使用短过渡，键盘与减少动态效果时简化动效；移除鼠标焦点白框和可见滚动条，修复滑条溢出。本地 Codex 内置浏览器已核验模型列表及强度面板；类型/ESLint、工作区浏览器回归通过，包含手机边界、重置、Esc 关闭和最终模型/强度发送参数；未调用真实模型，尚未部署。

Web 计划使用独立卡片并保留 Markdown 列表；最新计划完成后提供“按照计划开发 / 继续调整计划”，前者经点击才以普通模式发送完整计划，后者保留草稿进入 Plan 模式。工作步骤清单不触发开发确认。67 项 Web 单测、类型/ESLint 和计划浏览器回归通过，包含手机布局、草稿保留及未知发送结果阻止重复执行；未向真实会话发送开发指令，尚未部署。

电脑列表的“在线”仅表示 Host 到云端在线，电脑弹窗另列浏览器连接/同步/重试状态和失败原因；列表刷新失败标明旧状态，恢复后清除提示。2026-10-25 本地真实浏览器观察到云端请求超时后恢复，Host 与 Codex 就绪，重连后项目和会话可读；61 项单测、类型检查及流式断线重连/草稿/阅读位置回归通过。未发送模型任务，改动未部署，超时对应的具体云端请求/网络根因尚未定位。

`pnpm host:package` 在当前平台构建发布包，输出到 `artifacts/host-downloads/`：

```text
install.sh / install.ps1 / install-codex.ps1
releases/stable.txt
releases/版本号/agentdeck-windows-x64.zip[.sha256]
releases/版本号/agentdeck-linux-x64.tar.gz[.sha256]
releases/版本号/agentdeck-linux-arm64.tar.gz[.sha256]
```

使用 `AGENTDECK_RELEASE_VERSION` 指定不可变发布目录。CI 构建 Windows x64、Linux x64 和 ARM64，合并后的 `agentdeck-downloads.tar.gz` 可直接上传 VPS；ARM64 基于 Ubuntu 24.04，x64 CI 基于 Ubuntu 22.04。旧独立 Linux workflow 和桌面安装器发布路径已移除。

Android 更新发布：使用固定签名和递增的 `-PagentdeckVersionCode=N`（可另设 `-PagentdeckVersionName=版本`）构建 APK，再运行 `AGENTDECK_RELEASE_VERSION=发布目录 node scripts/updates/package-android.mjs APK输出目录`；脚本读取实际 Gradle 元数据，输出版本化 APK、校验值和 `android/stable.json`。发布脚本验证完整性、拒绝不同内容复用 Android 版本号，最后原子更新清单。CI 可通过 `AGENTDECK_ANDROID_DEBUG_KEYSTORE_B64` secret 固定已有 debug 签名，版本号使用 `1000 + GITHUB_RUN_NUMBER`；未配置时只提供测试 APK，不发布临时签名的更新清单。正式签名构建使用 `AGENTDECK_ANDROID_KEYSTORE`、`AGENTDECK_ANDROID_STORE_PASSWORD`、`AGENTDECK_ANDROID_KEY_ALIAS`、`AGENTDECK_ANDROID_KEY_PASSWORD` 环境变量；已有 debug 安装不能直接切换到另一签名，不通过卸载清除数据绕过。Web 构建自动生成 `version.json`，与资源一同部署并保持该清单不缓存。

在服务器执行 `sh scripts/host/publish-downloads.sh 上传目录 /opt/agentdeck/downloads`，先核对包校验值、发布不可变版本文件，最后原子更新 `stable.txt`；旧版本保留。将 `server/deploy/downloads.nginx.conf` 的规则 include 到现有 HTTPS server block，执行 `nginx -t` 后 reload。下载规则不替换现有 `/api/`、`/admin`、Web 或隧道转发；单个平台尚未发布时返回 404，不退回 HTML 页面冒充程序。

生产云端程序仍由 `/opt/agentdeck/current/agentdeck-cloud` 提供，服务配置 `/etc/agentdeck/cloud.env`。运维：`ssh yecaoyun 'systemctl status agentdeck-cloud --no-pager'`；日志 `journalctl -u agentdeck-cloud -n 50 --no-pager`。`agentdeck-backup.timer` 每日 UTC 03:20 起随机延迟最多十分钟执行；可手动启动 `agentdeck-backup.service`。备份位于 `/var/backups/agentdeck/`，需要另做异机备份；云端备份不包含各 Host 的 Codex、项目和本机证书。Docker/Caddy 备用部署见 `server/deploy/`，当前生产未使用该路径。

## 开发与验证

2026-10-25 汇总复核：70 项 Web 单测、69 项 Host 原生回归、32 项 Rust 库测试（另 2 项显式环境验收跳过）、129 项 Android 单测，以及类型/ESLint、Web 生产构建、CLI/库严格 Clippy、Android 仪器测试编译通过。来源同步、普通聊天、目标、工作区、消息原地编辑和 Host 更新提示浏览器回归通过；编辑取消的焦点断言改为等待下一帧恢复。改动已按功能提交到本地 `release`，未推送或部署。

Web 消息编辑改为原消息位置的文本框，支持取消、保存并发送、回车换行及 Ctrl/Cmd+Enter 提交；失败保留修改，继续使用原生消息身份回退并核对附件/技能。桌面与手机深浅主题专项、工作区浏览器回归、67 项单测、类型/ESLint、生产构建通过；流式阅读位置断言曾出现时序失败，单独复跑通过。本地真实会话已检查打开/取消，未实际回退用户消息，未发布。

Web 发送区分正常等待响应与断线后的未知结果，修复每次发送时误报“上次操作结果尚未确定”；新会话首轮确认后才读取历史，避免 Codex 0.159.2 尚未写入 rollout 时分页报错。Host 另对自己新建且经原生接口确认仍为空的会话做兼容，已有会话缺失历史仍报错。67 项 Web 单测、类型/ESLint、生产构建、普通聊天/工作区/流式重连浏览器回归及 6 项 Host 定向回归通过；本地 Web 连接真实 Host，普通聊天首次发送、连续追问和项目首次发送均收到真实回复。Host 兼容补丁已随下述目标修复重启载入，正式 Web/Host 未发布。

目标编辑/清除允许已结束且未加载的历史会话，修复将 Codex `notLoaded` 一律拒绝的问题；提交前再次核对任务与目标版本，运行中或未知结果仍受保护。Web 增加状态核对、刷新及中文反馈。69 项 Host 原生测试、67 项 Web 单测、类型/ESLint、生产构建、目标/工作区浏览器回归通过；真实 Codex 的隔离环境中，重启后 `notLoaded` 会话清除目标成功且未请求模型。本机 Host 在零活动任务/审批时切换至修复版，云端连接、Codex 和沙箱就绪；未操作用户现有目标，正式环境未发布。

Web 文字交互按用途区分：标题和列表使用轻微文字明暗变化，用量及辅助入口悬停加深，折叠入口通过文字与图标反馈；不添加整行下划线、悬停背景或边框，保留选中与键盘焦点，正文链接沿用链接样式。浅/深色 22 组控件及菜单浏览器检查、生产构建通过；未做真机悬停验收。

默认在 `release` 分支开发，不自动提交或推送。Host Rust 源码暂保留 `desktop/core/` 路径，以维持公开入口、测试和协议导出的兼容性；这不表示仍依赖桌面 UI。

| 目录                                             | 职责                                               |
| ------------------------------------------------ | -------------------------------------------------- |
| `desktop/core/src/host/`、`src/bin/agentdeck.rs` | CLI、持久配置、后台监督、自启与日志                |
| `desktop/core/src/` 其余功能目录                 | 会话执行、Codex 协议、TLS、项目授权、存储和设置    |
| `desktop/core/tests/`                            | 按功能归类的协议、授权、生命周期与显式真实运行验收 |
| `android/`                                       | Android Compose 客户端                             |
| `web/`                                           | Web 会话、浏览器 TLS、账号连接和浏览器回归         |
| `server/`                                        | 账户、管理页、数据库迁移和云端转发                 |
| `packages/`                                      | 共用连接协议、锁定 Codex 生成 schema               |
| `scripts/host/`                                  | 安装、开发启动、打包、下载发布和自启验收           |

开发 Host 需要 Rust MSVC ≥1.88、Visual Studio C++ 和 Windows SDK，或 Linux Rust/原生编译工具；Web/发布脚本需要 Node 22.22.3、pnpm 12.3.4；Android 需要 JDK 21、SDK 36。不再检查 WebView2。

```powershell
pnpm install --frozen-lockfile
pnpm host:build
pnpm host:dev          # 编译并显示状态；不启动图形窗口
pnpm start             # 编译并后台启动；Rust 修改后显式 restart
pnpm host:package
pnpm check
cargo test --locked --manifest-path desktop/core/Cargo.toml
cargo clippy --locked --manifest-path desktop/core/Cargo.toml --all-targets -- -D warnings
pnpm schema:verify
pnpm web:dev
pnpm --filter @agentdeck/web test
pnpm --filter @agentdeck/web build
node web/tests/browser-transport.mjs
node web/tests/browser-recovery.mjs
node web/tests/browser-streaming.mjs
node web/tests/browser-source-sync.mjs
node web/tests/browser-dev-proxy.mjs
node web/tests/browser-pwa.mjs
node web/tests/browser-mobile.mjs
node web/tests/browser-motion.mjs
node web/tests/browser-diff.mjs
node web/tests/browser-chat.mjs
node web/tests/browser-questions.mjs
node web/tests/browser-plan.mjs
node web/tests/browser-host-update.mjs
pnpm android:dev
.\android\gradlew.bat -p android testDebugUnitTest compileDebugAndroidTestKotlin
```

`pnpm web:dev` 打开 `http://localhost:1430`，本地页重新登录同一账户即可访问真实电脑与会话。`cloud-dev` 模式仅在回环开发服务器代理 API、Cookie/CSRF 和 WebSocket 到 `https://agent.ptsfdtz.top`；保存 Web 代码自动热更新，不部署、不修改远端白名单、不启动 Android。电脑上的现有服务须保持在线；发送、审批和撤销会作用于真实环境。本地浏览器身份与正式网页独立。可用 `VITE_CLOUD_ORIGIN` 指向另一 HTTPS 云端，正式构建不包含开发代理。

Web 流式恢复：同页断线保留消息、草稿、工具展开及阅读位置，按内存游标补齐缺失事件并去重；流式片段不重新读取历史。连接、同步进度和 Codex 重试分别显示，离开底部阅读时提示新进展。首次进入只读最近一页，向上滚到顶部再加载更早记录；整页刷新、游标过期或积压超限时重新读取最近一页。此轮仅改 Web，60 项单测、类型/ESLint、生产构建及会话/工作区/流式浏览器回归通过；本地 1430 登录页已检查，未以真实账户或模型验收长期断网，下一步验证真实长会话与休眠切网。

桌面外部变化同步：managed 模式监听 Codex 初始化接口返回目录的系统文件通知，仅把路径当作失效提示，不读取私有数据库或解析会话文件；通过官方接口重新核对会话身份、项目授权和索引，再发送可重放的 `session.contentChanged`。Web 合并短时重复通知，只补读当前可见会话最近一页，保留更早历史、草稿、工具展开和阅读位置；并发流式内容优先，页面返回前台后补读。附着模式继续使用原生通知，原有 15 秒索引核对周期不变，时间戳前进时也提示补读，以恢复遗漏通知；Android 兼容新增事件。

2026-10-25 同步验收：两个独立的锁定版原生 Codex 进程、隔离目录与本地合成模型验证了新增内容、重命名、归档在 5 秒窗口内经官方接口同步，读取端未加载会话或取得写入权；Web 来源同步及原有流式重连浏览器回归、67 项 Web 单测、生产构建、Rust 库回归/Clippy、Android Kotlin 编译通过。原版 GUI 共享运行时实验仍在启动策略协议阶段受阻，`sharedDesktopRuntime=false`；跨运行时写入权冲突导致的桌面归档/删除问题未解决。当前兼容方案同步已保存内容，不保证保存前逐 Token 推送；未部署或重启现有服务，下一步继续验证原版 GUI 共享运行时兼容及长期休眠恢复。

Host 生命周期回归使用真实 CLI/服务进程和隔离状态目录，不调用模型。 Windows 更新验收：`scripts/host/test-update.ps1 -PackageDirectory 发布包解压目录`，从正式 HTTPS 入口下载安装到独立目录，核对运行中服务、身份、证书和项目保留，不切换线上发布指针。Windows 自启验收脚本：`scripts/host/test-autostart.ps1 -Cli 程序绝对路径`，使用独立启动项，验证配置、隐藏启动、停止及清理，不修改日常启动项。真实模型、真机与生产数据库验收均为显式操作，不能用编译通过代替。

当前交付（2026-10-25）：`host-20261025-1` 已发布至正式域名，提供 Windows x64 和 Linux x64；ARM64 尚未发布。两平台均已从公网 HTTPS 入口实际安装，验证 SHA-256、真实 CLI/后台启动、项目授权、运行中重复安装、身份/证书保留及重启恢复。Windows 独立登录启动项的真实隐藏启动、停止和清理通过；未实际退出并重新登录 Windows。VPS 仅增加静态下载规则，Nginx 配置检查及 reload 通过，原 Web、`/admin`、健康检查均返回 200，云端服务保持运行。

代码验证：Windows 全套默认 Rust 回归、改造后定向生命周期及 Clippy、Linux x64 生命周期与 CLI Clippy、37 项 Web 单测、类型/ESLint、Web 生产构建、版本化 schema 校验通过；浏览器 TLS、重连/双标签/阅读锚点/安全内容及本地开发代理回归通过。PowerShell 安装/启动脚本解析与 Linux 脚本语法检查通过。未使用真实账户重新验收终端密码交互，未运行模型或更新真机；未推送。

此前生产账号直连已通过真实浏览器登录、项目读取、刷新、断网恢复、双标签撤销和退出同步；内层 TLS、账户隔离、未知结果及旧配对兼容已有定向回归。此前模型图文请求遇到 HTTP 502，本轮不据连接验收宣称模型闭环通过。Android 近期版本已有真机文字对话、追问及前台连接验证，最新账号直连 APK 未重复安装真机。下一步继续验证实际 Windows 重新登录自启、ARM64、Android 最新版、长期休眠/切网、大历史及 Linux 命令隔离。

## 必须保留的边界

- 服务端附着的 Codex 是权威源，保留原 `thread/turn/item` 身份；发送 ACK 不代表完成，结果未知先核对，不自动重发。
- 不复制或写入 Codex 私有数据库，不暴露任意 RPC，不因远程访问放宽项目授权或执行确认；凭据不进入文档、日志或测试产物。
- Web 使用 Origin 白名单、HttpOnly Cookie、CSRF 和一次性隧道票据；内层 TLS 校验电脑证书。证书错误不自动回退；浏览器阻止 LAN 时走公网。当前账号 LAN 也依赖云端复核，不承诺云端离线可用。
- 不修改应用 ID、Android 包名、Room/序列化身份或 Rust 公开入口；旧配对协议仅兼容旧记录和客户端。
- 上游 schema 是生成物，升级 Codex 时显式重导出和核验，不手改；仓库保留独立消息定义，导出与审计统一排除重复聚合包，保留逐文件哈希校验。精简后 schema 校验、70 项原生/WebSocket 回归和 4 项协议审计单测通过；未重跑真实模型。设置等 Rust 兼容接口保留。
- 附着成功不等于原版 Codex 桌面共享已完成，`sharedDesktopRuntime=false`。必要诊断保留在 `scripts/codex/check-shared-codex-runtime.mjs`、`check-desktop-gui-runtime.mjs`；不默认启动原版 GUI 或真实模型实验。
- 不自动修改防火墙、不绕过设备安装确认、不为测试卸载用户 Android 应用。APK 包名 `dev.agentdeck.app` 保持不变，源码默认版本为 `0.3.0`（2），更新发布通过上述构建参数递增；现有 APK 为 debug 签名，只有保留相同签名才能覆盖升级。

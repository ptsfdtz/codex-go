# 使用与维护

[项目介绍](../README.md) · [开发入口](../AGENTS.md)

安装步骤面向稳定版，开发版功能单独标注。[当前版本](status.md#当前生产-web2026-11-08) · [运行时验收](runtime.md)

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

Linux x64 / ARM64 和 macOS arm64 使用同一安装入口：

```sh
curl -fsSL https://agent.ptsfdtz.top/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
agentdeck login --username NAME
agentdeck projects add /绝对路径/项目
agentdeck start
agentdeck autostart enable
```

Windows 安装位置为 `%LOCALAPPDATA%/Programs/AgentDeck`。Linux 和 macOS 的安装位置为 `~/.local/share/agentdeck`，命令入口为 `~/.local/bin`。Windows 安装后如找不到命令，请新开终端。ZIP/tar.gz 内的 `start.ps1` / `start.sh` 可启动已配置的 Host。各平台首次启动自动下载并校验固定官方 Codex 包。macOS arm64 通过 launchd 自启，包未签名或公证。各发行版的实机验收范围见[功能状态](status.md)。

密码在终端隐藏输入，不支持明文 `--password` 参数。临时密码会在登录过程中引导修改并重新登录。登录、项目管理等命令会按需启动本机管理服务；Codex 缺失或配置错误时仍能登录、查看状态和诊断。

首次启动会自动准备官方运行时；需要 Codex 认证时执行下列命令（已有有效认证可跳过登录）。不需要手工安装 Codex 或填写共享地址和令牌：

```sh
agentdeck codex-login                 # 无浏览器环境可加 --device-auth
agentdeck status --json
agentdeck codex                       # 共享 CLI；也可追加 THREAD_ID 续聊
```

Windows 原版 Codex 桌面需预先安装，使用开始菜单“Codex shared”或 `agentdeck desktop` 打开共享实例；已有桌面先在任务空闲后退出再重开。普通原版图标独立启动不会自动切换到共享运行时。安装器创建快捷方式，直接解压或从源码构建的用户可用 `agentdeck desktop`。

## 网页设置（简化版源码，尚未部署）

主 Web/PWA 设置分为常规、项目和电脑。常规提供语言、外观、系统通知和退出 AgentDeck 账户。项目页用于选择、同步和管理已授权项目，电脑页用于连接、重连、重命名和解绑。会话模型与思维强度从输入区选择。

Web/PWA 支持跟随系统、简体中文和英文；可在登录页或设置的通用页切换。偏好保存在本浏览器，并同步同源标签页。切换保留未发送草稿、用户内容和文件名；PWA 描述、安装清单和离线提示同步本地化。

管理页右上角也可切换语言，与同源 Web 共用浏览器偏好；打开的账户编辑表单保留已填值。

Host CLI 使用 `agentdeck --lang zh-CN help` 或 `agentdeck status --lang en` 临时选择语言。优先级为 `--lang`、`AGENTDECK_LANG`、系统语言；可选 `system`、`zh-CN`、`en`。系统中文使用简体中文，其他语言回退英文。只翻译面向人的提示，`status --json`、协议字段、命令标识和未知上游诊断保留原样。

安装器默认跟随系统。Linux/macOS 可在执行安装脚本前设置 `AGENTDECK_LANG=zh-CN` 或 `en`；PowerShell 可设置 `$env:AGENTDECK_LANG = "zh-CN"`，下载到本地的安装脚本也支持 `-Language zh-CN`。该设置只影响安装提示，不更改下载版本与校验流程。

## Web 语音输入（源码新增，尚未发布）

主对话、侧边对话和 AgentChat 共用右下角主按钮：输入框为空时显示白底深色声波图标，点击开始普通话语音输入；有文字或附件等可发送内容时切换为发送箭头，任务运行时沿用加入队列操作，不额外显示独立麦克风按钮。点击语音按钮后允许浏览器使用麦克风，识别确认的文字加入草稿，临时预览不写入草稿。点击结束按钮等待最后的识别结果，核对或编辑草稿后手动发送；语音输入不会自动发送消息或执行斜杠命令。

“取消听写”或 Esc 会停止录入，保留已经确认的草稿文字、舍弃临时预览。手动编辑、切换会话、隐藏对话区域、切到后台或断开连接时会释放麦克风；同一页面仅一个输入框可以听写。单次录入最多两分钟，结束识别最多等待五秒。

需要 HTTPS（本机开发页面除外）、浏览器语音识别支持及麦克风权限。不需要配置 API Key，但浏览器语音服务可能需要联网并将音频交由浏览器供应商处理；AgentDeck 不上传或保存录音。不支持或服务不可用时，使用系统键盘的麦克风听写。Safari、手机/PWA 和真实麦克风识别尚未实测，不承诺所有浏览器可用。

## 操作结果核对（源码修复，尚未部署）

发送、排队或其他修改操作的响应丢失时，网页保留草稿并阻止继续修改，以免重复执行。点击“核对操作结果”会显示查询进度和每条回执的结果：已完成会解除保护；明确拒绝会显示原因；仍在处理需稍后再查；查询失败保留保护并显示错误。连接恢复并同步完成后才能核对，历史读取失败可单独重试。

如果电脑记录为结果不确定或找不到旧回执，请先检查相关会话、待发送队列和电脑上的实际结果，再勾选“我已核对实际结果，确认可以继续操作”，点击“确认核对并恢复编辑”。确认前网页会再次查询回执并检查电脑状态；仍在处理、查询失败或回执已变化时不能解除保护。该操作只释放浏览器的发送限制，不删除 Host 的防重记录，也不自动重发草稿。侧边对话自身的“上一条发送结果曾不确定”还需在查看实际会话后点击“已核对，继续编辑草稿”。

## 工作区工具栏与项目终端

连接电脑后，从对话顶部“工具”打开文件、改动、项目终端或侧边对话。手机可在工具与主对话间返回。文件和改动支持多标签、文件查找、Git 工作区及分支比较。

项目终端在当前标签所绑定的已授权项目目录启动电脑本机 shell，以该系统用户权限运行。工具栏提供 Tab、Esc、Ctrl+C、Ctrl+D 和方向键。要在该 shell 使用 SSH，可按电脑自身的 OpenSSH 配置运行命令。收起工具栏会保留终端；关闭终端标签、断开网页连接或撤销设备会结束该终端。旧 Host 会提示升级。

快捷键包括打开改动的 `Ctrl+Shift+G`、打开文件的 `Ctrl+P` 和打开侧边对话的 `Ctrl+Alt+S`。Ctrl 加反引号可打开项目终端。

## 手机端续接与审查（开发版）

- 首次使用，在设置的“电脑”页选择电脑操作系统，按指引在开发电脑安装、登录并授权项目。电脑上线后核对 Codex 就绪状态。临时无法确认账户身份时，使用重试或回到前台重新检查。
- 在常规设置开启本机文字草稿后，主输入框的未发送文字最多保留七天。直接收到发送确认后清除对应版本。响应丢失时先核对回执，恢复界面保留原稿供人工确认。刷新后附件需重新选择。
- 从手机列表进入“需要我处理”查看各电脑的待办。离线电脑显示状态未知。开启后台任务提醒后，待审批和待回答会显示通用通知；完成提醒可单独开启。iPhone 先添加到主屏幕，再从主屏幕应用内启用。
- 在会话搜索中输入关键词，点击“搜索消息正文”。新 Host 分批读取已授权消息，支持继续搜索和取消。点结果查看原文。旧 Host 仍支持按会话标题和项目名查找。
- 在工作区或分支差异中点击增删行旁的加号，填写意见并选择“加入当前草稿”，查看内容后手动发送。分支比较包含对应的提交标识。
- 新版 Host 单个附件和每条消息合计均为 2 MiB，最多四个。Web 按所连 Host 实际公布的限额处理日志和图片。

## 后台运行与持久化

0.4.2 自动生成回环地址和私有令牌，独立共享所有者由 Host、CLI 与桌面代理复用。可显式执行 `agentdeck runtime-start`（后台）或 `runtime-serve`（前台）；`agentdeck codex [THREAD_ID]`、Windows `agentdeck desktop [原版程序绝对路径] [THREAD_ID]` 复用该服务。桌面已运行时拒绝切换；指定会话需确认目录可访问、索引就绪和恢复成功。令牌不进入命令行；Host 停止不终止独立共享服务。清除固定 Codex 路径可在 Host 停止后执行 `agentdeck configure --codex-exe auto`。

`agentdeck start` 在后台启动监督进程和 Rust 服务，关闭终端后继续运行；重复启动复用现有实例。服务异常退出时退避重启，连续失败达到限制后停止并留下诊断。网络暂时不可用时服务继续运行并重连。恢复未知发送结果时先核对，不自动重发。

Windows 自启使用当前用户的 `HKCU/Software/Microsoft/Windows/CurrentVersion/Run`，启动无窗口 Host；沿用旧版 `AgentDeck` 启动项名称，启用时替换其程序路径。Linux 使用 systemd 用户服务，macOS 使用 `~/Library/LaunchAgents/top.ptsfdtz.agentdeck.plist`。三者默认都是用户登录后启动，不以管理员、SYSTEM 或 root 运行；Linux 未登录开机运行需要管理员另行配置用户 lingering，macOS 未登录开机运行需要另配 LaunchDaemon，均不由安装器自动开启。

状态目录：Windows `%LOCALAPPDATA%/AgentDeck`；Linux `${XDG_STATE_HOME:-~/.local/state}/agentdeck`；可显式设置 `AGENTDECK_DATA_DIR`。CLI 与服务使用同一规则，并解析已有数据库的真实路径以兼容 Windows MSIX 重定向。目录锁阻止同一份状态被多个服务占用。

保留电脑身份和证书、登录刷新凭据、项目授权、设备撤销、会话索引、审批和恢复信息；`host.json` 保存运行时地址、令牌文件路径等配置，不保存账户密码。Windows 凭据继续使用 CurrentUser DPAPI；Linux/macOS 使用私有目录和文件权限，不能把它视作 DPAPI 加密。`host.log` / `host.log.1` 只记录有界脱敏诊断，不落盘完整状态或聊天事件。

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

`stop` 会真正停止服务，包括运行中的任务；使用前确认任务状态。它保留下次登录自启设置，禁用自启需单独执行 `autostart disable`。日常审批与追问继续在 Web/PWA 操作；CLI 不自动批准权限，也不提供任意 RPC。

升级可重复运行安装命令，指定旧版本可回退程序：Windows 下载脚本后用 `-Version 版本号` 执行；Linux 在管道右侧使用 `AGENTDECK_VERSION=版本号 sh`。安装器使用独立版本目录并保留旧程序，不覆盖正在运行的二进制，不更改账户和项目状态；已运行的 Host 在显式 `agentdeck restart` 后切到新版本。回退程序不等同于回退数据库，跨不兼容数据迁移不能直接降级。

更新入口（已上线）沿用 **yecaoyun / `https://agent.ptsfdtz.top`**，未迁移到 aly。Host 使用 `agentdeck update --check` 检查、`agentdeck update` 下载校验并安装；只执行程序内置的安装脚本，保留旧版本和正在运行的服务，空闲后显式 `agentdeck restart`。旧 Host 首次仍需重跑安装命令才能获得更新命令；更新源可用 `--origin HTTPS_ORIGIN` 或 `AGENTDECK_DOWNLOAD_ORIGIN` 指定，安装器保存来源和发布版本。

### 用户更新软件

Host 更新命令必须在网页当前选中的**被控制电脑**执行；更新网页不会更新该电脑。已有更新命令时按以下顺序操作，旧版不支持时先重跑对应系统的安装命令：

```sh
agentdeck update --check
agentdeck update
# 确认任务已结束、审批和未知发送结果已核对后再重启
agentdeck restart
agentdeck status --json
```

“安装成功”只表示文件已安装；`restart` 返回也不表示 Codex 已就绪。首次启动可能正在下载和校验兼容运行时；待 `cloud.online`、`codexReady` 均为 `true` 且 `runtimeError` 为 `null`，再从 Web/PWA 打开会话核对历史和实际使用。持续未就绪时查看 `agentdeck logs`、`agentdeck doctor`；无需因初始化等待重新登录或添加项目。更新保留身份、账户、项目和会话状态。网页确认目标版本运行、云端连接与 Codex 就绪后，可点“更新完成”提示右侧 ×，或关闭已完成的详情弹窗，收起本次提示；当前浏览器会记住该电脑的这次关闭状态，新版本仍会提示。

网页直接更新（0.4.2 已发布，完整升级链路验收待补）：发现新版后点“查看更新”，阅读版本与更新说明，再点“下载并安装更新”；安装不打断任务，完成后可选择“空闲后重启并完成更新”，等待期间可取消待重启。专用接口沿用电脑授权及操作回执，不依赖 Codex 或 AI 会话，不接收任意命令或下载 URL。Host 持久化更新状态，刷新、断线或更新进程异常后可重新核对；切换前阻止新操作进入并核对全部任务、审批及未知任务结果，重连后确认实际运行版本、云端连接和 Codex 就绪才标为完成。Linux systemd Host 使用独立用户更新服务下载安装和切换，保留原 Host 的隔离配置。旧 Host 显示一次性安装命令，必须在被控制电脑执行；开发版不自动替换。

旧桌面实例仍运行时，先在任务空闲后从旧托盘“停止并退出”，再启动 Host。不会强杀原实例或生成另一套身份。已有 MSIX 私有数据需要沿用该实际目录，可显式设置 `AGENTDECK_DATA_DIR`；不再通过 `.tmp/desktop-dev-data-dir.txt` 隐式切换，不能仅凭云端账户恢复电脑证书。

### Windows 权限配置冲突

0.4.2 若提示 `Codex is not ready`，先执行 `agentdeck status --json`。当 `runtimeError` 为 `UNSAFE_UPSTREAM_CONFIG: Workspace permission profile overridden` 时，检查 `${CODEX_HOME}/config.toml`（未设置 `CODEX_HOME` 时为 `$HOME/.codex/config.toml`）中的旧 `sandbox_mode`。已知 `sandbox_mode = "danger-full-access"` 会与 Host 工作区权限校验冲突；这个通用错误也可能表示默认权限名称或权限继承关系不符。

针对已确认的旧 `sandbox_mode` 冲突，先备份文件，再移除或注释该配置项；0.4.2 Windows 改成 `workspace-write` 仍会被旧校验拒绝。保存工作并核对任务、审批与未知发送结果后重启电脑，使独立共享运行时重新加载配置；仅执行 `agentdeck restart` 会保留共享运行时，不能保证重载。启动 Host 后确认 `codexReady=true`、`runtimeError=null`，再执行 `agentdeck projects sync`。0.4.3 已包含进程内安全默认值覆盖和具体字段诊断，实机验收边界见[功能状态](status.md)。

## Linux 运行时

0.4.2 默认自动下载、校验并启动官方共享运行时，保留 Linux systemd Host 的隔离限制；正常安装无需手工配置 WebSocket。就绪以 `codexReady`、`sandboxVerified`、`sharedRuntime` 为 true、`runtimeError` 为 null 为准。Linux 原生桌面共享尚未支持，CLI 使用 `agentdeck codex`。

下面仅用于已有手动管理的外部运行时迁移或诊断。外部程序同样需要匹配官方包来源与哈希，版本号一致不足以通过；配置前核对任务状态。准备私有令牌文件和固定官方 Codex，再保存附着配置：

```sh
agentdeck stop
agentdeck configure --runtime-ws ws://127.0.0.1:4500 \
  --runtime-token-file /绝对路径/runtime-token --protocol auto
# 只有实际核验隔离后，才增加 --sandbox-verified
agentdeck start
agentdeck status
```

运行时令牌文件必须绝对路径、权限 0600；配置在重启及 systemd 启动时复用。也兼容 `AGENTDECK_RUNTIME_WS_URL`、`AGENTDECK_RUNTIME_TOKEN_FILE`、`AGENTDECK_RUNTIME_PROTOCOL_VERSION` 和 `AGENTDECK_LINUX_SANDBOX_VERIFIED` 环境变量，环境变量优先。没有显式隔离核验时不放开执行。

必须保留原生 `codex`、`codex-code-mode-host`、`codex-linux-sandbox` 辅助入口，并放到隔离配置允许的路径。已知 alpha 命令工具仍可能因私有 `CODEX_HOME/tmp/arg0-linux/` 入口返回 `ENOENT`；没有通过放宽隔离绕过。systemd 保留 `ProtectSystem=strict`、`ProtectHome=read-only`、`PrivateTmp` 等限制；附件需要写入已授权项目时，在 drop-in 的 `ReadWritePaths=` 显式列出路径。

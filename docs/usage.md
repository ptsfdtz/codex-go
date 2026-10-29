# 使用与维护

[项目介绍](../README.md) · [开发入口](../AGENTS.md)

以下面向当前安装版；未发布的自动运行时及三端共享候选见[运行时验收](runtime.md)。

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
# 执行任务前还需配置本文的 Linux 本机运行时
agentdeck start
agentdeck autostart enable
```

```sh
# macOS arm64（Apple Silicon）：需要包含 macOS 产物的发布
curl -fsSL https://agent.ptsfdtz.top/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
agentdeck login --username NAME
agentdeck projects add /绝对路径/项目
agentdeck start
agentdeck autostart enable
```

Windows 安装位置为 `%LOCALAPPDATA%/Programs/AgentDeck`，Linux 为 `~/.local/share/agentdeck`，macOS 为 `~/.local/share/agentdeck`，命令入口为 `~/.local/bin`。Windows 安装后如当前终端找不到命令，请新开终端。ZIP/tar.gz 内另有 `start.ps1` / `start.sh`，可直接启动已配置的 Host。安装器和发布包覆盖 Windows x64、Linux x64/ARM64 和 macOS arm64；macOS 使用已安装的兼容 Codex CLI，用户登录后通过 launchd 自启，包未签名/公证，线上安装、升级和实际模型任务尚未验收。macOS Intel 暂不发布。Windows/Linux 三个平台包已发布；ARM64 尚未做实机运行验收。

密码在终端隐藏输入，不支持明文 `--password` 参数。临时密码会在登录过程中引导修改并重新登录。登录、项目管理等命令会按需启动本机管理服务；Codex 缺失或配置错误时仍能登录、查看状态和诊断。

Windows 可用下列脚本检查已有 Codex；存在达到最低版本的原生程序时直接复用，不下载副本，缺失时才安装经过校验的基线包（保留官方辅助程序布局）：

```powershell
irm https://agent.ptsfdtz.top/install-codex.ps1 | iex
agentdeck doctor # 查看 Codex 路径；需要认证时，用显示的程序路径执行 login
agentdeck restart
```

## 后台运行与持久化

共享运行时需先配置认证 WebSocket 地址及私有令牌文件，再执行 `agentdeck runtime-start`（后台）或 `runtime-serve`（前台）；`agentdeck codex [THREAD_ID]`、Windows `agentdeck desktop 原版程序绝对路径 [THREAD_ID]` 复用该服务。桌面已运行时拒绝切换；指定会话需确认目录可访问、索引就绪和恢复成功。令牌不进入命令行；Host 停止不终止独立共享服务。清除固定 Codex 路径可在 Host 停止后执行 `agentdeck configure --codex-exe auto`。

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

更新入口（已上线）沿用 **yecaoyun / `https://agent.ptsfdtz.top`**，未迁移到 aly。Host 使用 `agentdeck update --check` 检查、`agentdeck update` 下载校验并安装；只执行程序内置的安装脚本，保留旧版本和正在运行的服务，空闲后显式 `agentdeck restart`。旧 Host 首次仍需重跑安装命令才能获得更新命令；更新源可用 `--origin HTTPS_ORIGIN` 或 `AGENTDECK_DOWNLOAD_ORIGIN` 指定，安装器保存来源和发布版本。网页/PWA 在“设置→常规”检查当前站点的新构建，提示手动重新加载，不自动丢弃草稿。

### 用户更新软件

Host 更新命令必须在网页当前选中的**被控制电脑**执行；更新网页不会更新该电脑。已有更新命令时按以下顺序操作，旧版不支持时先重跑对应系统的安装命令：

```sh
agentdeck update --check
agentdeck update
# 确认任务已结束、审批和未知发送结果已核对后再重启
agentdeck restart
agentdeck status --json
```

“安装成功”只表示文件已安装；`restart` 返回也不表示 Codex 已就绪。首次启动可能正在下载和校验兼容运行时；待 `cloud.online`、`codexReady` 均为 `true` 且 `runtimeError` 为 `null`，再从 Web/PWA 打开会话核对历史和实际使用。持续未就绪时查看 `agentdeck logs`、`agentdeck doctor`；无需因初始化等待重新登录或添加项目。更新保留身份、账户、项目和会话状态。

网页直接更新（已实现，未发布）：发现新版后点“查看更新”，阅读版本与更新说明，再点“下载并安装更新”；安装不打断任务，完成后可选择“空闲后重启并完成更新”，等待期间可取消待重启。专用接口沿用电脑授权及操作回执，不依赖 Codex 或 AI 会话，不接收任意命令或下载 URL。Host 持久化更新状态，刷新、断线或更新进程异常后可重新核对；切换前阻止新操作进入并核对全部任务、审批及未知任务结果，重连后确认实际运行版本、云端连接和 Codex 就绪才标为完成。Linux systemd Host 使用独立用户更新服务下载安装和切换，保留原 Host 的隔离配置。旧 Host 显示一次性安装命令，必须在被控制电脑执行；开发版不自动替换。网页/PWA 自身更新仍在“设置→常规”重新加载。

旧桌面实例仍运行时，先在任务空闲后从旧托盘“停止并退出”，再启动 Host。不会强杀原实例或生成另一套身份。已有 MSIX 私有数据需要沿用该实际目录，可显式设置 `AGENTDECK_DATA_DIR`；不再通过 `.tmp/desktop-dev-data-dir.txt` 隐式切换，不能仅凭云端账户恢复电脑证书。

## Linux 运行时

当前 Linux 执行仍使用**带认证的本机回环 app-server**，安装 Host 不会自动完成运行时和隔离配置。准备私有令牌文件和匹配版本的原生 Codex，再保存附着配置：

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

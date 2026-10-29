# 官方运行时与三端共享验收

[开发入口](../AGENTS.md) · [发布流程](deployment.md) · [功能状态](status.md)

## 官方运行时三端共享候选（未发布）

本批候选强制只执行官方预编译 Codex：当前固定官方 `0.166.0-alpha.1`（官方 alpha 包，并非稳定版），覆盖 Windows x64、Linux x64/ARM64、macOS arm64。启动前核对官方包 SHA-512 和全部文件 SHA-256，执行 `--version` 前也核对入口哈希；版本号相同的自编译程序也不能通过。未知程序不执行，缺失时自动下载官方包，损坏的托管包拒绝启动；旧源码编译脚本已禁用。更新基线须更新官方包清单并重新验收，不编译 Codex。

首次启动自动生成回环地址和私有令牌，启动独立共享所有者；Host、`agentdeck codex` 和原版桌面代理复用该服务。Windows 安装器增加“Codex shared”开始菜单入口，`agentdeck desktop` 自动发现原版应用；macOS 桌面代理为待实机验证的候选。Linux 提供独立 runtime/Host systemd 用户服务，Host 保留现有隔离设置；不把 Linux 原版桌面列为已支持。原版桌面已经运行时要求空闲退出后重开，不强杀或迁移进行中的任务。已有手动管理的外部运行时保留配置，但不能仅靠版本号通过官方来源证明，迁移验收需单独处理。

普通用户只需安装、登录 AgentDeck、授权项目和启动；需要 Codex 认证时执行 `agentdeck codex-login`（无浏览器环境可加 `--device-auth`）。不要求 Rust、Node、Python，也不要求用户填写端口、地址或令牌。`agentdeck runtime-check` 提供真实沙箱/指令检查及官方来源、完整性信息；实际就绪以 `status --json` 的 `codexReady`、`sandboxVerified`、`sharedRuntime` 为 true、`runtimeError` 为 null 为准。状态中的 `officialRuntime` 记录包来源与入口哈希，发布门槛核对它与候选清单一致，拒绝自编译或改哈希的运行时。

本机验证：Linux x64 官方包的项目指令读取、内读写及外读写拒绝通过；两个独立认证连接共享同一 UUID、错误令牌拒绝、重复启动复用原生进程、真实模型文件写入和读回、断开后另一连接恢复会话通过。候选安装器已通过本机 HTTPS、隔离全新状态及无开发工具 PATH 的安装验证，首次自动下载、初始化、真实沙箱验证及 Host 重启保留原生 PID/身份/令牌通过；本机 HTTPS 安装不等于生产下载或云端转发验收。官方包损坏拒绝、同版本自定义程序不执行、三个并发启动复用同一所有者及普通 Linux 用户的真实指令/隔离与 Host 就绪检查通过；21 项 Rust 测试、严格 Clippy 和 13 项发布门槛测试通过。报告位于 `artifacts/official-runtime/`。Windows/macOS 用户自行实机验收，ARM64、生产云端、手机及系统重启仍未完成，本批不得晋升正式发布。历史“已发布”描述仅指之前版本。

本地全链路验收（Linux x64）：已启动隔离 PostgreSQL、真实云端、HTTPS Web、Host 与官方 CLI，禁用浏览器局域网连接后实走云端加密转发；CLI 新建 → Web 读取并续聊、Web 新建 → CLI 按同一 UUID 续聊及网页实时更新通过，实际文件结果一致，整个过程原生 PID 不变，Host 更换程序也保留同一运行时。CLI 必须使用 `agentdeck codex` 共享入口，普通独立启动的 `codex` 不会自动接入。补齐官方 `project/create` 登记与重试：CLI 首次打开项目、Host 本地授权待运行时就绪后登记、重复登记不增副本、撤销授权后不自动恢复均通过；原生目录的名称和顺序仍以 `project/list` 为准。共享会话恢复时容纳 CLI 返回的上一轮文件系统信息，新一轮显式发送已验证的 Host 权限配置，不沿用 CLI 的临时目录授权；续聊后真实模型执行的项目内读写及外部测试目录读写拒绝通过。完整结果与脱敏截图见 `artifacts/official-runtime/fullstack-linux.json` 及同目录截图；本地云端验收不代表生产部署或原版桌面验收。

本地私有 CA／自托管云端可在启动 Host 前设置 `AGENTDECK_CLOUD_CA_FILE` 为 PEM CA 路径；该显式配置同时限定云端 HTTPS 和 WSS 的信任根，仍校验证书与主机名，无效或空证书拒绝启动。正常公网安装无需此设置。

共享桌面代理若报 `PROXY_CONFIG_MISMATCH`，包含本次诊断改动的版本会在退出前将脱敏报告写到 Host 状态目录的 `desktop-startup-diagnostic.json`；`agentdeck desktop` 会显示完整路径。报告只保留字段结构、类型及布尔开关，隐藏插件/服务器标识、路径和字符串值。Windows 默认读取命令为 `Get-Content -Raw -LiteralPath "$env:LOCALAPPDATA\AgentDeck\desktop-startup-diagnostic.json"`；设置了 `AGENTDECK_DATA_DIR` 时从该目录读取。核对报告 `createdAt` 与本次启动时间，避免把旧文件视为本次结果。报告用于定位启动配置差异，不代表可以忽略插件、MCP 或沙箱冲突。

### Windows / macOS 自行验收方法

使用本批候选 ZIP/tar.gz，先核对同批 SHA-256，解包到独立目录。**当前线上稳定安装命令不会获得本批未发布改动。** 以下以候选目录中的程序运行；Windows 使用 `./agentdeck.exe`，macOS 使用 `./agentdeck`（首次先 `chmod +x agentdeck agentdeck-service agentdeck-codex-proxy`）。原版 Codex 桌面须预先安装。可用临时的 `AGENTDECK_DATA_DIR` 隔离验收身份，避免碰日常 Host；首次运行不要启用自启或覆盖现有服务。Linux 自定义运行时不要放在 `/tmp`，严格临时目录拒绝策略会阻止它自执行；使用默认用户数据目录。

候选验收隔离设置（同一终端后续命令沿用；新终端使用相同目录）：

```powershell
# Windows PowerShell
$env:AGENTDECK_DATA_DIR = Join-Path $env:LOCALAPPDATA 'AgentDeck-acceptance'
$env:AGENTDECK_PORT = '49531'
```

```sh
# macOS
export AGENTDECK_DATA_DIR="$HOME/Library/Application Support/AgentDeck-acceptance"
export AGENTDECK_PORT=49531
```

```sh
./agentdeck runtime-check
./agentdeck codex-login                 # 已有有效 Codex 认证可跳过
./agentdeck login --username YOUR_NAME
./agentdeck projects add ABSOLUTE_TEST_PROJECT_PATH
./agentdeck start
./agentdeck status --json
./agentdeck desktop
```

1. 等待上述就绪字段全部满足，确认 `officialRuntime` 与同平台 `codex-runtime-manifests/` 中的版本、来源和入口哈希相同，没有 `dev.agentdeck`。自动发现遇到多个桌面版本时可用 `desktop ABSOLUTE_DESKTOP_EXE` 明确选择；macOS 桌面接入若失败就记录失败，不当作已支持。
2. 在原版桌面新建测试会话，让模型创建 `shared-proof.txt` 写入 `DESKTOP`；在网页选择对应测试电脑和项目，打开同一会话，确认 UUID/历史相同，追加一轮把文件改为 `WEB`。
3. 新开终端，使用同一个验收状态目录执行 `./agentdeck codex THREAD_UUID`，确认读到前两轮，追加一轮改为 `CLI`；回桌面和网页核对三轮历史、文件内容及完成状态。测试只使用新建会话和项目。
4. 在普通权限下测试项目内读写、项目外未授权读写被阻止；触发一次性审批，分别允许和拒绝。完整访问仅用于明确的测试操作，随后切回普通权限再次验证隔离。
5. 流式回复中断开网页并重连，确认结果不重复发送；任务空闲后执行 `./agentdeck restart`，确认设备身份、会话、历史及共享原生进程保持。最后实际注销/登录或重启系统，检查自启、认证与历史恢复；Mac 桌面和 launchd 必须分别记录结果。
6. 保存版本、系统/架构、测试 UUID、各项结果和脱敏截图/日志，不记录密码、令牌或完整日常聊天。手机测试另验证 PWA 输入法、后台切换、切网与重连。

开发者可在独立验收状态运行真实本地检查：`python scripts/codex/verify-shared-runtime.py --cli PATH_TO_CANDIDATE_CLI --data-directory ABSOLUTE_ACCEPTANCE_DIRECTORY --model YOUR_AVAILABLE_MODEL`。该脚本使用现有 Codex 认证、发送真实任务并归档自建会话；只证明本地运行时链路，不代替网页、云端或原版桌面验收。

# AgentDeck

通过 Web/PWA 操作电脑上的 Codex。Host 执行任务、保存会话权威状态；云端保存账户和设备归属并转发加密连接，不保存聊天或媒体、不持有 OpenAI 凭据、不运行模型。手机统一使用浏览器或 PWA。

## 当前实现与交付

- Windows Codex 自动兼容（本地待发布）：启动前验证真实 AGENTS.md 读取、模型/原生项目协议及四项沙箱边界；现有版本缺少协议或存在 SystemRoot 缺陷时，自动安装固定的官方 `0.166.0-alpha.1` 兼容运行时，保留原程序与 Codex 状态目录。下载 SHA-512、45 个文件 SHA-256 核验及原子安装，不以关闭沙箱兜底；选择按原程序哈希记忆，已有共享任务不强制迁移。诊断命令 `agentdeck runtime-check [--codex-exe PATH]`，真实回归脚本 `scripts/codex/verify-runtime-compatibility.ps1`。官方 0.164 缺陷回退、0.159 协议缺口回退、正常新版保留、重开记忆、损坏资源拒绝、共享所有者与 Host 连接、隔离原生历史读回均通过；未调用模型，未重启日常 Host/桌面。

- 项目图片预览与设置恢复（已发布）：项目文件可直接渲染 PNG/JPEG/GIF/WebP/SVG/BMP/ICO/AVIF，8 MiB 上限、64 KiB 分块及 SHA-256 校验，切换或关闭即停止后续读取并释放图片；SVG 使用图片上下文，不嵌入可执行文档。新增显式 `files.readImage` 和 `projectImagePreview` 能力，沿用项目授权及句柄/内容变化核对，旧 Host 提示升级。通知开关及设置分类保存到当前浏览器，模型/输出默认值和缓存策略表单重新读取 Host 已保存值；关闭网页期间仍不接收通知。Web 类型/ESLint/格式/生产构建、Host 全目标严格 Clippy、真实 SVG/PNG 读取与多分块/校验/取消定向检查通过；真实 Host 图片与浏览器重开仍待验收；图片能力需升级 Host。
- 无项目对话完整访问（已发布）：普通聊天开放权限弹窗，沿用已确认的权限记忆和发送参数；Host 接受普通聊天的完整访问，切回工作区时仍逐轮重设审批与沙箱策略。项目技能及 Plan/Goal 限制保留。Web 类型/ESLint/格式/生产构建、Host 全目标严格 Clippy 通过；未发送真实任务，需升级 Host 后验收。
- Web 设备名称（已发布）：侧栏、电脑切换入口、更新提醒及删除确认统一优先使用已配置的显示名称；电脑清单主名称也使用别名，原始名称仅在清单中作为辅助信息显示。沿用按账户/浏览器设备及电脑保存的名称，空名称回退原名。类型、相关 ESLint、格式及生产构建通过；浏览器/真机交互仍待验收。
- 正式入口：[Web/PWA](https://agent.ptsfdtz.top/)、[管理端](https://agent.ptsfdtz.top/admin)；备用站点：[GitHub Pages](https://ptsfdtz.github.io/codex-go/)。
- 发布 `release-20261027-1`，Host 稳定版本 `host-c278b86fe50bb54c04432930ea5b037fbbcccd91`：Windows x64、Linux x64、Linux ARM64 及 SHA-256/平台清单；Web 构建 `eeeb2b690f6a35bca9c65e6368e6965e61bd315e7c7e000da925e3f6427d3ebd`。管理页随云端二进制更新。
- Web 项目名称与顺序仅取自原生 `project/list`；会话跟随原生交互目录，完整同步隐藏失效索引，不删除本地历史或撤销授权。归档不在普通列表展示，可在归档视图跨项目读历史；已删除会话不显示。保留运行中任务、审批和未知结果保护。
- Host、CLI、原版桌面的本地 Codex 模式及 Web 可连接同一认证原生运行时，沿用 UUID 与权威历史，不复制或改写桌面私有数据库。Codex 最低可识别 `0.159.2`，接受兼容的新版本，Windows 功能不兼容时自动使用经验证的官方兼容运行时；优先复用现有程序，显式路径配置优先，私有副本仅作最后回退。最低版本准入不替代协议与沙箱检查。
- 安装版/开发版默认共用账户、电脑身份、证书、项目、附件和运行时配置；显式 `AGENTDECK_DATA_DIR` 才隔离。开发启动复用运行中 Host，空闲后显式 `--restart` 才切换程序。
- 附件统一存于 Host 附件库，SHA-256 去重并保留会话授权引用；历史项目附件继续按原路径读取。保留审批和只读访问边界，不开放整个状态目录。
- 云端支持设备登记删除、管理员账户删除和最后一个可用管理员保护；普通用户无账户删除入口。删除云端登记不删除电脑文件或 Codex 会话。

**日常三端最终切换尚未完成：当前打开的原版桌面仍连接原运行时，需空闲退出后通过本机 `Codex shared` 入口重开并复核。** 该入口使用原版桌面程序。本机共享原生程序为桌面基线加官方 SystemRoot 修复的诊断构建 `0.164.0-dev.agentdeck.6905ece`，保留沙箱，未作为官方 Codex 分发；不能宣称仅保留一个原生进程的目标已完成。

## 实际验证与下一步

消息列表“回到最新”改为下箭头；底部跟随新消息和流式增量，上滑暂停，向下回到底部或点击箭头恢复。Web 类型检查与生产构建通过；滚轮、触摸和滚动条交互尚待浏览器实测。

本次类型/ESLint、格式、生产构建、依赖审计、Host/云端严格 Clippy、图片读取/分块/完整性/取消定向检查与 schema 核验通过。锁文件缺少 lucide-react 解析记录的问题已修复，并在全新目录完成冻结安装、检查和构建。历史测试/夹具及依赖按此前要求删除，不再沿用旧测试数量作为当前证据。

本次线上验收：三个平台 CI、GitHub 发布、云端构建与 Pages 发布全部通过；正式 Web 12 个文件、管理端三个静态文件及 Pages 13 个文件与对应产物哈希一致。存活/数据库就绪均为 200，未认证管理请求和无来源删除请求分别为 401/403；云端运行二进制哈希与 CI 一致。稳定指针、三个平台清单/包内版本、所有公开下载文件完整 SHA-256 核对通过；Linux x64 在独立目录完成线上安装与 CLI 运行，未启动模型任务或重启日常 Host/桌面。

真实验收覆盖隔离原版桌面的手动发送、新建及一次性审批，交互 CLI/Web 同 UUID 历史读回；日常 Host 的实际模型回复、沙箱读取、CLI 续聊及重启保持原生进程通过。日常原生目录与 Edge/实际 Sidebar 的项目、归档/历史/恢复及自建验收对话删除核对通过；自建发送验收对话已归档，未修改用户会话。

待验收：日常桌面最终共享切换、桌面专有应用工具、手机真机/PWA 键盘及安全区、实际注销再登录自启、Linux 真实模型隔离、ARM64 实机、长期休眠切网、大历史压力与生产账户删除事务。编译、下载和健康检查不能代替这些验收。

此次发布先备份数据库与私有配置，数据库备份为 `/var/backups/agentdeck/agentdeck-20261027T060028Z.dump`；发布回退信息与下载指针/脚本备份在 `/var/backups/agentdeck/release-20261027-1/`，旧 Web/云端目录保留。当前目录为 `/opt/agentdeck/releases/release-20261027-1`，回退按 `previous-current.txt` 恢复链接、重启云端并单独恢复下载指针；不回滚数据库。

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

Windows 安装位置为 `%LOCALAPPDATA%/Programs/AgentDeck`，Linux 为 `~/.local/share/agentdeck`，命令入口为 `~/.local/bin`。Windows 安装后如当前终端找不到命令，请新开终端。ZIP/tar.gz 内另有 `start.ps1` / `start.sh`，可直接启动已配置的 Host。macOS 暂不支持；三个平台包均已发布；ARM64 尚未做实机运行验收。

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

`stop` 会真正停止服务，包括运行中的任务；使用前确认任务状态。它保留下次登录自启设置，禁用自启需单独执行 `autostart disable`。日常审批与追问继续在 Web/PWA 操作；CLI 不自动批准权限，也不提供任意 RPC。

升级可重复运行安装命令，指定旧版本可回退程序：Windows 下载脚本后用 `-Version 版本号` 执行；Linux 在管道右侧使用 `AGENTDECK_VERSION=版本号 sh`。安装器使用独立版本目录并保留旧程序，不覆盖正在运行的二进制，不更改账户和项目状态；已运行的 Host 在显式 `agentdeck restart` 后切到新版本。回退程序不等同于回退数据库，跨不兼容数据迁移不能直接降级。

更新入口（已上线）沿用 **yecaoyun / `https://agent.ptsfdtz.top`**，未迁移到 aly。Host 使用 `agentdeck update --check` 检查、`agentdeck update` 下载校验并安装；只执行程序内置的安装脚本，保留旧版本和正在运行的服务，空闲后显式 `agentdeck restart`。旧 Host 首次仍需重跑安装命令才能获得更新命令；更新源可用 `--origin HTTPS_ORIGIN` 或 `AGENTDECK_DOWNLOAD_ORIGIN` 指定，安装器保存来源和发布版本。网页/PWA 在“设置→常规”检查当前站点的新构建，提示手动重新加载，不自动丢弃草稿。

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

## 下载发布与 VPS

正式 Web：[agent.ptsfdtz.top](https://agent.ptsfdtz.top/)，管理端 [/admin](https://agent.ptsfdtz.top/admin)。生产使用现有 Nginx、Rust/systemd 和 PostgreSQL 17，Cloudflare 仅做 DNS。云端账户 schema v3 支持电脑证书/地址登记、会话绑定的短期凭据、撤销和刷新轮换；VPS 继续只转发加密业务字节。

`pnpm host:package` 在当前平台构建发布包，输出到 `artifacts/host-downloads/`：

```text
install.sh / install.ps1 / install-codex.ps1
releases/stable.txt
releases/版本号/agentdeck-windows-x64.zip[.sha256]
releases/版本号/agentdeck-linux-x64.tar.gz[.sha256]
releases/版本号/agentdeck-linux-arm64.tar.gz[.sha256]
```

使用 `AGENTDECK_RELEASE_VERSION` 指定不可变发布目录。CI 构建 Windows x64、Linux x64 和 ARM64，合并后的 `agentdeck-downloads.tar.gz` 可直接上传 VPS；ARM64 基于 Ubuntu 24.04，x64 CI 基于 Ubuntu 22.04。旧独立 Linux workflow 和桌面安装器发布路径已移除。

Web 构建自动生成 `version.json`，与资源一同部署并保持该清单不缓存。

在服务器执行 `sh scripts/host/publish-downloads.sh 上传目录 /opt/agentdeck/downloads`，先核对包校验值、发布不可变版本文件，最后原子更新 `stable.txt`；旧版本保留。将 `server/deploy/downloads.nginx.conf` 的规则 include 到现有 HTTPS server block，同一 server block 中另 include `server/deploy/web-updates.nginx.conf` 并沿用 Web 根目录，确保版本清单 no-store、PWA worker/安装清单重新验证；执行 `nginx -t` 后 reload。下载规则不替换现有 `/api/`、`/admin`、Web 或隧道转发；单个平台尚未发布时返回 404，不退回 HTML 页面冒充程序。

生产云端程序仍由 `/opt/agentdeck/current/agentdeck-cloud` 提供，服务配置 `/etc/agentdeck/cloud.env`。运维：`ssh yecaoyun 'systemctl status agentdeck-cloud --no-pager'`；日志 `journalctl -u agentdeck-cloud -n 50 --no-pager`。`agentdeck-backup.timer` 每日 UTC 03:20 起随机延迟最多十分钟执行；可手动启动 `agentdeck-backup.service`。备份位于 `/var/backups/agentdeck/`，需要另做异机备份；云端备份不包含各 Host 的 Codex、项目和本机证书。Docker/Caddy 备用部署见 `server/deploy/`，当前生产未使用该路径。

## 开发与验证

默认在 `release` 分支开发，不自动提交或推送。Host Rust 源码暂保留 `desktop/core/` 路径，以维持公开入口、测试和协议导出的兼容性；这不表示仍依赖桌面 UI。

| 目录                                             | 职责                                            |
| ------------------------------------------------ | ----------------------------------------------- |
| `desktop/core/src/host/`、`src/bin/agentdeck.rs` | CLI、持久配置、后台监督、自启与日志             |
| `desktop/core/src/` 其余功能目录                 | 会话执行、Codex 协议、TLS、项目授权、存储和设置 |
| `web/`                                           | Web/PWA、浏览器 TLS 与账号连接                  |
| `server/`                                        | 账户、管理页、数据库迁移和云端转发              |
| `packages/`                                      | 共用连接协议、锁定 Codex 生成 schema            |
| `scripts/host/`                                  | 安装、开发启动、打包与下载发布                  |

开发 Host 需要 Rust MSVC ≥1.88、Visual Studio C++ 和 Windows SDK，或 Linux Rust/原生编译工具；Web/发布脚本需要 Node 22.22.3、pnpm 12.3.4。不再检查 WebView2。

```powershell
pnpm install --frozen-lockfile
pnpm host:build
pnpm host:dev          # 编译并显示状态；不启动图形窗口
pnpm start             # 编译后启动或复用现有 Host
pnpm host:dev -- --restart # 任务空闲时，显式切换到新编译程序；共用原状态
pnpm host:package
pnpm check
cargo clippy --locked --manifest-path desktop/core/Cargo.toml --all-targets -- -D warnings
pnpm schema:verify
pnpm web:dev
pnpm --filter @agentdeck/web build
```

`pnpm web:dev` 打开 `http://localhost:1430`，本地页重新登录同一账户即可访问真实电脑与会话。`cloud-dev` 模式仅在回环开发服务器代理 API、Cookie/CSRF 和 WebSocket 到 `https://agent.ptsfdtz.top`；保存 Web 代码自动热更新，不部署、不修改远端白名单。电脑上的现有服务须保持在线；发送、审批和撤销会作用于真实环境。本地浏览器身份与正式网页独立。可用 `VITE_CLOUD_ORIGIN` 指向另一 HTTPS 云端，正式构建不包含开发代理。

桌面外部变化同步：managed 模式监听 Codex 初始化接口返回目录的系统文件通知，仅把路径当作失效提示，不读取私有数据库或解析会话文件；通过官方接口重新核对会话身份、项目授权和索引，再发送可重放的 `session.contentChanged`。Web 合并短时重复通知，只补读当前可见会话最近一页，保留更早历史、草稿、工具展开和阅读位置；并发流式内容优先，页面返回前台后补读。附着模式继续使用原生通知，原有 15 秒索引核对周期不变，时间戳前进时也提示补读，以恢复遗漏通知。

## 必须保留的边界

- 服务端附着的 Codex 是权威源，保留原 `thread/turn/item` 身份；发送 ACK 不代表完成，结果未知先核对，不自动重发。
- 不复制或写入 Codex 私有数据库，不暴露任意 RPC，不因远程访问放宽项目授权或执行确认；凭据不进入文档、日志或测试产物。
- Web 使用 Origin 白名单、HttpOnly Cookie、CSRF 和一次性隧道票据；内层 TLS 校验电脑证书。证书错误不自动回退；浏览器阻止 LAN 时走公网。当前账号 LAN 也依赖云端复核，不承诺云端离线可用。
- 不随意修改协议序列化身份或 Rust 公开入口；旧配对协议仅兼容旧记录和客户端。
- 上游 schema 是生成物，升级 Codex 时显式重导出和核验，不手改；仓库保留独立消息定义，导出与审计统一排除重复聚合包，保留逐文件哈希校验。设置等 Rust 兼容接口保留。
- 附着成功不等于日常原版桌面已经切换；桌面当前运行状态与未完成验收见本文顶部。
- 不自动修改防火墙，不绕过设备安装确认。

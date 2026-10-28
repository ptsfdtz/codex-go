# AgentDeck

通过 Web/PWA 操作电脑上的 Codex。Host 执行任务、保存会话权威状态；云端保存账户和设备归属并转发加密连接，不保存聊天或媒体、不持有 OpenAI 凭据、不运行模型。手机统一使用浏览器或 PWA。

## 官方运行时三端共享候选（未发布）

本批候选强制只执行官方预编译 Codex：当前固定官方 `0.166.0-alpha.1`（官方 alpha 包，并非稳定版），覆盖 Windows x64、Linux x64/ARM64、macOS arm64。启动前核对官方包 SHA-512 和全部文件 SHA-256，执行 `--version` 前也核对入口哈希；版本号相同的自编译程序也不能通过。未知程序不执行，缺失时自动下载官方包，损坏的托管包拒绝启动；旧源码编译脚本已禁用。更新基线须更新官方包清单并重新验收，不编译 Codex。

首次启动自动生成回环地址和私有令牌，启动独立共享所有者；Host、`agentdeck codex` 和原版桌面代理复用该服务。Windows 安装器增加“Codex shared”开始菜单入口，`agentdeck desktop` 自动发现原版应用；macOS 桌面代理为待实机验证的候选。Linux 提供独立 runtime/Host systemd 用户服务，Host 保留现有隔离设置；不把 Linux 原版桌面列为已支持。原版桌面已经运行时要求空闲退出后重开，不强杀或迁移进行中的任务。已有手动管理的外部运行时保留配置，但不能仅靠版本号通过官方来源证明，迁移验收需单独处理。

普通用户只需安装、登录 AgentDeck、授权项目和启动；需要 Codex 认证时执行 `agentdeck codex-login`（无浏览器环境可加 `--device-auth`）。不要求 Rust、Node、Python，也不要求用户填写端口、地址或令牌。`agentdeck runtime-check` 提供真实沙箱/指令检查及官方来源、完整性信息；实际就绪以 `status --json` 的 `codexReady`、`sandboxVerified`、`sharedRuntime` 为 true、`runtimeError` 为 null 为准。状态中的 `officialRuntime` 记录包来源与入口哈希，发布门槛核对它与候选清单一致，拒绝自编译或改哈希的运行时。

本机验证：Linux x64 官方包的项目指令读取、内读写及外读写拒绝通过；两个独立认证连接共享同一 UUID、错误令牌拒绝、重复启动复用原生进程、真实模型文件写入和读回、断开后另一连接恢复会话通过。候选安装器已通过本机 HTTPS、隔离全新状态及无开发工具 PATH 的安装验证，首次自动下载、初始化、真实沙箱验证及 Host 重启保留原生 PID/身份/令牌通过；本机 HTTPS 安装不等于生产下载或云端转发验收。官方包损坏拒绝、同版本自定义程序不执行、三个并发启动复用同一所有者及普通 Linux 用户的真实指令/隔离与 Host 就绪检查通过；21 项 Rust 测试、严格 Clippy 和 13 项发布门槛测试通过。报告位于 `artifacts/official-runtime/`。Windows/macOS 用户自行实机验收，ARM64、生产云端、手机及系统重启仍未完成，本批不得晋升正式发布。历史“已发布”描述仅指之前版本。

本地全链路验收（Linux x64）：已启动隔离 PostgreSQL、真实云端、HTTPS Web、Host 与官方 CLI，禁用浏览器局域网连接后实走云端加密转发；CLI 新建 → Web 读取并续聊、Web 新建 → CLI 按同一 UUID 续聊及网页实时更新通过，实际文件结果一致，整个过程原生 PID 不变，Host 更换程序也保留同一运行时。CLI 必须使用 `agentdeck codex` 共享入口，普通独立启动的 `codex` 不会自动接入。补齐官方 `project/create` 登记与重试：CLI 首次打开项目、Host 本地授权待运行时就绪后登记、重复登记不增副本、撤销授权后不自动恢复均通过；原生目录的名称和顺序仍以 `project/list` 为准。共享会话恢复时容纳 CLI 返回的上一轮文件系统信息，新一轮显式发送已验证的 Host 权限配置，不沿用 CLI 的临时目录授权；续聊后真实模型执行的项目内读写及外部测试目录读写拒绝通过。完整结果与脱敏截图见 `artifacts/official-runtime/fullstack-linux.json` 及同目录截图；本地云端验收不代表生产部署或原版桌面验收。

本地私有 CA／自托管云端可在启动 Host 前设置 `AGENTDECK_CLOUD_CA_FILE` 为 PEM CA 路径；该显式配置同时限定云端 HTTPS 和 WSS 的信任根，仍校验证书与主机名，无效或空证书拒绝启动。正常公网安装无需此设置。

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

## 当前实现与交付

- Windows Codex 自动兼容（已发布）：启动前验证真实 AGENTS.md 读取、模型/原生项目协议及四项沙箱边界；现有版本缺少协议或存在 SystemRoot 缺陷时，自动安装固定的官方 `0.166.0-alpha.1` 兼容运行时，保留原程序与 Codex 状态目录。下载 SHA-512、45 个文件 SHA-256 核验及原子安装，不以关闭沙箱兜底；选择按原程序哈希记忆，已有共享任务不强制迁移。诊断命令 `agentdeck runtime-check [--codex-exe PATH]`，真实回归脚本 `scripts/codex/verify-runtime-compatibility.ps1`。官方 0.164 缺陷回退、0.159 协议缺口回退、正常新版保留、重开记忆、损坏资源拒绝、共享所有者与 Host 连接、隔离原生历史读回均通过；未调用模型，未重启日常 Host/桌面。

- 项目图片预览与设置恢复（已发布）：项目文件可直接渲染 PNG/JPEG/GIF/WebP/SVG/BMP/ICO/AVIF，8 MiB 上限、64 KiB 分块及 SHA-256 校验，切换或关闭即停止后续读取并释放图片；SVG 使用图片上下文，不嵌入可执行文档。新增显式 `files.readImage` 和 `projectImagePreview` 能力，沿用项目授权及句柄/内容变化核对，旧 Host 提示升级。通知开关及设置分类保存到当前浏览器，模型/输出默认值和缓存策略表单重新读取 Host 已保存值；关闭网页期间仍不接收通知。Web 类型/ESLint/格式/生产构建、Host 全目标严格 Clippy、真实 SVG/PNG 读取与多分块/校验/取消定向检查通过；真实 Host 图片与浏览器重开仍待验收；图片能力需升级 Host。
- 无项目对话完整访问（已发布）：普通聊天开放权限弹窗，沿用已确认的权限记忆和发送参数；Host 接受普通聊天的完整访问，切回工作区时仍逐轮重设审批与沙箱策略。项目技能及 Plan/Goal 限制保留。Web 类型/ESLint/格式/生产构建、Host 全目标严格 Clippy 通过；未发送真实任务，需升级 Host 后验收。
- Web 设备名称（已发布）：侧栏、电脑切换入口、更新提醒及删除确认统一优先使用已配置的显示名称；电脑清单主名称也使用别名，原始名称仅在清单中作为辅助信息显示。沿用按账户/浏览器设备及电脑保存的名称，空名称回退原名。类型、相关 ESLint、格式及生产构建通过；浏览器/真机交互仍待验收。
- 正式入口：[Web/PWA](https://agent.ptsfdtz.top/)、[管理端](https://agent.ptsfdtz.top/admin)；备用站点：[GitHub Pages](https://ptsfdtz.github.io/codex-go/)。
- 发布 `release-20261027-2`，Host 稳定版本 `host-b9817e05cbca6a3058efd4c698ffec0828fb1da3`：Windows x64、Linux x64、Linux ARM64 及 SHA-256/平台清单；Web 构建 `eeeb2b690f6a35bca9c65e6368e6965e61bd315e7c7e000da925e3f6427d3ebd`。管理页随云端二进制更新。
- Web 项目名称与顺序仅取自原生 `project/list`；会话跟随原生交互目录，完整同步隐藏失效索引，不删除本地历史或撤销授权。归档不在普通列表展示，可在归档视图跨项目读历史；已删除会话不显示。保留运行中任务、审批和未知结果保护。
- Host、CLI、原版桌面的本地 Codex 模式及 Web 可连接同一认证原生运行时，沿用 UUID 与权威历史，不复制或改写桌面私有数据库。Codex 最低可识别 `0.159.2`，接受兼容的新版本，Windows 功能不兼容时自动使用经验证的官方兼容运行时；优先复用现有程序，显式路径配置优先，私有副本仅作最后回退。最低版本准入不替代协议与沙箱检查。
- 安装版/开发版默认共用账户、电脑身份、证书、项目、附件和运行时配置；显式 `AGENTDECK_DATA_DIR` 才隔离。开发启动复用运行中 Host，空闲后显式 `--restart` 才切换程序。
- 附件统一存于 Host 附件库，SHA-256 去重并保留会话授权引用；历史项目附件继续按原路径读取。保留审批和只读访问边界，不开放整个状态目录。
- 云端支持设备登记删除、管理员账户删除和最后一个可用管理员保护；普通用户无账户删除入口。删除云端登记不删除电脑文件或 Codex 会话。

**日常三端最终切换尚未完成：当前打开的原版桌面仍连接原运行时，需空闲退出后通过本机 `Codex shared` 入口重开并复核。** 该入口使用原版桌面程序。本机共享原生程序为桌面基线加官方 SystemRoot 修复的诊断构建 `0.164.0-dev.agentdeck.6905ece`，保留沙箱，未作为官方 Codex 分发；不能宣称仅保留一个原生进程的目标已完成。

## 实际验证与下一步

Host 并发上限调整（本地通过，未部署）：普通发送、手动队列启动、编辑重发、启动信号量及能力声明统一使用 `server/service.rs` 的 `MAX_CONCURRENT_TASKS = 5`；队列启动在已有 5 个任务时拒绝新增。Rust 格式与全目标严格 Clippy 通过，未运行真实五任务并发；需更新 Host 后生效。原生队列自动续跑及外部 CLI/桌面任务仍未统一纳入本地并发计数。

排队续跑状态图标修复（Web 本地通过，未部署）：侧栏同时读取本地轮次与原生会话运行状态，原生队列自动继续时显示旋转图标；开始事件触发列表同步，活动筛选同步识别原生任务。`node --test scripts/web/test-session-working.mjs` 的 3 项回归、类型/ESLint/格式/生产构建及受控 Chromium 开始/结束/待排队/断线暂停检查通过，桌面与 390px 截图位于 `artifacts/queue/sidebar-native-running-*.png`；真实 Host 自动消费队列与手机真机未验收，仅需更新 Web。

文件预览导航精简（本地通过，未部署）：项目标题、文件标签与文件操作合并为单行，左侧多文件标签可横向滚动但不显示滚动条，键盘切换自动定位当前标签，右侧统一使用图标按钮并保留悬停提示与无障碍名称；查找并入该行，移除重复路径栏及底部大小上限/只读说明。图片与文本读取限制、错误及实际截断提示保留。类型、ESLint、构建、7 项工作区测试、引用回归及 Chromium 多标签/键盘/查找/目录切换/浅深主题/320px 与 390px 检查通过，受控接口截图位于 `artifacts/file-toolbar/`；手机真机未验证。仅需更新 Web。

文件结构化引用（本地验收通过，未部署）：文件工作区“引用”添加可移除的文件卡片，输入框正文不再插入 Markdown 路径；可单独发送文件引用，去重并限制 32 个。Host 按会话项目重新解析和校验文件，以官方 `text_elements` / `byteRange` 文件标记保存到原生输入及历史，模型仍可定位当前文件；这不是文件内容快照。队列、历史点击预览和编辑重发保留标记，跨项目、目录、越界路径及项目外符号链接被拒绝；旧 Host 显示升级提示，不退回纯路径。新增 `fileReferenceInputs` 能力，需同时更新 Web 与 Host，云端无需变更。真实文件/UTF-8 字节范围/授权/重发/schema 定向测试、Chromium 卡片/草稿/去重/仅引用发送/失败/旧 Host/390px、类型/ESLint/Host 严格 Clippy 和 Web 构建通过；官方预编译 Codex `0.166.0-alpha.1` 在独立只读项目真实模型读取引用文件并读回原生历史标记通过，报告及截图在 `artifacts/file-references/`。浏览器测试 `pnpm test:file-references-browser`（Vite 默认 `http://127.0.0.1:1492`，可用 `FILE_REFERENCE_TEST_ORIGIN` 指定）；云端到 Host 整链路与 Windows/macOS/手机真机待验收，原版客户端的卡片外观未验证。

历史图片预览修复（Web 本地验收，未部署）：消息中展开的历史附件/工具图片改为复用回复图片的页内预览，支持关闭、Escape 与焦点恢复，切换会话或断开连接清理预览和资源，不再打开新标签页。类型检查、定向 ESLint、生产构建和受控 Chromium 桌面/390px 的历史附件、无新标签、关闭/切换与资源释放回归通过；真实 Host 尚未验收，截图位于 `artifacts/message-images/history-preview-*.png`。

电脑名称云端保存（本地验收通过，未部署）：设置 → 电脑中的“电脑显示名称”使用“保存名称”写入云端，同一账户的浏览器/PWA 共享，目录每 15 秒刷新；设置后只显示自定义名，清空恢复原名。已有浏览器本地名称在首次连接新版云端时自动迁移，仅服务器从未配置名称时写入；服务器改名或明确清空优先，失败保留本地值重试，Host 重新登记不覆盖自定义名。云端增加兼容旧 Host 的可空名称及配置标记迁移、账户归属和 CSRF 校验。6 项名称/迁移测试、真实 PostgreSQL 持久化/并发/跨账户/撤销设备测试、HTTPS 云端与两个独立 Chromium 的保存/刷新/清空/失败重试、390px 布局通过；类型、ESLint、Web 构建和云端严格 Clippy 通过，报告与截图在 `artifacts/host-names/`。上线需同时更新 Web 和云端，Host 无需更新。

问题回答布局（Web 已部署）：提交/前后切换按钮与回答输入框并排，移除单独底部按钮行和空选项占位；桌面/320px/390px 对齐、空回答保护、多问题切换与提交失败保留内容检查通过，截图位于 `artifacts/questions/`。2026-10-28 已上线 Web `c464f5d5d6b147d6a07e52d47f479e71d9233a6c23b7c42d64ad1d4288f6519c`，公网 13 文件哈希/健康检查通过；仅更新 Web，回退备份 `/var/backups/agentdeck/web-c464f5d5d6b1-20261028T053050Z/`。

新对话模型/强度修复（Web 已部署）：调整默认模型的思维强度时同步保存具体模型编号，发送/编辑重发前解析旧的仅强度偏好，使用 Host 返回的模型协议编号；没有可解析模型时在创建对话前提示，不发送孤立强度。10 项偏好/隔离/旧值修复测试与浏览器默认模型滑块、切换模型后首次发送参数检查通过，真实 Host 模型调用未执行。2026-10-28 已上线 Web `abf159eae08518c3f38f89b7c94d9aa972fc4af500ad7a806053f82e7132d75a`，公网 13 文件哈希/健康检查通过，Host 和云端程序未更新；备份 `/var/backups/agentdeck/web-abf159eae085-20261028T052107Z/`。

输入框右侧操作区（Web 已部署）：权限移除告警描边、完整访问保留暖色盾牌，停止改为圆形主按钮，排队使用轻描边与淡色禁用态；浅深主题、320px 布局、权限菜单、停止/排队回归、Web 检查/构建通过，截图位于 `artifacts/composer/actions-*.png`。2026-10-28 已上线 Web `13e784e92fe0decd1792a3bd360d6285de48e80c346051aa381ca76247a919a7`，公网 13 文件哈希/健康检查通过，云端进程未变；回退备份 `/var/backups/agentdeck/web-13e784e92fe0-20261028T051545Z/`。

2026-10-28 回复图片修复已上线：Web `714d67beea9b4380e3939891bac8fb9a6f61f987e6607e0c62521ce18c015e1d`，公网 13 文件哈希、健康检查及版本清单 no-store 通过；云端 PID/启动时间未变，仅更新 Web。候选与源码快照位于 `artifacts/web-candidate/714d67beea9b/`，服务器回退备份 `/var/backups/agentdeck/web-714d67beea9b-20261028T051318Z/`。

回复图片显示（Web 已部署）：Markdown 项目内图片通过已有 `files.readImage` 授权接口分块读取，进入可视区域后自动展示，支持点击放大与失败重试，沿用 8 MiB/哈希校验及路径边界；切换电脑/项目/消息取消旧读取并释放图片资源。外部 HTTP(S) 图片保留明确链接，不自动发起远程请求；项目图片展示当前文件，原生历史附件仍沿用 `sessions.image`。浏览器受控响应验证内联显示、分块/校验、放大、390px、重试、非法路径、取消与资源释放通过；真实 Host 端到端尚未验收，截图位于 `artifacts/message-images/`。

消息编辑框精简版已上线（2026-10-28）：移除顶部标题/快捷键和底部说明，仅保留内容、取消与保存并发送。Web 版本 `d891a5dfb6377447811ebe8ca36c47b4f27e3c9969a6404be908c58a59cb69c6`；检查/构建、浏览器编辑交互、公网 13 文件哈希和健康检查通过。仅更新 Web，云端进程未变；回退备份 `/var/backups/agentdeck/web-d891a5dfb637-20261028T050316Z/`。

2026-10-28 Web 增量更新已上线：版本 `395cdc14d2b938908ae68b3051f288fe10ec77103bb80bde59e9901f9f7bf645`，包含输入框、消息编辑框及设置电脑页优化。产物绑定基线 `99d4112` 与当前未提交工作区，源差异、文件 SHA-256 和产物清单位于 `artifacts/web-candidate/395cdc14d2b9/`；公网 13 个文件哈希、健康检查和版本清单 no-store 通过，云端 PID/启动时间及发布指针未变。仅更新 Web，沿用用户本次 Web 的跨平台验收豁免；旧版与回退脚本位于服务器 `/var/backups/agentdeck/web-395cdc14d2b9-20261028T031418Z/`。

已发送消息编辑框（Web 已部署）：统一圆角、单层焦点边框、自适应高度与按钮样式；移除顶部标题、快捷键小字与底部说明，仅保留内容和操作按钮，保留重发回退语义、原附件/技能及取消/快捷键。Web 检查/构建和 Chromium 浅深主题、320px/390px、空内容、输入法、忙碌保护和失败内容保留检查通过；截图位于 `artifacts/composer/message-editor-*.png`，真实 Host 重发未执行。

输入框优化（Web 已部署）：单行自适应高度、紧凑模型/权限底栏、独立资源行、原生键盘菜单、图片缩略图/预览、文件拖拽与内联错误；压缩期间可输入，切换对话丢弃旧结果并释放预览资源，运行中默认排队且独立停止，不支持的队列资源提前提示。手机触屏回车换行，桌面 Enter 发送，保留原发送回执、草稿与对话模型记忆。Web 检查/生产构建、13 项已有定向测试、Chromium 组件交互与 14 项附件边界检查通过；截图位于 `artifacts/composer/`。浏览器发送/停止使用受控回调，软键盘使用视口模拟；真实 Host 端到端和手机真机尚未验收。

设置电脑页（Web 已部署）：常规设置移除重复的设备列表，电脑页直接展示电脑列表、在线状态、切换/重连、删除、连接详情与本机显示名称；侧栏和顶部切换电脑入口统一打开设置电脑页，切换电脑与同步会话时保持设置打开。Web 检查/生产构建及 Chromium 受控目录响应下的入口、分类切换、390px 布局、切换后保持设置检查通过；未连接真实 Host，截图位于 `artifacts/settings-computers/`。

上一批改动已按附件、对话模型记忆、Host Git 比较、文件工作区及侧栏状态拆分提交。2026-10-28 本地 Web 类型/ESLint/生产构建、13 项 Web 定向测试、4 项真实 Git 测试及 Host 全目标严格 Clippy 通过；用户明确豁免本次尚未完成的跨平台验收，仅部署 Web。2026-10-28 已将提交 `7bed42b2` 的同一份候选产物上线至 https://agent.ptsfdtz.top ，Web 版本 `ef34283a007145754621be83eb33822cd2101e5d4e31f2697b655e7571d71f93`；公网 13 个文件 SHA-256、健康检查及版本清单 no-store 核对通过；Chromium 公网登录页返回 200、无页面脚本异常，截图位于 `artifacts/web-candidate/7bed42b2/production-login.png`。云端进程与发布指针未变。旧 Web 与回退脚本保存在服务器 `/var/backups/agentdeck/web-7bed42b2-20261028T014053Z/`，保留旧哈希资源供已打开页面继续加载。Host、云端程序、管理端和下载指针未更新；Windows/Linux/macOS 经真实云端及模型的完整验收仍未完成。

Web 项目文件工作区（Web 已部署）：右侧展开文件预览，左侧保留对话及输入框；目录树按需读取，多文件标签按账户/电脑/项目隔离并在当前浏览器标签页恢复，支持面包屑、文件内查找、引用、图片预览与工作区变更查看。桌面可拖动分栏，手机可收起目录并返回对话。代码预览提供行号及常见语言高亮，长文件仅渲染可见行；筛选作用于已加载目录，也可输入完整项目相对路径直接打开。保留文本 256 KiB、图片 8 MiB、项目授权及图片校验/取消边界，不增加文件写入或任意 RPC；同时修复 Git 在 Linux/macOS 上的程序名与空配置路径。Web 检查/格式/生产构建、7 项工作区定向测试、真实 Git 工作区定向测试及 Host 全目标严格 Clippy 通过；隔离的 Host Core 文件接口适配器与 Chromium 完成 16 项实际文件/图片分块/差异/两万行/竞态/键盘/390px 布局验收。Web 已部署；云端转发下真实会话与文件并排操作、手机真机及 Windows/macOS 本轮实测待验收；Linux/macOS Git 修复需更新 Host。源码在 `web/src/features/files/`，布局验收截图在 `artifacts/file-workspace/`。

分支比较（Web 已部署，需更新 Host 才可使用）：文件面板顶部点击“比较分支”，选择基准、目标和比较方式，支持两端内容差异及目标分支从共同祖先以来的改动。Host 新增 `git.branches`、`git.compare`、`git.compareDiff` 和 `gitBranchCompare` 能力，沿用项目/Git 根授权；只读取本地及远程跟踪分支，不自动 fetch、不包含未提交改动。列表最多 1,000 项、单文件差异最多 128 KiB，点击文件才读取，缓存最多 8 个差异；提交哈希固定比较快照，二进制/链接仅展示变更信息，重命名按删除/新增展示。3 项真实 Git/大小上限/协议定向测试、Web 检查与生产构建、Host 严格 Clippy 及 Chromium 按需加载/缓存/过期响应/重试/旧 Host 提示/390px 布局检查通过；浏览器使用受控接口响应，云端转发下真实 Host 端到端与手机真机尚未验收。界面沿用灰白/深色主题、圆角与细线图标，分支条件紧凑排列，支持交换、文件筛选和前后切换；手机选中文件后切至差异，可返回完整列表，说明按需展开。Web 检查/生产构建及 Chromium 浅深主题、320px/390px 布局、键盘焦点、筛选/切换/缓存/竞态/重试检查通过；截图使用受控响应，位于 `artifacts/branch-comparison/`。

Web 侧栏工作状态（Web 已部署）：运行中会话标题右侧显示低对比度细线旋转圆环，无常驻文字；随 Host 会话状态结束移除，断线暂停，遵循系统减少动态效果偏好，长标题省略并保留置顶图标。类型、定向 ESLint、Sidebar 格式及 Chromium 状态切换/后台会话/断线/减少动态效果/390px 窄屏检查通过；浏览器使用受控会话数据，真实 Host 事件链路与手机真机待验收。

Web 右上角项目概览（Web 已部署）：项目内点击概览按钮展开圆角卡片，显示原生项目名称、真实 Git 工作区变更文件数、前三个变更文件及当前电脑；可跳转文件浏览与全部改动。按展开、手动刷新及任务开始/结束读取，切换项目/电脑隔离旧响应；保留空工作区、非 Git、能力缺失及错误重试状态，不展示无接口依据的增删行数。类型、定向 ESLint、新组件格式、生产构建及 Chromium 交互/390px 窄屏检查通过；浏览器检查使用受控接口响应，真实 Host 端到端及手机真机仍待验收。

Web 对话模型独立记忆（Web 已部署）：模型与思维强度按账户、电脑、对话分别保存，切换对话或刷新页面恢复各自选择；未保存选择的已有对话读取 Host 返回的会话模型，新对话使用电脑默认模型，首次发送时保留草稿选择。停止将旧的电脑级模型选择套用到所有对话；权限记忆仍沿用电脑级设置。6 项独立记忆/隔离/存储异常测试、类型、定向 ESLint、格式与生产构建通过，真实会话切换及模型发送仍待端到端验收。

Web 图片粘贴与自动压缩（Web 已部署）：截图或复制图片后，在消息框按 Ctrl+V / ⌘V 添加附件，再发送；普通文字粘贴保留。最多 4 个附件，改为单文件最大 512 KiB（合计最多 2 MiB），Web 与 Host 同步校验并扩大请求消息容量；旧 Host 仍按其总量上限检查并提示升级。超限 PNG/JPEG/WebP/BMP 静态图片自动调整画质和尺寸，显示压缩状态与结果大小，保留透明背景；GIF、APNG、动态 WebP 及普通文件超限时明确提示，不改变动画或文件格式。类型、定向 ESLint、格式、生产构建、Host 全目标严格 Clippy、3 项 Host 边界测试与 Chromium 14 项图片/附件/消息编码检查通过（实际 PNG 6,029,413 字节压缩至 WebP 500,734 字节）；系统剪贴板及真实 Host 收图端到端仍待验收；Web 已部署，扩大的 Host 附件容量仍需更新 Host。

`0.4.0` 首轮候选（`8e7552a`）三平台及云端构建、候选下载暂存通过，尚未正式发布。Windows 真实网页更新完成下载、任务阻塞/取消、空闲切换及同身份重连，但真实工具执行发现共享运行时未过滤应用附带的 PowerShell 路径；已补齐与 managed 启动一致的 PATH 处理，该候选不予晋升，修复后须重新构建和验收。Linux x64、原生 ARM64 隔离环境的项目内读写/外部拒绝及真实模型基线通过，不能代替新候选实测。临时 ARM64 测试机由 `Native ARM64 release test machine` workflow 提供，通过专用密钥及 VPS 回环端口访问；它不自动生成通过记录，运行结束后须清理临时凭据和测试账户。

更新与发布自动化（未发布）：网页原生更新、持久状态/空闲切换、本地候选通道、候选构建与正式晋升门槛已实现。Windows Host 严格 Clippy、4 项更新定向测试，Web 类型/ESLint/生产构建、workflow actionlint、shell 语法及 schema 核验通过；发布门槛 10 项定向测试在 Windows 与隔离 Linux 临时目录通过，未改线上服务。尚未执行 Linux Host 本次编译、真实更新切换、浏览器交互、各平台真实端到端验收和 Actions/VPS 全流程；部署凭据与环境保护仍须配置。本轮检查不能代替正式发布前的强制实测。

Linux `10.249.254.57` 的 Host/认证运行时已切至 root，保留账户、电脑与 Web 设备身份，使用 `/root/.codex` 和 `/root/.local/state/agentdeck`；旧账号服务停用，root 服务启用常驻。原生接口登记现有 `/root/workspace` 及既有对话；主程序和同版本 `codex-code-mode-host`、`codex-linux-sandbox` 配套放在 `/usr/bin`，修正 `/usr/local/bin` 入口。Host 普通轮次改用已有协议的命名 `agentdeck` 权限，逐轮重设 cwd/工作区根，修复 legacy `workspaceWrite` 覆盖丢失系统读取范围、导致 bwrap 无法启动工具的问题；完整访问后再切回也恢复隔离。

该服务器运行本机修复版 `local-root-policy-repair-20261027`（基于 `b9817e05`，仅含执行权限修复；服务 SHA-256 `aa3adc581d2096b281fa5c24b44acb2d85af66d666064f0845a817d9023e1f6c`），未晋升正式发布或修改公开下载。Codex `0.164.0` / `gpt-6.1-sol` 在共享运行时、隔离候选 Host 和实际 Host 的真实终端链路均完成“普通→完整访问→普通”三轮：内读写/外读写拒绝、root 身份、真实磁盘读取、权限恢复通过；实际 Host 空闲重启后原授权、电脑及原生会话 UUID 保持，读回 12 条历史。Windows 全目标检查/严格 Clippy、Linux 构建/严格 Clippy、格式及 schema 核验通过。备份、候选证据和实际 Host 报告在 `/root/agentdeck-migration-20261027T093113Z/`，测试自建会话已归档、测试授权已撤销。未做整机重启、手机原会话及云端转发链路复测；Windows 本次未发送真实模型任务。

Web 顶部下拉框用于切换项目并标记当前项目；未选对话时显示所选项目名，选中对话后显示对话标题。类型、定向 ESLint、格式及生产构建通过；浏览器/手机交互待验收，Web 已部署。

Linux x64 干净环境已安装当前稳定 Host 与官方 Codex `0.164.0`，沿用本机 API 配置；实际模型回复、沙箱内读写及外部读写拒绝均通过。Host 与认证运行时的 systemd 用户服务已启用，重启服务后账户、设备身份与在线状态保持。旧环境隔离到 root 私有回退目录，未载入新环境；未做整机重启及 ARM64 实机验收。

本次 Host 热修复：Windows 正式 ZIP 在本机构建并完成真实回归，Linux x64/ARM64 的严格 Clippy 与 CI 打包通过；停止重复 Windows CI 构建，以已验收的同提交产物发布。三个平台清单、包内版本、稳定指针及公开文件完整 SHA-256、GitHub 资产摘要一致；Linux 线上安装及 CLI 运行通过。只原子更新下载，云端 PID/启动时间保持不变，Web/管理端健康与文件校验正常；下载指针和脚本回退备份在 `/var/backups/agentdeck/downloads-release-20261027-2/`。已有用户在任务空闲后升级 Host，运行中的任务不会被此次发布切换。

Web 提问与审批移到输入框上方独立区域，待回答问题不再嵌入消息历史，全部提交后平滑收起，保留回执与结果未知核对；区域随手机可用高度限制并可滚动。修复“回到最新”按钮被宽度覆盖成椭圆，固定为 36×36 圆形。版本 `2d21a6fe` 已发布；类型、定向 ESLint、格式、生产构建及线上 12 个文件哈希、健康检查通过。真实会话 390×844 浏览器视口验证问题位置、无横向溢出、按钮宽高及点击恢复底部通过，未提交真实回答；iPhone 软键盘与触摸仍待真机复核。备份：`/var/backups/agentdeck/web-question-dock-2d21a6fe/web.tar.gz`。

本次类型/ESLint、格式、生产构建、依赖审计、Host/云端严格 Clippy、图片读取/分块/完整性/取消定向检查与 schema 核验通过。锁文件缺少 lucide-react 解析记录的问题已修复，并在全新目录完成冻结安装、检查和构建。历史测试/夹具及依赖按此前要求删除，不再沿用旧测试数量作为当前证据。

macOS 本地 Host 启动、launchd 登录自启、seatbelt 与指令边界检查、Codex 初始化和项目发现通过；macOS arm64 源码包构建及 `install.sh` 本地 HTTPS 安装、`shasum` SHA-256 校验通过。CI 已加入 macOS arm64 构建和发布清单；macOS Intel 暂不发布，macOS 包未签名/公证，线上安装、升级及真实模型任务仍待验收。

上轮 Web/云端线上验收：三个平台 CI、GitHub 发布、云端构建与 Pages 发布全部通过；正式 Web 12 个文件、管理端三个静态文件及 Pages 13 个文件与对应产物哈希一致。存活/数据库就绪均为 200，未认证管理请求和无来源删除请求分别为 401/403；云端运行二进制哈希与 CI 一致。稳定指针、三个平台清单/包内版本、所有公开下载文件完整 SHA-256 核对通过；Linux x64 在独立目录完成线上安装与 CLI 运行，未启动模型任务或重启日常 Host/桌面。

真实验收覆盖隔离原版桌面的手动发送、新建及一次性审批，交互 CLI/Web 同 UUID 历史读回；日常 Host 的实际模型回复、沙箱读取、CLI 续聊及重启保持原生进程通过。日常原生目录与 Edge/实际 Sidebar 的项目、归档/历史/恢复及自建验收对话删除核对通过；自建发送验收对话已归档，未修改用户会话。

待验收：日常桌面最终共享切换、桌面专有应用工具、手机真机/PWA 键盘及安全区、实际注销再登录自启、Linux 真实模型隔离、macOS 真实模型任务及线上安装/升级、ARM64 实机、长期休眠切网、大历史压力与生产账户删除事务。编译、下载和健康检查不能代替这些验收。

上轮云端发布先备份数据库与私有配置，数据库备份为 `/var/backups/agentdeck/agentdeck-20261027T060028Z.dump`；发布回退信息与下载指针/脚本备份在 `/var/backups/agentdeck/release-20261027-1/`，旧 Web/云端目录保留。当前目录为 `/opt/agentdeck/releases/release-20261027-1`，回退按 `previous-current.txt` 恢复链接、重启云端并单独恢复下载指针；不回滚数据库。

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

## 下载发布与 VPS

### 正式发布流程与强制验收

**每次正式发布前，必须在 Windows、Linux 和 macOS 上使用本次候选产物完成真实端到端测试，全部通过后才能发布。** 适用于 Host、Web/PWA、云端的正式更新及热修复；仅修改其中一个组件也须验证各平台完整链路。构建、Clippy、接口健康、下载校验、CLI 启动、模拟数据及历史版本测试均不能代替本次验收。任一平台失败、未测或环境不可用时，只能保留候选版，不得发布正式版、更新生产 Web/云端或推进稳定下载指针。

1. **准备候选版**：固定源码提交、版本及更新说明，完成必要静态检查和构建；绑定 Windows/Linux/macOS 包、Web、云端的版本与 SHA-256，未变组件记录其实际版本。候选产物独立存放，不更新生产入口或稳定指针。
2. **各平台真实验收**：分别在真实 Windows、Linux、macOS 环境安装候选 Host，通过候选 Web/PWA、真实云端连接及真实 Codex/模型完成下表。发布包覆盖的架构分别记录结果，Linux x64 通过不等于 ARM64 通过，macOS arm64 也须单独实测；缺少某架构实测时不得将其列为本次已验收正式更新。
3. **记录结论**：在本 README 的“实际验证与下一步”简短记录候选版本/提交、产物哈希、系统与架构、Codex 版本、实际测试结果及未验证项，不记录凭据。既有“已发布”与历史验证描述不构成本次发布准入。
4. **发布已验收产物**：取得当次发布授权后，备份并部署同一批产物，不重新构建替换；产物变化必须重新验收。核对线上版本、文件校验和健康状态后再开放稳定更新；失败停止后续步骤，按组件恢复旧程序、静态资源或下载指针，数据库迁移单独判断，不自动回滚数据库。

| 各平台必测链路   | 通过标准                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| 安装与升级       | 实际安装候选包，并从当前稳定版升级；身份、账户、项目授权和历史保留，实际运行版本正确                   |
| Web/PWA 远程连接 | 通过实际云端转发连接对应 Host，确认所选电脑与身份一致、Codex 就绪；候选环境不替换日常生产服务          |
| 会话与真实任务   | 读取已有会话历史，新建会话并发送真实模型任务，接收流式结果及完成状态，重开后通过原生接口读回同一会话   |
| 项目与权限       | 实际读取项目指令、在授权项目读写文件，验证一次性审批和拒绝、沙箱外未授权读写被阻止，不关闭沙箱兜底     |
| 重启与恢复       | 空闲重启后自动重连、身份与历史保持；实际断线重连后核对任务结果，不丢审批、不重复发送未知结果任务       |
| 本次改动         | 在各平台真实链路中验证变更功能及相关旧客户端兼容；涉及更新时验证下载安装、空闲切换、就绪判定与失败恢复 |

发布自动化（已实现，未在线运行）：推送代码只运行检查，不再自动发布或部署 Pages。在 GitHub Actions 的 **Prepare candidate** 选择 `release` 分支，填写公开版本号 `X.Y.Z` 和更新说明；构建 Windows/Linux/macOS Host、正式 Web、Pages 与云端，生成绑定提交及全部文件 SHA-256 的 `candidate.json`，保存为 `candidate-X.Y.Z` 预发布。随后只上传不可变候选下载文件，不切换生产 Web、云端或稳定指针，供实测机验证真正的下载安装。正式流程 **Promote tested release** 仅下载这批产物，强制验证 Windows x64、Linux x64/ARM64、macOS arm64 的实测记录，备份并部署 VPS、核对健康和公开文件、部署 Pages，最后开放稳定更新并生成 `vX.Y.Z` 正式 Release。构建、证据验证、VPS、Pages 任一步失败都不进入后续步骤；VPS/Pages 跨服务并非原子事务，部署部分成功时需核对 Actions 及备份后重试，不能宣称全部发布完成。下载发布脚本本身也强制验收门槛，缺少证据不得手动推进稳定指针；正式晋升拒绝用较低版本覆盖现有稳定版。

候选版下载并解包后，用 Python ≥3.11 生成实测记录模板；模板所有检查默认为未通过，不生成模拟通过记录：

```sh
gh release download candidate-X.Y.Z --pattern candidate.tar.gz --pattern candidate.tar.gz.sha256
# 先按 .sha256 核对归档，再解包到独立候选目录
python scripts/release/extract.py candidate.tar.gz artifacts/candidate
python scripts/release/gate.py template artifacts/candidate --evidence artifacts/evidence
```

原生更新测试在隔离实测机本地执行 `agentdeck update-channel candidate X.Y.Z`，网页刷新更新检查后即可下载安装已暂存的候选版本；测试完用 `agentdeck update-channel stable` 恢复稳定通道。选择保存在该机状态目录，网页不能切换通道或下载源，已开始的更新始终固定到已确认版本。首次引入原生更新能力时，可使用两个实际构建的候选版本验证升级前后链路，同时核对稳定版安装升级；不得改写 `release.txt` 假装升级，也不得提前切换生产稳定指针。

分别在对应 Windows/Linux/macOS 实测机安装候选包并从当前稳定版升级，使用候选 Web、真实云端、Codex 和模型完成上表；填写该平台 JSON 中的 `tester`、真实 `sessionId`、每项 `passed` 与 `observed`，在 `logs` 中列出已脱敏证据文件相对路径（值先留空）。在该机用候选版 CLI 执行 `record`，自动读取真实 Host 状态，核对实际系统/架构、运行版本、云端/Codex 就绪及沙箱验证，记录电脑身份、Codex 版本、时间并计算证据哈希；它不代替真实模型、审批、重连及变更功能测试，也不自动把检查改为通过。

```sh
# 每台实测机只录入自身平台；其余平台分别用 linux-x64、linux-arm64、macos-arm64
python scripts/release/gate.py record artifacts/candidate --evidence artifacts/evidence --platform windows-x64 --agentdeck "C:/Users/NAME/AppData/Local/Programs/AgentDeck/versions/X.Y.Z/agentdeck.exe"
# 汇总各平台 JSON 和各自的脱敏证据文件后执行
python scripts/release/gate.py verify artifacts/candidate --evidence artifacts/evidence
tar -czf e2e-evidence.tar.gz -C artifacts/evidence .
gh release upload candidate-X.Y.Z e2e-evidence.tar.gz
```

证据文件不得包含令牌、密码、未脱敏日志或完整聊天；不可用历史测试或改模板冒充实测。全部通过且取得当次发布授权后，才在 Actions 运行 **Promote tested release** 并填写同一版本。候选归档或清单变化会使原证据失效；缺少 ARM64 实测时本流程也会阻止正式晋升。CLI `--version` 同时显示安装发布版本和内核版本，提交哈希保留用于产物诊断。

首次启用自动部署需配置 GitHub `candidate` 与 `production` environments 的分支规则，并为 `production` 设置发布审核；设置变量 `AGENTDECK_CLOUD_ORIGIN`、`AGENTDECK_DEPLOY_HOST`（SSH 目标），以及 secrets `AGENTDECK_DEPLOY_KEY`、`AGENTDECK_DEPLOY_KNOWN_HOSTS`（固定服务器指纹，不临时信任扫描结果）。VPS 需 Python ≥3.11、curl、tar、sha256sum、flock，现有 Nginx/systemd 与可成功执行的 `agentdeck-backup.service`；部署用户须具备既有发布目录及服务管理权限。在受保护的 `/etc/agentdeck/release.env` 设置 `AGENTDECK_WEB_LINK` 为现有 Nginx 文档根目录的绝对符号链接，云端链接默认 `/opt/agentdeck/current`，下载目录默认 `/opt/agentdeck/downloads`，公网域名默认 `https://agent.ptsfdtz.top`；脚本拒绝猜测或覆盖普通目录。只有已确认数据库向后兼容时才设置 `AGENTDECK_ROLLBACK_SAFE_VERSION=X.Y.Z`（仅授权该版本的程序回退）；默认失败只恢复静态资源、保留数据库和诊断，不擅自回退云端程序。配置与真实候选验收完成前不能上线本次自动化。

正式 Web：[agent.ptsfdtz.top](https://agent.ptsfdtz.top/)，管理端 [/admin](https://agent.ptsfdtz.top/admin)。生产使用现有 Nginx、Rust/systemd 和 PostgreSQL 17，Cloudflare 仅做 DNS。云端账户 schema v3 支持电脑证书/地址登记、会话绑定的短期凭据、撤销和刷新轮换；VPS 继续只转发加密业务字节。

`pnpm host:package` 在当前平台构建发布包，输出到 `artifacts/host-downloads/`：

```text
install.sh / install.ps1 / install-codex.ps1
releases/stable.txt
releases/版本号/agentdeck-windows-x64.zip[.sha256]
releases/版本号/agentdeck-linux-x64.tar.gz[.sha256]
releases/版本号/agentdeck-linux-arm64.tar.gz[.sha256]
releases/版本号/agentdeck-macos-arm64.tar.gz[.sha256]
```

使用 `AGENTDECK_RELEASE_VERSION` 指定不可变发布目录。CI 构建 Windows x64、Linux x64/ARM64 和 macOS arm64；单独运行打包命令仅生成 Host 包，不满足正式发布准入。完整候选版须包含 Web、云端、安装脚本、版本清单及实测证据；正式流程输出的 `agentdeck-downloads.tar.gz` 包含这些文件，供已通过门槛的部署使用。Linux ARM64 基于 Ubuntu 24.04，x64 基于 Ubuntu 22.04，macOS arm64 使用 GitHub macOS 15 runner；macOS 包未签名/公证。旧独立 Linux workflow 和桌面安装器发布路径已移除。

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

开发 Host 需要 Rust MSVC ≥1.88、Visual Studio C++ 和 Windows SDK，或 Linux/macOS Rust 与原生编译工具；Web/发布脚本需要 Node 22.22.3、pnpm 12.3.4。不再检查 WebView2。

```powershell
pnpm install --frozen-lockfile
pnpm host:build
pnpm host:dev          # 编译并显示状态；不启动图形窗口
pnpm start             # 编译后启动或复用现有 Host
pnpm host:dev -- --restart # 任务空闲时，显式切换到新编译程序；共用原状态
pnpm host:package
pnpm check
pnpm test:composer-preferences # 对话模型与思维强度独立保存的定向测试
pnpm test:file-workspace # 文件标签、路径边界、差异行号与语法高亮
cargo test --locked --manifest-path desktop/core/Cargo.toml branch_comparison # 分支比较、大小上限与协议
cargo test --locked --manifest-path desktop/core/Cargo.toml --lib file_workspace_tests # 需要 Git 在 PATH 中
cargo clippy --locked --manifest-path desktop/core/Cargo.toml --all-targets -- -D warnings
pnpm schema:verify
pnpm web:dev
pnpm --filter @agentdeck/web build
```

电脑名称回归：`pnpm test:host-names`。真实 PostgreSQL 测试使用独立、可丢弃且数据库名以 `_test` 结尾的数据库：

```sh
AGENTDECK_TEST_DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/agentdeck_names_test cargo test --locked --manifest-path server/Cargo.toml --test host_names -- --ignored
```

输入框浏览器检查：先运行 `pnpm web:dev`，另在临时目录安装 Playwright 与 Chromium（不加入生产依赖），再运行：

```bash
npm install --prefix /tmp/agentdeck-browser playwright@1.58.2
node /tmp/agentdeck-browser/node_modules/playwright/cli.js install chromium
PLAYWRIGHT_MODULE=/tmp/agentdeck-browser/node_modules/playwright/index.mjs pnpm test:composer-browser
```

同一开发环境可运行 `pnpm test:message-images-browser` 检查回复图片。脚本隔离渲染真实组件并阻断 API，请求不发送到真实 Host；默认访问 `http://127.0.0.1:1430`，可用 `COMPOSER_TEST_ORIGIN` 指定其他本地 Vite 开发地址。截图输出到 `artifacts/composer/`，中文字体使用系统字体或通过 `COMPOSER_TEST_FONT` 指定本机字体文件。

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

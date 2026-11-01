# 功能状态与验证

[开发入口](../AGENTS.md) · [发布流程](deployment.md) · [运行时验收](runtime.md)

截至 2026-11-01。此处维护当前结论；早期部署和逐轮测试流水查阅 Git 历史。源码已实现、Web 已部署、Host 已安装与真实端到端验收分别记录，不能相互替代。

## 当前交付

| 组件          | 当前记录                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正式版本      | [AgentDeck 0.4.2](https://github.com/ptsfdtz/codex-go/releases/tag/v0.4.2)，2026-10-30 发布，稳定指针为 0.4.2，core 仍为 0.3.0                                                        |
| 源码与合并    | 产品源码 `c96f94d83b18b7e64cf2348ca35cf480cb5de45f`，PR #6 合并至 main `2291613`；发布入口 PR #7 合并至 main `d1881d5`                                                                |
| Web/PWA       | 生产 Web 更新为 `8d968410f2365f9f11d324be7083f66721fa90f36d2e0fddfee143672a739f07`；备用 Pages 保留 0.4.2 发布构建 `b4e73660ec3fc6af777797867b6eda16a823fa73cd2ffce8c1dabe44fea1572a` |
| 生产程序目录  | 云端 `/opt/agentdeck/current` 仍为 `/opt/agentdeck/releases/0.4.2`；Web `/opt/agentdeck/web-current` 指向 `/opt/agentdeck/releases/web-8d968410f236-20261101T074733Z/web`             |
| Host 稳定下载 | Windows x64、Linux x64/ARM64、macOS arm64 四个平台包均已发布，哈希与原始候选一致；用户电脑需更新并在空闲后重启                                                                        |
| 官方运行时    | 固定官方 `0.166.0-alpha.1`，自动下载、完整性核验与共享入口随 0.4.2 发布；Linux 原生桌面共享仍未支持                                                                                   |
| 发布结果      | [工作流 41075932370](https://github.com/ptsfdtz/codex-go/actions/runs/41075932370) 的 VPS、Pages、稳定指针和 GitHub Release 均成功                                                    |
| 回退证据      | `/var/backups/agentdeck/publish-0.4.2-20261030T145603Z` 保存旧链接、受保护配置和稳定下载入口；原链接目标均在 `web-d045d07-20261029` 下                                                |

0.4.2 正式发布当批按用户单次授权豁免完整跨平台端到端验收，范围见下文；不将构建与资源校验记为真实任务测试。部署前备份服务成功，生产存活/就绪、全部本批 Web/下载文件哈希与三个公开安装脚本校验通过，Pages 全部 23 个文件与候选一致；GitHub 四个平台附件摘要与原候选一致，latest 为 v0.4.2。证据位于 `artifacts/release-0.4.2/published-verification.json`、`github-published.json` 及发布工作流。

0.4.2 整包回退时先核对正在执行的任务和数据库兼容性，再按备份中的 `previous-cloud.txt`、`previous-web.txt` 恢复对应程序/静态链接及下载入口；不得直接回滚数据库或更换加密主密钥。旧程序和备份仍保留。此前 Web/AgentChat 的定向验证仅作为历史范围证据，不代替本批验收。

2026-10-31 Web 修复已部署：电脑更新完成提示新增关闭按钮；关闭已完成的更新详情也会确认并收起提示。浏览器按 Host 和更新任务记住关闭状态，刷新/重连后保持；新任务、新版本、未就绪、失败和状态读取错误仍显示，不清除 Host 的任务记录。Web 类型、定向 ESLint、生产构建和 390px 手机视口的受控 Chromium 检查通过，覆盖轮询、重新挂载、不同电脑/任务、详情关闭及存储不可用；证据位于 `artifacts/host-update-dismissal/verification.json`。

用户在看到本批检查结果后明确指示“更新web端”，本次按该指示仅更新生产网页，不沿用 0.4.2 的单次豁免，也未声称通过新的全平台真实验收。源码快照基于 `622f3928da59b3bd3794a44d9ea25fd1daf7a109` 加未提交的 Web 修复，差异 SHA-256 `afb5cdd66906dad6ab3dca92bab3cf67bd0021ba637cede109c1ebd0cd52fbf8`；部署归档 SHA-256 `0748c6acc1c387b17d18e3f4cba5a1aa96695ee0ebe8498486643523465b4011`。切换为 Nginx 独立 Web 根目录 `/opt/agentdeck/web-current`，保留 10 个旧资源供已打开页面使用；22 个本批公开文件哈希、首页、版本 no-store 和存活/就绪均通过；公开站点在 Chromium 中加载登录页正常且无页面错误，云端 PID/启动时间及稳定下载指针不变。首轮校验在平滑重载后仍读取到旧版本，已自动恢复旧网页与配置；增加版本收敛等待后重试成功。

本次 Web 回退：`python3 /var/backups/agentdeck/web-50395d621759-20261031T084503Z/rollback.py`（先核对没有后续部署）。备份目录 `/var/backups/agentdeck/web-50395d621759-20261031T084503Z` 保存旧网页、Nginx 配置、旧入口和部署记录；源码快照、产物清单及线上校验证据在 `artifacts/host-update-dismissal/`。生产 Web 与备用 Pages 当前版本不同；未做真实手机或 Host 更新验收。

2026-11-01 服务器存储清理：按用户授权删除已完成部署的临时上传/解包目录、无运行与回退引用的 `agentchat-e574a8c6a204` 旧目录，并执行 `apt-get clean`。根盘使用量由 3,935,494,144 降至 3,499,855,872 字节，释放约 415 MiB，可用约 5.95 GiB。当前生产版本、云端进程和稳定下载指针未变，存活/就绪与公开 Web 版本检查通过；保留全部公开 Host 下载、数据库/配置备份、回退依赖及仍在使用的 1 GiB 交换文件。脱敏记录见 `artifacts/server-storage/cleanup-result.json`，服务器留存 `/var/backups/agentdeck/storage-cleanup-20261101.json`。

## Web 功能

下列界面已包含在当前 Web 构建中；需要 Host 能力的操作仍受所连接 Host 版本限制。

| 功能           | 实现与验证边界                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 设置与项目管理 | 设置分类、项目打开/搜索/同步/确认移除，失败保留及焦点恢复；受控 Chromium 深浅主题、320/390px 通过，真实移除链路待验收               |
| 模型与思维强度 | 按账户/电脑/对话记忆，默认模型强度解析，滑块缓动及 Ultra 样式；10 项单元与受控浏览器通过，真实模型发送和手机待验收                  |
| 侧栏与消息     | 原生项目顺序、最近会话、置顶/归档、活动阶段折叠、排队消息展开、运行状态与 Plan 确认；真实 Host 队列自动消费及审批链路待验收         |
| 文件工作区     | 多文件标签、查找、代码/图片预览、Git 字母标记、紧凑分支比较；定向 Git/工作区和受控布局通过，跨平台整链路待验收                      |
| 图片与引用     | 页内图片放大、历史附件预览、取消/校验、文字引用、结构化文件卡片；受控回归通过，原生图片/文件引用需对应 Host 能力                    |
| 首屏与动效     | Markdown、设置、AgentChat、文件面板按需加载，Reduced Motion、弹窗焦点和退出处理；Chromium 受控检查通过，Safari/PWA/大历史待专项复核 |
| AgentChat      | Web/云端已部署；密钥库隔离 PostgreSQL 集成测试及本地 HTTPS 模拟供应商回归通过，未调用真实供应商模型；跨域与手机软键盘待验收         |

2026-11-01 队列按钮在源码中改为列表加号图标，去掉可见“排队”文字，保留“加入队列”提示及原有操作；尚未部署。

2026-11-01 问答回复消息卡片在源码中修复上下留白不一致：移除正文末尾顶层引用块额外的 12px 下外边距。受控 Chromium 使用真实 RichContent 复现桌面上方 11px、下方 23px，修复后均为 11px；320/390px 窄屏均为 10px。深浅主题、单项/多项问答共 12 组布局核对通过，无横向溢出或页面错误；CSS 格式检查通过，证据见 `artifacts/question-reply-spacing/before.json`、`after.json` 与同目录截图。仅完成源码样式修复，未部署，未做 Safari 或真机验收。

2026-11-01 顶栏连接标识在源码中改为连接成功时仅显示绿点，状态文字保留在悬停提示与无障碍标签中；重连、同步及异常状态沿用原有提示。Web 类型与定向 ESLint 检查通过，尚未部署。

2026-11-01 下拉框优化已在源码完成，尚未部署：Web/PWA 的外观、会话筛选/排序、默认模型/推理强度/输出、Host 系统、AgentChat 配置、分支比较及侧边对话选择接入统一组件；顶部、工具、项目概览、侧栏、模型、权限和工作模式菜单统一圆角、背景、边框、阴影与菜单行状态。选项较多时支持搜索，分支按本地/远程分组，长名称换行，面板按可用空间上下展开并限制视口边界；保留禁用状态、键盘操作、表单值和弹窗内顶层显示。Web 类型检查、定向 ESLint、生产构建及本批受控 Chromium 回归通过，覆盖深浅主题、320/390/1100px、键盘/搜索/禁用项、点击外部关闭、对话框层级、工具菜单边界及触屏 44px 选项和点选；原有设置与侧栏浏览器回归通过。入口为 `pnpm test:dropdowns-browser`，证据位于 `artifacts/dropdowns/verification.json` 及同目录截图。未做 Safari、真实手机/PWA 和真实 Host 链路验收，不代表生产网页已更新。

2026-11-01 侧栏操作优化已在源码完成，尚未部署：会话行只显示“三个点＋编辑”，原置顶/归档操作收进更多菜单，项目新建入口改用编辑图标；已标记会话独立成可折叠分区，从项目列表与最近对话中排除重复，取消标记后恢复原分区，沿用原有 `sessions.pin` 状态。归档/恢复确认直接在会话操作入口旁展开，空间不足时向上显示，限制可视区域，保留取消、错误重试和请求中重复提交阻断；不使用页面居中模态框。Web 类型检查、定向 ESLint、生产构建、设置页回归和本批侧栏 Chromium 回归通过，覆盖分区迁移、归档恢复、失败重试、请求中状态、断线/运行中保护、右键与键盘菜单、焦点恢复、320/390px 及触屏 44px 操作目标；证据位于 `artifacts/sidebar-desktop/verification.json` 和同目录截图，入口见[开发与验证](development.md)。未做真实 Host、Safari 和手机/PWA 验收。

2026-11-01 任务提醒优化已在源码完成，尚未部署：Codex 主/侧边会话收到任务完成、失败、停止或待审批事件时显示可点击的提醒卡片；同步/异步提问保留会话内问题与未读蓝点，按用户要求不再在右上角显示“需要你的回答”卡片。会话行和侧栏展开/折叠按钮右上角显示未读蓝点。关闭卡片保留未读，打开对应会话或操作当前会话后清除；提醒不抢输入焦点。应用内提醒始终启用，系统通知继续由用户偏好和浏览器权限控制，仅在页面后台发送。按账户、浏览器和 Host 保存有界的事件身份与未读类型，不保存问题/聊天正文；本机与原生任务事件去重，刷新不重弹旧事件，首次基线不把旧任务当新完成，运行中轮次在后续快照明确结束时可补发；已处理的原生问题/审批撤下对应提醒。Web 类型检查、定向 ESLint、生产构建及受控 Chromium 提醒、侧栏和设置回归通过，覆盖两类提问、完成/失败、跨会话跳转、蓝点与已读、重挂载/重放去重、状态补读、存储故障、后台系统通知替身及深浅主题 320/390/1200px 边界。入口为 `pnpm test:task-notifications-browser`，证据见 `artifacts/task-notifications/verification.json` 和同目录截图。仅处理已连接 Host 提供的事件与状态，不提供页面关闭后的 Web Push；未做真实模型、原生系统通知弹窗、Safari 和真机/PWA 验收。

2026-11-01 数学公式修复已部署至生产 Web：Codex 与 AgentChat 共用渲染器接入 TeX 语法解析和 KaTeX，支持 `\(...\)`、`\[...\]`、`$...$`、`$$...$$` 与 `math` 围栏，避免 Markdown 转义吞掉公式分隔符；单美元使用金额边界规则，保留代码及链接语义。公式样式和字体随 Markdown 按需加载，长块公式在消息内横向滚动，错误公式保留可见回退，不启用可信 TeX 命令或原始 HTML。本批 Web 类型检查、定向 ESLint、生产构建与受控 Chromium 回归通过：覆盖截图中的 Elo/BO3/BO5、中文、矩阵、对齐、列表/引用/表格、逐字符流式回复、金额和代码、错误回退、外部请求隔离及 320/390/1100px 布局；原有图片浏览器回归通过。入口为 `pnpm test:markdown-math-browser`，证据见 `artifacts/markdown-math/verification.json` 及同目录截图；参考 [LibreChat 渲染配置](https://github.com/danny-avila/LibreChat/blob/main/client/src/components/Chat/Messages/Content/markdownConfig.ts) 的语法扩展与 KaTeX 方案。用户当次明确授权“允许豁免 直接部署”，仅豁免本次数学渲染 Web 更新的全平台完整验收。未做真实模型、Safari/iPhone/PWA 验收，不将受控渲染记为真实端到端通过。

本次数学渲染部署版本 `8d968410f2365f9f11d324be7083f66721fa90f36d2e0fddfee143672a739f07`，源码基于 `622f3928da59b3bd3794a44d9ea25fd1daf7a109` 加未提交修改，差异 SHA-256 `189caf8d88ee146c5772158121de64af2a0b3d5265994fb8f3842186a0c2951d`，归档 SHA-256 `d5d02ffd48cc8d6358f0d5c5a05ba569ad8bc06c4e72c96ab017d78003205656`。备份服务成功后原子切换独立 Web 链接，保留 20 个旧资源；82 个本批公开文件哈希、首页、版本 no-store 与存活/就绪检查通过，云端程序/进程、Host 和稳定下载指针保持不变。产物及授权清单位于 `artifacts/markdown-math/candidate-final/`，部署证据为 `artifacts/markdown-math/deployment-result.json`。公开站点 Chromium 登录页和生产资源渲染检查通过：隔离浏览器内的 AgentChat 测试记录正常显示 5 条公式，KaTeX 字体/样式加载成功，390px 长公式可滚动且页面不溢出，无页面错误；API 在测试浏览器中拦截，未操作真实账户、Host 或模型，证据为 `artifacts/markdown-math/public-smoke.json` 与 `public-mobile.png`/`public-desktop.png`。回退入口：`python3 /var/backups/agentdeck/web-8d968410f236-20261101T074733Z/rollback.py`（先核对没有后续部署）；生产 Web 与备用 Pages 仍为不同版本。

首屏历史对照：主入口约 634→396 kB，gzip 198→126 kB；冷缓存、4 倍 CPU 降速、三次 Chromium 的 FCP 中位数 264→212 ms。该结果只代表本地实验，不代表真实网络、INP 或稳定 60fps；近期修改不自动继承旧结论。

## 中英文支持（源码完成，未部署）

Web/PWA 已接入 1094 条共享中英文资源，覆盖登录、设置、对话、审批、队列、通知、文件和工作区工具；保留未知错误原文及稳定错误码。类型检查、ESLint、生产构建、资源键/插值/复数检查、会话工作状态单测，以及受控 Chromium 语言切换、下拉、输入框和工作区工具回归通过。语言回归覆盖系统检测、持久化、跨标签页同步、草稿与 DOM 保留、安全插值、延迟组件和 320/390/1280px 英文设置。

本批证据为 `artifacts/commit-batch3/verification.json`，浏览器语言结果及截图见 `artifacts/i18n/`。受控浏览器使用接口替身；未做真实模型、Safari/手机/PWA 和跨平台真实安装验收，未构建发布候选或部署。

## Web 语音输入（源码新增，未部署）

2026-11-01 本批源码为主对话、侧边对话和 AgentChat 共用输入框右下角主按钮合并语音入口：空草稿显示白底深色声波图标，有文字/附件等可发送内容时切换发送箭头（任务运行时沿用加入队列），不再另放麦克风按钮。录入过程中主按钮保持结束识别，结束后按草稿切回发送。调用浏览器语音识别，默认普通话，无新依赖、服务端接口或 API Key。临时文字单独预览，确认文字按光标/选区加入草稿并去重，核对后手动发送，不执行斜杠命令。支持结束等待、取消、错误及浏览器不支持提示；页面仅一个麦克风实例，编辑、切换、隐藏、失去可用状态和退出会释放录入，旧回调不能覆盖新草稿。单次录入两分钟，结束事件缺失时五秒退出等待。

本批 Web 类型检查、定向 ESLint、生产构建、受控 Chromium 语音输入回归和原有输入框回归通过，覆盖主按钮空草稿/文字/清空切换与唯一入口、临时/确认结果、插入与去重、手动发送、权限/网络等错误、独占与生命周期清理、超时及 390px 深浅主题布局。入口为 `pnpm test:speech-input-browser`，证据位于 `artifacts/speech-input/verification.json` 与同目录截图。识别接口为测试替身，未请求真实麦克风/识别服务，未做 Safari、手机/PWA、真实中文转写或供应商网络可达性验收。浏览器服务可能联网处理音频；AgentDeck 不上传或保存录音。仅完成源码，未构建发布候选、未部署 Web 或更新 Host。

## 工作区工具栏、侧边对话与 SSH（源码新增，未部署）

2026-11-01 本批源码扩展现有右侧文件栏：文件、工作区改动、SSH 终端和侧边对话共用工具入口与标签，支持拖动调宽、扩大和快捷键；宽屏同时保留主对话，窄屏切换显示。侧边对话可独立选择项目、已有会话或发送新建会话，复用原有历史分块校验、流式渲染、模型/权限选择、队列、审批与追问；切换工具或关闭右栏保留本页草稿。未知发送结果在回执核对后仍需明确确认，不自动重发。原生会话观察和最新轮次检查按 Host 能力启用。

Host 新增 `sshTerminal` 能力和连接归属的 OpenSSH PTY，支持现有配置/密钥、密码及指纹提示、输入、输出游标、缩放和关闭；输入按序号去重，输出缓冲有界，终端内容不进入持久聊天、操作回执或事件日志。不同标签页不能读写彼此终端；关闭工具栏、断线、设备撤销或 Host 停止会清理终端，恢复不自动连接。活跃终端阻止空闲更新切换；旧 Host 显示升级提示，无数据库迁移。

本批 Linux Rust 5 项定向测试通过，其中 1 项以临时密钥、配置和随机回环端口启动真实 sshd，实际核对主机指纹、中文 PTY 输出、窗口尺寸、输入去重、连接归属和设备清理；严格 Clippy 通过。Web 类型检查、定向 ESLint、生产构建及受控 Chromium 检查通过，覆盖双会话同时流式更新且不串线、文件预览和草稿保留、侧边已有/新会话发送、审批确认归属、未知结果阻断、SSH 输入/控制键及 390px 布局；修复嵌套文件栏隐藏动画占用侧边对话高度。入口为 `pnpm test:workspace-tools-browser` 与[开发与验证](development.md)中的 SSH 命令，浏览器证据见 `artifacts/workspace-tools/verification.json` 及同目录截图。

本批仅完成源码与上述定向验证，未构建发布候选、未更新生产 Web 或日常 Host。尚未验证真实模型双对话、云端到 Host 再到 SSH 的完整链路、Windows ConPTY、macOS、真实密码/密钥口令认证，以及 Safari/手机/PWA；受控浏览器中的 Host 数据和 SSH 响应为测试替身，不能视为真实整链路验收。现有正式版本和下载指针不变。

## 需要 Host 更新或专项验收的功能

| 功能             | 源码能力与已验证范围                                                                                                                  | 未完成                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 原生会话图片     | `sessionMessageImages`、`sessions.image` 可选 `sourcePath`；匹配原生图片记录，支持项目外 `.codex`、临时目录；Rust 与受控 Web 回归通过 | Host 安装及真实会话链路；旧 Host 继续项目预览                 |
| 自动项目登记     | 官方 `project/create` 补登记已信任目录和旧授权，撤销后不恢复；隔离官方接口验证通过                                                    | 日常 Host 更新和真实 Web 自动出现                             |
| 文件结构化引用   | `fileReferenceInputs`，官方 `text_elements` / `byteRange` 保存原生标记；真实模型读取与历史标记读回通过                                | 云端到 Host 整链路、Windows/macOS/手机，原版卡片外观          |
| 原生队列补充     | `nativeQueueSteer`、`queue.steer`，确认删除后补充，未知结果保留核对记录                                                               | 真实运行中补充、队列竞态与跨平台                              |
| 分支比较         | `gitBranchCompare`、`git.branches/compare/compareDiff`，授权内只读，不 fetch，不含未提交改动；真实 Git 定向通过                       | 实际 Host 能力升级及云端整链路                                |
| 图片与附件       | `projectImagePreview`、`files.readImage`；图片 8 MiB/64 KiB 分块，附件最多 4 个、各 512 KiB；边界与压缩定向通过                       | 对应 Host 更新、系统剪贴板及真实收图                          |
| 普通聊天完整访问 | 无项目会话允许权限选择，逐轮重设审批与隔离；静态检查通过                                                                              | 对应 Host 更新与真实权限切换                                  |
| 并发上限         | 普通发送/手动队列/编辑重发统一限制 5 个，严格 Clippy 通过                                                                             | 真实五任务并发；自动队列和外部任务尚未统一计数                |
| 原生更新         | 候选通道、持久状态、空闲切换及发布门槛已实现                                                                                          | 全平台真实更新链路；本批 Actions/VPS 发布及环境分支保护已验证 |

## 运行时和平台

官方包来源校验、共享所有者、独立认证连接和 Linux x64 本地云端加密转发下 CLI↔Web 同 UUID 续聊、真实文件读写及外部拒绝通过。完整细节和 Windows/macOS 自行验收步骤见[运行时专项验收](runtime.md)，不能据此晋升候选。

2026-11-01 Windows 0.4.2 用户现场反馈：`agentdeck projects sync` 提示 `Codex is not ready`；状态中 `cloud.online=true`、`codexReady=false`、`sandboxVerified=true`，`runtimeError` 为 `UNSAFE_UPSTREAM_CONFIG: Workspace permission profile overridden`，运行时版本为 `0.166.0-alpha.1`。用户只读检查确认 `.codex/config.toml` 第一行存在 `sandbox_mode = "danger-full-access"`。结合源码定位为已有 Codex 配置与 Host 工作区权限校验冲突；此次错误发生在权限配置检查阶段，云端已连接，已有沙箱探测通过也不能替代当前运行时配置检查。

0.4.2 的触发机制：启动参数指定 `default_permissions="agentdeck"` 及继承 `:workspace` 的权限配置，但 Windows 未显式覆盖用户配置中的旧 `sandbox_mode`；校验要求该字段为 null，同时核对默认权限和继承关系，任一不符均返回上述通用错误。已知用户配置中的 `danger-full-access` 与这一要求不符；在 0.4.2 Windows 改成 `workspace-write` 仍不满足 null 条件。旧版临时处理为备份并注释冲突项，在核对任务并保存工作后重启电脑，使独立共享运行时重新加载配置；仅重启 Host 会保留共享运行时。操作与恢复条件见[使用与维护](usage.md#windows-权限配置冲突)，尚未取得该用户修改后的恢复结果。

源码已修复，尚未发布：`desktop/core/src/upstream/codex.rs` 的 Windows 启动参数显式覆盖 `sandbox_mode="workspace-write"`，保留原有 `agentdeck` 权限配置、审批及 MXC 设置，不修改用户文件。Windows 校验兼容空值和 workspace-write，仍拒绝 danger-full-access；macOS 与 Linux 的原有模式要求保持。权限模式、默认权限名称及继承关系分别报告具体字段，模式值只回显已知枚举，其他配置值不写入诊断。文件系统、网络、临时目录、MCP/hooks 和实际会话权限检查继续执行，未修改逐轮普通/完整访问切换逻辑。

本批 5 项权限兼容单元测试、1 项共享恢复策略回归与严格 Clippy 通过；1 项官方接口测试在 Linux x64 以固定官方 `0.166.0-alpha.1` 和 Windows 启动参数通过，覆盖未指定、read-only、workspace-write、danger-full-access 四种用户及受信任项目局部配置，核对全局/项目配置、项目列表、临时会话权限和两份配置文件保持不变。测试隔离 Codex 状态且不调用模型，入口见[开发与验证](development.md)。该结果仅证明配置覆盖与会话元数据行为，未验证 Windows MXC 实际读写边界、真实普通→完整→普通切换、Host 项目同步整链路及共享运行时重启。Windows MSVC 目标编译检查在依赖构建阶段因当前 Linux 环境缺少 `lib.exe` 失败，不能记为 Windows 编译通过；仍需 Windows 候选编译与实机验收。本批未构建发布候选、替换日常 Host 或部署，正式下载仍为 0.4.2。

Windows 用户已在 `release` 源码 `692bba2` 编译并重启 Host 后，确认原版桌面通过共享入口启动，AgentDeck Web 能显示其新建对话；截图显示同一标题下依次完成桌面写入 `DESKTOP-1`、Web 续聊追加 `WEB-2`、桌面续聊追加 `DESKTOP-3`，两边均显示交替消息和结果。用户于 2026-10-30 确认该功能成功，并授权发布 `0.4.2`。这记录 Windows 桌面↔Web 的实测通过；尚未取得本批安装包升级、CLI 第三端、重启恢复及完整权限验收记录。

当前源码修复桌面接入的默认功能标志、单插件 MCP 策略默认值及 analytics 默认提示比较；显式禁用、未知开关、错误类型及其他 MCP/审批配置差异仍拒绝。Host 索引保留 `appServer`，仍执行非临时会话、授权项目和规范化工作目录校验，提供脱敏启动诊断。18 项启动检查单元测试、1 项索引测试、严格 Clippy、CLI/代理构建及 Linux x64 官方运行时隔离验证已通过；证据位于 `artifacts/plugin-startup-diagnosis/`。这些定向验证不能代替 0.4.2 同批安装包的全平台验收。

0.4.2 正式发布已获用户于 2026-10-30 明确授权：“本次豁免，正式发布 0.4.2”。用户豁免本批安装包升级、CLI 第三端、重启恢复、完整权限回归及其他平台完整验收，以 Windows 源码桌面↔Web 续聊实测为发布依据；未测项仍记录为未测，后续版本不沿用此豁免。

本批原始候选身份：源码 `c96f94d83b18b7e64cf2348ca35cf480cb5de45f`；候选清单 SHA-256 `1f213fbbd222cea56aeba777e4cda06fac063adcfb7b7a70e697beaafc190b02`，候选归档 SHA-256 `e2a4114ebcb8c6fb042d21f50ffc1079bb57d14d16b4c7a9d4fadfdfd2be1dcc`。[候选工作流](https://github.com/ptsfdtz/codex-go/actions/runs/41070263990)覆盖四个平台包、Web/Pages 和云端。正式发布原样晋升该批文件；授权记录随正式版附件公开，源码保存在 `scripts/release/waivers/0.4.2.json`。入口固定源码、清单、归档和原始校验器哈希，不放宽默认 `gate.py`；18 项发布检查通过。

GitHub 托管执行器因账户付款/额度限制未能启动发布工具提交的 CI，不是代码测试失败；产品候选的全平台 CI 已通过。发布使用隔离的一次性专用自托管执行器，工作流成功后执行器自动注销，临时账户/凭据已清理。本机 Linux 日常 Host 仍为 0.4.1，发布过程中未重启或替换，不作为本批验收。

Linux 本机曾使用 `local-root-policy-repair-20261027` 修复运行权限，真实终端的普通→完整访问→普通隔离恢复及重启身份保持通过；这是本机修复，未晋升公开下载。macOS 本地 Host、launchd、seatbelt 和本地 HTTPS 安装通过，线上安装/升级及真实模型仍未完成。历史 Linux/ARM64 隔离基线不代替本批候选实测。

`0.4.0` 首轮候选 `8e7552a` 因 Windows 共享运行时的 PowerShell PATH 问题未晋升；源码修复后必须重新构建验收。临时 ARM64 workflow 不自动生成通过记录，结束后须清理凭据和测试账户。

## 证据与下一步

| 证据目录（仓库根目录下）                                                                  | 内容                                                                        |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `artifacts/official-runtime/`                                                             | 官方包、隔离安装、沙箱和共享运行时；`fullstack-linux.json` 为本地全链路结果 |
| `artifacts/project-settings/`、`artifacts/message-images/`                                | 项目设置和会话图片受控浏览器截图                                            |
| `artifacts/file-workspace/`、`artifacts/branch-comparison/`、`artifacts/file-references/` | 文件、分支比较与结构化引用                                                  |
| `artifacts/ui-refresh/`、`artifacts/queue/`、`artifacts/composer/`                        | 界面、排队与输入区                                                          |
| `artifacts/performance/`、`artifacts/api-chat/`、`artifacts/host-names/`                  | 性能 trace、AgentChat 与电脑名称验证                                        |

这些是已有记录引用的本地证据路径，不保证随仓库分发；缺少文件时不得将记录当作本批已验收。

下一步按候选范围完成 Windows、Linux x64/ARM64、macOS arm64 的安装升级、真实模型、权限审批、重连恢复及运行时共享验收；复核日常桌面切换、系统注销/重启自启、手机/PWA 输入法与安全区、休眠切网、大历史及生产账户删除事务。构建、下载校验和健康检查不能代替这些验收。

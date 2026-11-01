# 开发与验证

[开发入口](../AGENTS.md) · [架构与边界](architecture.md) · [功能状态](status.md)

以下命令均从仓库根目录执行。按改动选择定向检查，受控浏览器回归不代替真实 Host、模型或真机验收。

## 开发与验证

AgentChat 需同时更新 Web 和云端，Host 无需更新。云端设置 `AGENTDECK_CHAT_ENCRYPTION_KEY` 为 **32 个随机字节的标准 Base64 编码**（如 `openssl rand -base64 32`），Compose 已透传；未设置时配置/发送禁用，格式错误拒绝启动。持久保存并备份该密钥，不可提交真实值；直接更换会导致已存 API Key 无法解密。云端只写 `chat_keys`（随机 ID、账户归属、密文），不创建聊天记录表；旧候选版本已存在的表不主动删除。兼容接口 Base URL 填到 `/v1` 等前缀，供应商必须允许网页来源的 CORS 与 Authorization/Content-Type 请求头；浏览器不携带本站 Cookie/CSRF 或 Referer 到供应商，不跟随重定向。清除浏览器数据会丢失本地聊天及接口配置，其他设备不会自动获得历史；关闭页面无法继续生成。

AgentChat 回归：`pnpm test:api-chat-browser`（复用下方 Playwright 变量，需要本地 `openssl` 创建临时 HTTPS 模拟供应商）；服务端 `cargo test --locked --manifest-path server/Cargo.toml --lib chat`。密钥库集成测试使用独立、可丢弃且以 `_test` 结尾的 PostgreSQL：`AGENTDECK_TEST_DATABASE_URL=postgresql://.../agentdeck_chat_test cargo test --locked --manifest-path server/Cargo.toml --lib chat -- --include-ignored`，不可指向日常数据库。测试仅使用临时假密钥，不调用真实供应商。

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

## 功能定向回归

| 功能             | 检查入口                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| 设置中的项目管理 | `pnpm test:project-settings-browser`                                                                     |
| 原生运行状态     | `node --test scripts/web/test-session-working.mjs`                                                       |
| 排队交互         | `node scripts/web/test-queued-messages-browser.mjs`                                                      |
| Web 语音输入     | `pnpm test:speech-input-browser`，`SPEECH_TEST_ORIGIN` 默认 `http://127.0.0.1:1498/`                     |
| 文件引用         | `pnpm test:file-references-browser`，默认端口 1492，可用 `FILE_REFERENCE_TEST_ORIGIN` 指定               |
| Markdown 数学公式 | `pnpm test:markdown-math-browser`，`MATH_TEST_ORIGIN` 默认 `http://127.0.0.1:1430/` |
| 文字选中引用     | `pnpm test:selection-quote-browser`，默认端口 1491，可用 `SELECTION_QUOTE_TEST_ORIGIN` 指定              |
| 自动项目登记     | `cargo test --locked --manifest-path desktop/core/Cargo.toml --lib automatic_project_registration_tests` |
| 运行时权限配置兼容 | `cargo test --locked --manifest-path desktop/core/Cargo.toml --lib workspace_policy_tests` |
| 会话图片路径授权 | `cargo test --locked --manifest-path desktop/core/Cargo.toml --lib session_image_path_tests`             |
| 动效与设置       | `pnpm test:ui-browser`、`pnpm test:motion-browser`                                                       |
| 下拉选择与菜单   | `pnpm test:dropdowns-browser`，`DROPDOWN_TEST_ORIGIN` 默认 `http://127.0.0.1:1434/`                       |
| 侧栏分区与操作   | `node scripts/web/test-sidebar-browser.mjs`，`SIDEBAR_TEST_ORIGIN` 默认 `http://127.0.0.1:1430/`         |
| 任务提醒与未读   | `pnpm test:task-notifications-browser`，`TASK_NOTIFICATIONS_TEST_ORIGIN` 默认 `http://127.0.0.1:1434/`   |
| 首屏性能         | `pnpm test:performance-browser`，`PERF_TEST_ORIGIN` 默认端口 1599，`PERF_BASELINE_ORIGIN` 指定对照站     |

数学公式回归复用上述 Playwright 环境，可用 `COMPOSER_TEST_FONT` 指定中文字体，证据输出到 `artifacts/markdown-math/`。

语音输入回归复用上述 Playwright 环境，先启动指定端口的本地 Vite（如 `pnpm --filter @agentdeck/web exec vite --host 127.0.0.1 --port 1498 --strictPort`）。脚本挂载真实 Composer，以浏览器识别接口替身检查临时预览、光标插入、确认结果去重、手动发送、跨输入框独占、切换/隐藏/退出清理、错误和超时，以及窄屏深浅主题；拦截外部/API 请求，不请求真实麦克风或识别服务。可用 `COMPOSER_TEST_FONT` 指定中文字体，结果及截图输出到 `artifacts/speech-input/`；受控通过不能替代真实语音识别、浏览器供应商网络和手机/PWA 验收。

下拉框回归复用上述 Playwright 环境，先在指定端口启动本地 Vite（如 `pnpm --filter @agentdeck/web exec vite --host 127.0.0.1 --port 1434 --strictPort`）。检查真实选择组件、分支搜索、设置菜单、弹窗层级、键盘和触屏操作、深浅主题与窄屏边界；截图和结果输出到 `artifacts/dropdowns/`，不连接真实 Host。

任务提醒回归复用上述 Playwright 和本地 Vite 环境；挂载真实 App 并拦截账户/Host 请求，检查任务结束、同步/异步提问、待审批、未读蓝点、去重和持久化、状态补读与窄屏布局。系统通知使用测试替身，不请求操作系统权限；结果和截图输出到 `artifacts/task-notifications/`，不执行真实模型或审批操作。

自动项目登记真实接口测试须设置 `AGENTDECK_TEST_OFFICIAL_CODEX` 为已验证的官方程序绝对路径，并追加 `-- --include-ignored`，不调用模型。性能测试须使用独立固定的生产构建目录，避免并行构建替换资源。浏览器脚本的环境变量及实际覆盖以对应脚本为准。

运行时权限配置兼容测试使用同一 `AGENTDECK_TEST_OFFICIAL_CODEX` 变量，追加 `-- --include-ignored` 可运行官方接口检查。它在临时 `CODEX_HOME` 中分别设置未指定、read-only、workspace-write、danger-full-access，并检查受信任项目局部配置；使用 Windows 启动参数，核对全局/项目配置、项目列表与临时会话权限，确认两份配置文件保持不变。不读取日常认证、不调用模型；Linux 上运行只证明官方配置覆盖和会话元数据行为，不能代替 Windows MXC 实际读写隔离、权限切换和共享运行时重启验收。

## 工作区工具栏与 SSH 定向检查

```sh
pnpm test:workspace-tools-browser # 默认本地 Vite 端口 1495，可用 WORKSPACE_TOOLS_TEST_ORIGIN 覆盖
cargo test --locked --manifest-path desktop/core/Cargo.toml --lib ssh_terminal
cargo test --locked --manifest-path desktop/core/Cargo.toml --lib ssh_terminal -- --include-ignored
```

浏览器检查复用 `PLAYWRIGHT_MODULE`，在隔离页面中挂载真实 App 并拦截全部账户/Host 请求，覆盖双会话流式归属、创建/发送、审批确认、草稿与文件切换、未知发送结果、终端输入及手机布局，不连接生产账户或调用模型。证据输出到 `artifacts/workspace-tools/`。

最后一条 Rust 命令额外运行 Linux 本机 OpenSSH 集成测试，需要 `/usr/sbin/sshd`、`ssh` 与 `ssh-keygen`。测试在临时目录生成密钥和配置，只监听随机回环端口，使用临时 known_hosts，不修改日常 SSH 身份或 AgentDeck 状态；实际核对指纹、连接 PTY、中文输出、缩放、输入去重、连接归属和设备清理。不能据此认定 Windows ConPTY、macOS、密码/口令认证或云端整链路已经验收。

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
| 文件引用         | `pnpm test:file-references-browser`，默认端口 1492，可用 `FILE_REFERENCE_TEST_ORIGIN` 指定               |
| 文字选中引用     | `pnpm test:selection-quote-browser`，默认端口 1491，可用 `SELECTION_QUOTE_TEST_ORIGIN` 指定              |
| 自动项目登记     | `cargo test --locked --manifest-path desktop/core/Cargo.toml --lib automatic_project_registration_tests` |
| 会话图片路径授权 | `cargo test --locked --manifest-path desktop/core/Cargo.toml --lib session_image_path_tests`             |
| 动效与设置       | `pnpm test:ui-browser`、`pnpm test:motion-browser`                                                       |
| 首屏性能         | `pnpm test:performance-browser`，`PERF_TEST_ORIGIN` 默认端口 1599，`PERF_BASELINE_ORIGIN` 指定对照站     |

自动项目登记真实接口测试须设置 `AGENTDECK_TEST_OFFICIAL_CODEX` 为已验证的官方程序绝对路径，并追加 `-- --include-ignored`，不调用模型。性能测试须使用独立固定的生产构建目录，避免并行构建替换资源。浏览器脚本的环境变量及实际覆盖以对应脚本为准。

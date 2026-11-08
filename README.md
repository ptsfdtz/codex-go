# AgentDeck

通过浏览器或 PWA 操作电脑上的 Codex：查看会话、发送任务、处理审批，以及浏览项目文件和 Git 改动。任务在电脑 Host 上执行，会话权威状态保存在电脑；云端负责账户、设备归属和加密连接转发，不运行模型、不保存 Codex 聊天或媒体。

## 开始使用

打开 [Web/PWA](https://agent.ptsfdtz.top/)。在要执行任务的电脑上安装 Host，并登录同一 AgentDeck 账户。

Windows x64，PowerShell：

```powershell
irm https://agent.ptsfdtz.top/install.ps1 | iex
agentdeck login --username NAME
agentdeck projects add "D:\Projects\MyApp"
agentdeck start
```

Linux x64 / ARM64、macOS arm64：

```sh
curl -fsSL https://agent.ptsfdtz.top/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
agentdeck login --username NAME
agentdeck projects add /绝对路径/项目
agentdeck start
```

当前稳定版为 [0.4.4](https://github.com/ptsfdtz/codex-go/releases/tag/v0.4.4)。首次启动自动下载并校验固定的官方 Codex 运行时；需要认证时执行 `agentdeck codex-login`，AgentDeck 登录与 Codex/OpenAI 认证相互独立。Windows 可通过安装器创建的“Codex shared”入口或 `agentdeck desktop` 打开共享桌面，CLI 使用 `agentdeck codex`。Windows 桌面↔Web 续聊已有用户实测；0.4.4 四平台已构建并校验，本次实机端到端验收经用户授权豁免，未测范围见[功能状态与验证](docs/status.md)。macOS Intel 暂不发布。

安装包不依赖 Node、pnpm、Rust 或 WebView2。安装后在网页选择电脑和项目，打开或新建对话。电脑需保持在线；手机使用浏览器或将站点添加到主屏幕。

## 日常操作

```sh
agentdeck status --json       # 查看连接与 Codex 就绪状态
agentdeck logs --follow       # 查看诊断
agentdeck autostart enable    # 登录系统后启动
agentdeck update --check      # 检查 Host 更新
agentdeck update              # 下载并安装，空闲后再显式重启
```

Web 更新与 Host 更新分别进行。重启 Host 前先核对任务、审批和未知发送结果；安装完成不等于 Codex 已就绪。完整命令、数据目录、自启、升级和故障排查见[使用与维护](docs/usage.md)。

## 功能与边界

- 会话历史、流式回复、模型与思维强度选择、排队消息、审批和追问。
- 项目管理、文件和图片预览、Git 工作区及分支比较；部分功能需要新版 Host。
- 断线重连和结果核对；发送结果未知时不自动重发。
- AgentChat 支持浏览器直连兼容 API，聊天历史保存在本浏览器，API Key 在云端加密保存；不持有 OpenAI 账户认证凭据。

具体部署版本、Host 能力缺口与未验收项见[功能状态与验证](docs/status.md)。共享入口与普通独立启动的 Codex 行为不同，参见[运行时与三端共享](docs/runtime.md)。

## 文档导航

| 文档                                   | 内容                                            |
| -------------------------------------- | ----------------------------------------------- |
| [使用与维护](docs/usage.md)            | 安装、认证、命令、自启、升级与 Linux 运行时配置 |
| [开发入口](AGENTS.md)                  | 开发规则、任务阅读路径和文档维护约定            |
| [架构与安全边界](docs/architecture.md) | 组件职责、状态归属、协议与授权边界              |
| [开发与验证](docs/development.md)      | 环境、目录、构建和定向检查                      |
| [发布与运维](docs/deployment.md)       | 候选、真实验收、正式发布、VPS 和备份            |
| [运行时专项验收](docs/runtime.md)      | 官方运行时候选、三端共享及各平台验收方法        |
| [功能状态与验证](docs/status.md)       | 当前版本、验证证据、未完成项和下一步            |

管理入口：[管理端](https://agent.ptsfdtz.top/admin)。备用 Web：[GitHub Pages](https://ptsfdtz.github.io/codex-go/)；备用站点不代表与生产站版本一致。

## 许可证

本项目原创代码采用 [MIT 许可证](LICENSE)。第三方代码和依赖遵循各自许可证；NextChat 改编部分保留 [原始版权与许可](third_party/nextchat/LICENSE)。

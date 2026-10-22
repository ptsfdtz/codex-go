# 原版桌面本机认证适配（阶段 0 开发入口）

## 目的和边界

安装版 26.1013.3656.0 的本地 WS 路由允许指定服务 URL，但没有为 capability-token 注入 Bearer 的入口。`desktop/core/src/upstream/desktop_adapter.rs` 提供默认关闭的回环适配：验证 HTTP Basic，再以 Bearer 连接已经显式配置的原生服务。它不启动、复制或终止原生服务，不代理账户云端认证，不改写 JSON-RPC，也不重放未知结果的请求。

目前仅验证传输可行性，**不是原版桌面已接入的交付功能**。`sharedDesktopRuntime` 保持 false；活动 stdio 任务不能靠设置环境变量在线迁移。

## 服务端配置

沿用 `AGENTDECK_RUNTIME_WS_URL`、`AGENTDECK_RUNTIME_TOKEN_FILE`、匹配版本的 `AGENTDECK_RUNTIME_PROTOCOL_VERSION` 与 `AGENTDECK_CODEX_EXE`；在这些配置和原生 boundary 检查有效时，同时设置 `AGENTDECK_DESKTOP_ADAPTER_PORT` 和 `AGENTDECK_DESKTOP_ADAPTER_TOKEN_FILE` 才启用适配。两项都未设置时关闭，仅设置其中一项报错。0 分配临时端口，固定端口必须大于 1024。仅支持 attached 模式，仅绑定 `127.0.0.1`。启动事件 `desktop.adapter.status` 只包含状态和端口，不包含凭据或认证 URL。该事件是电脑本地进程输出，不增加安卓协议能力。

桌面端候选路由是 `CODEX_APP_SERVER_WS_URL`，Basic 用户名为 `agentdeck`、密码改为**独立适配凭据**，不是原生 capability token。新文件必须为绝对路径，内容同为 32–4096 字符 base64url，可有末尾换行；启动及每次握手检查两种凭据不同。没有自动降级到原生令牌，也不自动生成或保存认证 URL。该开发入口收紧不影响默认关闭状态和安卓配对数据。

**环境变量承载认证 URL 的生产路径未通过。** 安装版 `buildTerminalEnv` 先复制 process.env；工作树环境读取失败时保留继承环境，最终 `Ct` 清理仅移除崩溃报告相关变量，保留 `CODEX_APP_SERVER_WS_URL`。即使工作树配置可以额外排除变量，也不能消除其失败回退路径。只读审计脚本实际运行了精确匹配的纯清理函数，使用合成标记确认此行为，没有运行 GUI 或读取实际环境/用户日志。复现：`node scripts/codex/audit-desktop-ws-environment.mjs <app.asar绝对路径> [报告路径]`；安装包文件名、SHA-256、JS 字符偏移和结果见 [审计记录](../../baselines/codex-0.163.0-alpha.10.2/desktop-ws-environment-audit.json)。不认识的打包布局/函数形状直接失败，要求重新核验。

独立凭据可单独轮换、阻止原生令牌经 URL 暴露，但它仍能通过适配层访问原生服务，**不能当作环境继承问题已经修复**。不得在当前生产桌面配置此 URL。后续优先核验不经环境变量传递的宿主配置或其他本机认证路径，并继续检查 URL 日志/诊断；再准备可回退的独立 GUI 验收，不能重启当前任务来替代准备工作。

## 认证、资源与关闭

- 仅接受根路径、精确 IP/端口 Host、单一匹配 Authorization；拒绝 query、Origin 和子协议。认证失败不连接上游。
- 每次新连接重读两个有界本机 token 文件，适配令牌轮换后旧凭据的新连接拒绝；原生令牌不能认证适配入口，误轮换成相同值也会拒绝新握手。既有连接不自动撤销。需要撤销全部适配连接时关闭适配层，设备撤销仍沿用 Bridge 自有流程。
- 最多 16 个认证后连接，帧和消息上限 8 MiB，上游连接/发送最长等待 10 秒。只转发文本 RPC，二进制不支持；处理两个方向的 Ping/Pong。
- 退出时取消适配连接并关闭监听，不结束共享服务或其他直接连接。关闭等待可能受正在进行的有界发送影响。没有新的磁盘数据库或迁移，也没有绕过上游权限/审批。

## 可重现验证

常规：`cargo test --locked --manifest-path desktop/core/Cargo.toml --test desktop_adapter`。覆盖认证边界、认证失败不连接上游、双向原文/审批帧、Ping、凭据轮换、连接隔离、关闭及固定网关错误。

Node 构造参数验证：将 `AGENTDECK_DESKTOP_WS_MODULE` 指向本机已安装的 Node `ws` 模块绝对路径，再运行相同命令并追加 `desktop_style_node_constructor_sends_url_basic_auth -- --ignored`。fixture 以 stdin 传递测试凭据，不放入命令参数或输出。当前验证使用 ws 8.21.0；构造参数对应已安装桌面的本地分支，不是启动桌面打包代码或原版 GUI。

真实原生服务：将 `AGENTDECK_DESKTOP_PROBE_EXE` 指向精确 0.163.0-alpha.10.2 可执行文件，运行 `cargo test --locked --manifest-path desktop/core/Cargo.toml --test runtime_websocket real_desktop_baseline_ -- --ignored --nocapture`。三项检查现在都经过 Basic → Bearer 适配完成 initialize，并读取另一原生连接创建的相同 threadId。服务 HOME/目录隔离，模型检查使用本机合成提供者，不读取当前桌面历史、不使用账户模型。

仍需：环境继承问题的实际解决、桌面凭据日志路径审计、原版 GUI 安全连接与任务全流程、断连/重连/审批归属、真实账户及安卓真机验证；不能把以上测试升级为这些验收证据。

## 不含认证 URL 的候选路径核验

本轮没有找到可可靠配置本地 `websocket_url` 的宿主设置入口；不能因为内部对象存在该字段就指导改写用户私有数据。只读代码确认 `CODEX_CLI_PATH` 可覆盖可执行文件路径，默认仍附加 `-c features.code_mode_host=true`、`app-server`、`--analytics-default-enabled`，还可能附加动态 `-c` 覆盖项；新增静态结论也记录在指纹审计报告中。这是受控 CLI 转接的候选入口，不是已验收接口。

原生 `app-server --listen unix://PATH` 和 `app-server proxy --sock PATH` 均存在，但**当前安装版不能把这两者直接配对**。隔离 Windows 实测：控制 socket 目录需仅授予当前用户 SID；沿用 Bridge 的用户+SYSTEM 目录权限时，原生服务拒绝“socket directory is not private to the current user”。改为仅当前用户后，服务启动，但内置 proxy 发送原始 stdio 字节，而 listener 要求 WebSocket，原生日志报告 `failed to upgrade control socket websocket connection: WebSocket protocol error: httparse error: invalid token`。这里的 token 指 HTTP 解析项，不能误当作缺少账户认证而开始读取账户令牌。该结果仅否定这组精确启动参数，不否定所有原生 daemon/control socket 接入方式。

可复现：`node scripts/codex/check-shared-codex-runtime.mjs <精确安装版codex.exe绝对路径> <报告目录> --unix-proxy`。当前基准应退出 1，报告 passed=false，表示候选接入未通过，不能改写为测试成功。脚本只创建隔离临时 HOME/目录，在新目录移除继承并授予当前用户；不修改现有桌面配置、不运行模型、不启动/重配现有 daemon。原始报告留在本机 artifacts，去掉无关日志与路径的必要证据见 [不兼容记录](../../baselines/codex-0.163.0-alpha.10.2/native-stdio-proxy-incompatibility.json)。

脚本的 stdio fixture helper 只用于上述原生命令探测，不是发布版代理。其分帧与退出回归：`node --test scripts/lib/native-stdio-socket.test.mjs`。原 WS 默认模式继续通过真实合成模型的共享/历史检查。Windows AF_UNIX 文件可表现为无法 stat 的 reparse point，启动判据使用真实 initialize，不能用文件存在替代连接成功。

后续已实现受控 stdio → 已认证回环 WS 的开发转接程序，详见 [stdio 配置与接手](CODEX_DESKTOP_STDIO.md)。凭据从电脑文件读取，桌面只接触不含令牌的可执行路径；同连接核验真实 CLI/服务版本及 startup 配置。完整动态参数、CLI 委派和原版 GUI 仍未验收，不得配置当前生产桌面或将 CODEX_CLI_PATH 指向 Bridge 主程序。Basic 适配仍仅保留为默认关闭的开发路径，不能借此绕过环境继承问题。另需继续验证原生控制套接字、桌面宿主功能与独立 GUI 的可回退接入。

# 桌面 stdio → 原生认证 WebSocket 转接

阶段 0 开发实现；不是原版 GUI 或完整迁移验收。当前桌面与其已有 stdio 任务未重启、重配或迁移。

## 入口和电脑配置

构建：`cargo build --locked --manifest-path desktop/core/Cargo.toml --bin agentdeck-codex-proxy`。主 Bridge 的默认 cargo run 入口仍为 agentdeck-service；此开发程序尚未加入发布包，也不自动修改桌面设置。

程序从**与自身同目录、同文件名的 .json 文件**读取配置。例如程序为 agentdeck-codex-proxy.exe，配置为 agentdeck-codex-proxy.json。配置最大 64 KiB，formatVersion 必须为 1，未知字段拒绝，原生程序/令牌文件必须使用绝对路径；不能将 nativeExecutable 指向转接本身。示例为占位路径，不是本机已配置服务：

```json
{
  "formatVersion": 1,
  "nativeExecutable": "C:/path/to/native/codex.exe",
  "endpoint": "ws://127.0.0.1:12345/",
  "tokenFile": "C:/path/to/private/capability-token",
  "protocolVersion": "0.163.0-alpha.10.2"
}
```

endpoint 沿用精确回环 IP、显式端口、根路径校验，禁止 userinfo/query/远程主机；tokenFile 沿用有界 base64url 文件读取。电脑管理员负责文件和目录权限。配置中没有 inline token 字段，令牌内容不放入参数、环境变量、URL、状态事件或 stderr；此路径不需要开启 Basic 适配层或设置 CODEX_APP_SERVER_WS_URL。每个新进程重新读取配置和令牌，不在安卓保存电脑令牌。

安装版 CODEX_CLI_PATH 接受不含凭据的可执行文件路径，但目前**不要在生产桌面设置为本程序**：CLI 的其他命令、动态启动覆盖和全部宿主功能尚未对齐，GUI 也未验收。不得把转接路径填入 AGENTDECK_CODEX_EXE 来替代 boundary 检查所需的真实原生程序。

## 版本、参数和配置门槛

- `--version` / `-V` 调用 manifest 指定的原生程序核验精确版本后返回真实匹配版本，不伪造兼容。已知协议版本沿用运行时选择规则，真实验证目前覆盖安装版 0.163.0-alpha.10.2。
- 开发入口支持 app-server stdio 启动、`-c` / `--config` / `--config=...`、`--enable` / `--disable`、`--analytics-default-enabled`，以及可选 `--stdio` 或 `--listen stdio://`。最多 128 个参数、合计 32 KiB。配置值按 TOML 解析，解析失败按原 CLI 文档回退为原始字符串；只接收普通 dotted key。
- 覆盖先按顺序归并：后写父项替换先前 CLI 子项，后写子项更新父项（标量父项转为表），重复项取最后值；最终表与文件/默认配置深合并。核对所有指定字段的类型和值，允许保留未指定的基础字段；数组和标量仍完整相等。空表要求实际为表。原生表→数字碰撞的异常结构明确返回 PROXY_CONFIG_MISMATCH，不伪装成数字。不是完整 CLI 参数兼容实现。
- 原生特性开关在显式 -c 后应用，enable 先、disable 后，不按 argv 交错顺序；精确安装版已核验根参数与 app-server 参数组合。无法按 TOML 解析的值使用去除首尾空白的原始字符串；仅支持普通 dotted key。
- analytics 默认标志只在服务已有明确 enabled=true/false 时放行：遵守既有选择，不猜测隐式默认值，也不为了通过检查开启 analytics。
- 其他命令、子命令、开关及不支持的配置均失败；不将其交给另一个 app-server 兜底，不启动新原生执行服务，不忽略参数。stderr 只输出固定错误代码，不包含参数、路径、版本检查原始输出、上游错误正文或会话内容。

## 同连接配置核验与透传

转接只创建一个 Bearer 认证原生连接。第一条桌面消息必须是带原 ID 的 initialize；转发原请求，校验真实响应 schema 与 userAgent 版本。随后在**同一连接**注入唯一临时 ID 的只读 config/read，核对启动要求。初始化期间暂存原始消息语义，最多 256 条、16 MiB；自己的配置响应不传给桌面。只有门槛通过才按原顺序向桌面输出暂存内容；不通过时退出，排队的桌面任务尚未转发。不会伪造 initialize 响应或 initialized 通知。

通过后双向转发 JSON-RPC 对象，保留业务字段、ID、内容与顺序；JSON 序列化/JSONL 空白格式可规范化。只支持文本 RPC，单帧/行 8 MiB；首次读取、初始化门槛及写入有 15 秒边界，正常空闲读取不设超时；Ping/Pong 正常处理。LinesCodec 保留中途 UTF-8/半行，原生通知与 stdin 同时到达不会丢弃已读字节。stdin EOF 退出时只断开自身 socket，原生服务、任务与其他连接继续运行，不重试或重放结果未知的消息。

该配置门槛是初始化时快照核对，不是配置锁。初始化后并发配置变化、断线后的整个桌面恢复、审批归属、所有媒体/宿主能力仍需完整验证。此程序不覆盖 Bridge 的工作区授权、boundary 或审批检查；它也不负责复制现有桌面历史或把已运行 stdio 进程在线改为服务。

## 本轮证据和接手

`cargo test --locked --manifest-path desktop/core/Cargo.toml --test desktop_stdio` 覆盖表归并、指定字段/数组类型核对、兄弟字段保留、未知参数/analytics 拒绝、配置失败不泄露快照或放行排队任务、同连接检查、原生通知打断半个 UTF-8 字符时完整恢复、manifest 边界。

设置 AGENTDECK_DESKTOP_PROBE_EXE 后，显式运行同测试文件的 real_desktop_baseline_startup_override_semantics（--ignored）。14 组隔离 HOME 实验只读取配置，以合成 desktop.agentdeck_probe 字段核验原生结果和转接门槛：重复、父子先后、空表、标量/表冲突、特性优先级、跨根/子命令与原始字符串空白。不输出完整配置，不调用账户模型；其他版本需重新核验。

设置 AGENTDECK_DESKTOP_PROBE_EXE 为精确安装版原生程序，再执行 `cargo test --locked --manifest-path desktop/core/Cargo.toml --test runtime_websocket real_desktop_baseline_ -- --ignored --nocapture`。三项真实隔离检查均复制实际转接可执行文件到临时目录，写相邻 manifest，以与安装版默认相同的特性/analytics 参数启动子进程，验证版本、配置不符时 stdout 为空/固定 stderr、同线程读取、EOF 后退出和原连接继续可用。源服务在隔离目录显式设置 code_mode_host=true、analytics.enabled=false；不改变生产设置，不用账户模型；历史/活动检查使用本机合成模型。它们不是启动原版 GUI 的证据。

下一步：验证原版桌面的完整动态 CLI 参数、配置层与 CLI 工具调用；补必须委派的命令语义；准备相互隔离、可回退的原版 GUI 接入，再进行双端真实活动任务和全量 UI 基准验收。sharedDesktopRuntime 仍为 false，阶段 0 仍未通过。

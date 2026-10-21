# Codex 桌面技术基准与接入评估

采集日期：2026-10-21。此文件为阶段 0 的技术基准，尚不等于逐入口 UI/账户能力验收完成。

## 版本及传输证据

| 项目 | 实测值 | 来源/限制 |
| --- | --- | --- |
| Windows 包版本 | 26.1013.3656.0 | 正在运行的 ChatGPT.exe 所属 Codex 包及 AppxManifest Identity |
| Electron 应用版本 | 26.1013.31256 | 安装包 app.asar 的 package.json；与 Windows 包版本分别记录 |
| 桌面所用 CLI 路径版本 | codex-cli 0.163.0-alpha.10.2 | 正在运行的桌面子进程对应可执行文件的 --version |
| AgentDeck 固定版本 | 0.159.2 | 仓库 schema lock / codex 模块 |
| 桌面进程启动 | app-server，带 --analytics-default-enabled，无 --listen 参数 | 只提取进程参数中的已知标志，不保存完整命令行；CLI help 默认 stdio |
| Bridge 进程启动 | app-server --listen stdio:// | 独立实例，不是桌面运行时 |
| 默认 daemon | version 连接失败，Windows socket 10050 | 未启动/停止/重启 daemon，未开启 remote control；不能据此认定其他接入不可行 |

新版 CLI 提供 proxy --sock 和受认证 WebSocket listener 的帮助信息，但这不是当前桌面已暴露共享 endpoint 的证据。桌面包中存在远程连接路由及 SSH daemon 管理代码，仅作静态候选线索；没有修改已安装应用、注入代码或接管其 stdio。

补充静态证据：安装版 `application-network-startup-DB1VeU3v.js` 的本地 WebSocket URL 路由读取 `CODEX_APP_SERVER_WS_URL` 或 host 配置的 websocket_url；`CODEX_APP_SERVER_USE_LOCAL_DAEMON` 分支要求 platform != win32，因此 Windows 默认 daemon 探测失败不能作为此 URL 路由不可用的证据。WebSocket transport 默认握手 headers 为空，本地 URL 路由未见 capability token 的专用注入；后续适配必须解决认证，不能为了直连把共享服务暴露为未认证 LAN endpoint。尚未启动或重配原版桌面做运行验收。

## 双客户端原生运行时实验

新增 `scripts/check-shared-codex-runtime.mjs`，启动隔离 CODEX_HOME、临时项目和仅回环监听的 capability-token WebSocket 服务。默认只验证元数据，不执行模型轮次。`--synthetic-turn` 使用无账户、无密钥的本机合成 Responses provider；`--prime-turn` 可先创建轮次后再让第二客户端恢复。测试环境移除代理和账户 API key 变量，不读取用户历史或凭据，服务结束后删除测试 token。

```powershell
node scripts/check-shared-codex-runtime.mjs <绝对路径codex.exe> artifacts/parity-shared --synthetic-turn
# 0.159.2 空历史恢复有已复现问题；验证已有轮次共享使用：
node scripts/check-shared-codex-runtime.mjs <0.159.2可执行文件> artifacts/parity-pinned --synthetic-turn --prime-turn
```

0.163.0-alpha.10.2 实测通过 10 个检查：缺失/错误认证拒绝、第二客户端读取/恢复同一线程、双向修改可见、同一活动 turn 的 steer、双端收到权威 interrupted 终态、重连线程身份不变、双端名称通知。0.159.2 在先创建轮次后也通过相同检查。报告分别保存在 `baselines/codex-0.163.0-alpha.10.2/shared-runtime-synthetic-check.json` 与 `baselines/codex-0.159.2/shared-runtime-synthetic-check.json`。

0.159.2 空历史在设置名称后仍报 `invalid paginated history lineage ... missing source rollout`，失败报告单独保存。新版设置名称后可恢复。该差异禁止用新建替代线程掩盖；Bridge 现对丢失 rollout/lineage 明确报错并保留身份，初始标题写入真实上游。

这些是**真实原生运行时＋合成模型**的协议实验，证明共享服务可行，不是原版桌面、安卓、真实模型或账户能力验收。下一步实现认证本机适配及原版桌面连接验证；仍不得将 capabilities.sharedDesktopRuntime 设为 true。

## 可复现协议审计

```powershell
node scripts/audit-codex-protocol.mjs <Codex可执行文件绝对路径> artifacts/parity-baseline
```

脚本仅运行 --version 与 generate-json-schema（稳定/实验），写独立临时导出及指定报告目录，不覆盖生产 schema lock，不启动模型任务。运行时不要求提供登录数据。已审阅报告保存在 `baselines/codex-0.163.0-alpha.10.2/protocol-audit.json`。

实测稳定导出 105 个请求方法、318 个 schema；相对固定稳定导出新增 4 个文件、35 个文件内容变化、无删除。实验导出 172 个请求方法、452 个 schema，相对固定**稳定**导出新增 138 个文件、46 个文件内容变化。因此实验差异同时包含实验表面，不能全部解释为跨版本新增。内容比较忽略 JSON 空白，不作语义兼容性判定。

只有 1 个稳定请求方法新增，不表示协议兼容：参数、响应和通知 schema 仍有变化。禁止直接拿新版运行时套旧 schema 并忽略验证错误。

## 能力域到候选接口

### 逐合约版本差异（2026-10-21）

`protocol-contract-differences.json` 记录安装版相对固定稳定导出的逐方法合约、传递引用和 JSON Pointer 差异。覆盖客户端请求、服务端请求、通知及所有目录的 Response schema（含 initialize/旧版响应）。大于 2048 JSON 字符的变更值保留规范化 SHA-256 和字节数，完整值可重新导出检查。文档字段变化也计入 changed，不直接判定破坏兼容。

| 稳定合约域 | 安装版总数 | 新增 | 变化 | 不变 |
| --- | --- | --- | --- | --- |
| 客户端请求 | 105 | 1 | 4 | 100 |
| 服务端请求 | 10 | 0 | 0 | 10 |
| 服务端通知 | 85 | 2 | 7 | 76 |
| Response schema | 115 | 1 | 18 | 96 |

已定位的迁移关注点：

- `thread/goal/set`、`clear` 新增 origin，区分 user/automatic；schema 明确缺少来源不能提供用户授权。接入新版时必须按实际触发来源映射，不能统一填 user。
- `thread/list` 新增 excludedThreadIds，分页时保持相同排除集合；`turn/start` 增加 parentTurnId/rootTurnId，涉及派生工作归因。
- 新增 `thread/attachmentOwner/list`、`thread/prediction/updated`、`thread/readState/changed`，现有安卓没有对应处理。
- ThreadItem、MessagePhase、CodexErrorInfo 及 Turn.rootTurnId 变化会传递到历史读取、恢复、列表、轮次和 item 通知。不能只更换握手版本检查。
- MCP OAuth 响应/通知增加 loginId；模型能力响应移除旧版必需 namespaceTools；Skills 路径和浏览器扩展 requirements 有变化。ModelListResponse 的变化仅为描述字段，不能把所有 changed 等同破坏兼容。

真实固定 CLI 0.159.2 再导出与仓库稳定基准比较：上述四域均零变化，作为审计工具对照。实验导出仍相对**固定稳定**基准，新增不等同跨版本新增。以上是静态合约证据；生产版本/schema、权限配置和桌面连接仍未切换，行为兼容待真实验证。

“候选”表示本机导出存在，不表示已通过账户授权、实际调用、双端同步或安卓验收。

| 条目 | 桌面能力/安卓对应目标 | 导出候选接口或服务适配 | 当前状态与完成所需证据 |
| --- | --- | --- | --- |
| P01.1 | 同一活动任务双端查看和操作 | desktop stdio；已验证 authenticated WS 原生服务；桌面 WS URL 路由 | 协议双客户端实测通过；原版桌面认证连接适配与真机尚未验证 |
| P02.1 | 项目组织与排序 | 实验 project/list/read/update/move/import；稳定 threadSection/* | 接口候选；需核验桌面侧栏采用的数据源和操作语义 |
| P03.1 | 全部历史/归档/派生关系 | thread/list/read/turns/list/items/list；实验 timeline/list、search | Bridge 尚未导入；需分页、来源/派生关系及外部变更测试 |
| P03.2 | 完整输出按需读取 | 实验 thread/items/read；稳定 items/list | 候选；需检查超大内容、项标识和稳定完整读取能力 |
| P04.1 | 分叉/编辑重发/重试 | thread/fork/revert；turn/start | 候选；编辑/重试语义须与桌面核对，不默认删除或覆盖历史 |
| P04.2 | 运行中追加与排队 | 稳定 turn/steer；实验 thread/queue/* | 候选；需并发版本、顺序、恢复及双端同步证据 |
| P05.1 | 模型/权限/执行模式 | model/list、permissionProfile/list；实验 collaborationMode/list、thread/settings/update | 现有部分实现；需完整配置、权限与账户映射 |
| P06.1 | 全部消息/工具/计划/交互 | ServerNotification、ServerRequest、各项内容 schema | 尚未逐类型映射；需加入通知/服务端请求清单及显示验收 |
| P07.1 | 文件浏览/编辑/搜索/附件 | fs/*、fuzzyFileSearch、thread/attachment/* | 候选；路径授权、写冲突、媒体传输及完整性待实现 |
| P08.1 | 审查/评论/任务改动 | review/start、文件变化事件；受控 Git 服务 | 只读 working-tree 视图已有；任务归因和评论语义待对齐 |
| P09.1 | Git/工作树/PR | 电脑侧受控 Git/托管平台适配 | 请求清单无可直接替代全工作流的 Git API；需核验桌面宿主实现与凭据边界 |
| P10.1 | 持续终端 | 稳定 command/exec/write/resize/terminate；实验 process/*、backgroundTerminals/* | 候选；持久会话/所有权/断线恢复和真实 PTY 验证待做 |
| P11.1 | 浏览器与任务关联 | 桌面宿主/浏览器服务适配 | 未发现可凭请求名确认的完整浏览器 API；需桌面宿主接口核验 |
| P12.1 | Skills/插件/MCP/hooks | skills/*、plugin/*、marketplace/*、mcpServer/*、hooks/list | 候选；Bridge 当前策略限制，不能无条件打开 |
| P13.1 | 自动化/心跳/结果 | 桌面电脑调度服务适配 | 未发现独立 automation 请求族；必须核验宿主调度与离线生命周期 |
| P14.1 | 账户/额度/配置/实验 | account/read/rateLimits/read/usage/read、config/*、experimentalFeature/* | 候选；认证留电脑，不传递令牌；需逐入口配置核验 |
| P15.1 | 语音与实时 | 实验 thread/realtime/* | 候选；编解码、设备权限、会话归属及账户可用性未验 |
| P16.1 | 异地连接/设备管理 | 实验 remoteControl/*；私有网络与 WSS | 不启用上游远程控制就不声称已支持；需配对撤销、TLS 和网络恢复证据 |
| P17.1 | 页面/菜单/快捷键/视觉 | 原生 Compose 对应界面 | 安装包包含相关界面资产；尚未做可见 UI 全量盘点与截图验收 |

## 已确认的数据身份风险

现有恢复逻辑在 writer-conflict 时曾自动 thread/fork 并替换绑定。已改为返回 THREAD_IN_USE，保留原 ID；fixture 覆盖有/无完成历史两种情况，不再以自动副本冒充继续原会话。真正共享写入仍需 P01.1 解阻。

## 阶段 0 尚未完成的验收

### 2026-10-21 本地认证适配增量

只读检查安装包 `application-network-startup-DB1VeU3v.js` 和 `main-C4DYk222.js`：本地 URL 路由的握手 headers 默认为空；云端特殊 host 才使用账户认证握手，不能挪用账户 token。其 Node ws 构造器接受 URL userinfo 的 Basic 认证。新增默认关闭的 Rust 回环 Basic → Bearer 适配，具体配置、验证和接手限制见 [本机认证适配](CODEX_DESKTOP_ADAPTER.md)。

ws 8.21.0 对应构造参数的 fixture，以及精确安装版真实隔离服务的 initialize/原 threadId 读取已验证；不是原版 GUI 运行证据。桌面 URL 日志与环境继承的凭据保护仍需审计，当前未重启、重配或启动原版 GUI；完整共享能力保持 false。

后续只读审计确认：`buildTerminalEnv` 默认继承 process.env，`Ct` 只移除崩溃报告变量，使用合成标记运行原纯函数后仍保留 CODEX_APP_SERVER_WS_URL；工作树环境错误存在直接继承回退。因此环境变量认证 URL 不能批准为生产接入。适配现强制使用独立令牌文件，不再接受原生服务令牌；此隔离不等于解决继承暴露。可重现脚本、指纹报告和下一步见本机认证适配文档，原版 GUI 仍未验收。

继续核验：CODEX_CLI_PATH 可覆盖 CLI，但桌面会附加配置及 analytics 启动参数，不能直接替换成任意代理。原生 Unix listener 与原生 app-server proxy 在隔离 Windows 上实测握手不兼容：listener 要求 WebSocket，proxy 转发原始 stdio；不兼容报告和复现参数见本机适配文档。这不代表 Windows 不支持 AF_UNIX，也不等于所有 daemon 路径不可用。下一步实现受控 stdio→认证 WS 转接时必须完整核验启动配置，不丢弃 `-c` 或偷偷另起服务；原版桌面与共享运行时仍未验收。

新增 stdio 开发转接程序已通过精确安装版真实子进程验证：凭据只从电脑文件读取，真实原生版本、同连接 config/read 校验、默认特性/analytics 启动参数、同一线程读取、配置不符拒绝和 EOF 连接隔离。配置与限制见 [stdio 转接](CODEX_DESKTOP_STDIO.md)。重复/重叠覆盖已按真实安装版合并实验实现；其他 CLI 命令当前显式拒绝，未运行原版 GUI，sharedDesktopRuntime 仍 false，不能作为阶段 0 完成依据。

安装代码纯参数构造函数已用合成环境执行（不是读取真实环境）：默认/空白覆盖保留 -c features.code_mode_host=true 在 app-server 前；CODEX_APP_SERVER_CHATGPT_BASE_URL 与 CODEX_APP_SERVER_OPENAI_BASE_URL 非空时，app-server 移到首项，随后为特性和 JSON 字符串地址覆盖，末尾保留 analytics 默认标志。真实安装版隔离 config/read 验证该组合及转接门槛通过，错误地址仍拒绝。可复现脚本及指纹见 desktop-ws-environment-audit.json。

新增明确待验项：Windows 本地启动使用 source!==override 等条件启用 windows_sandbox_service，且不满足对应分支时移除 CODEX_WINDOWS_REGISTERED_CORE。因此 CODEX_CLI_PATH 替换还会改变原版启动语义；不能以 stdio 或地址覆盖检查通过推断沙箱等价，更不能为求启动而强行开启该特性。云端隧道代码另有原生 tcp-tunnel --help 能力探测和带 --auth-token-stdin/--auth-token-updates-stdin 的子进程；这证明存在原生辅助程序依赖，但尚未证明打包版该解析器会选中转接路径，也未运行隧道。后续应核验各解析路径、沙箱和宿主环境，再决定具体委派集合，不盲目委派所有命令或另起 app-server。

1. 可见页面、菜单、快捷键和账户/实验入口逐项盘点，不把资产文件名当作实际可用入口。
2. 找到桌面真正支持的共享接入方式，或对每种候选路径给出可复核阻塞结论。
3. 同一活动任务双端操作实验（隔离线程），以及参数/响应/通知 schema 兼容评估。
4. 明确浏览器、自动化、Git/工作树等宿主能力的接入路径。存在方法名不能代替此项。

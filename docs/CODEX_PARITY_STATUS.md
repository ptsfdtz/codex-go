# 完整迁移开发状态与接手记录

最后更新：2026-10-21。


## 2026-10-21 实施记录：独立原生项目广播与反向更新通过（阶段 0 / P01）

- 前一轮提交 98fa4d4。本轮扩展 --with-native-project 为两条独立认证原生连接：第二连接独立初始化且不排除项目通知，先核验同一项目；源重命名后观察外部 updated 事件并重新读取，再由第二客户端写入、源连接重新读取。第二客户端开始自身写入后不再给外部事件检查记分，避免把自身通知当作跨客户端广播。请求 ID 全局唯一，pending 按连接隔离且退出时一并清理。
- 真实 desktop-gui-project-peer-probe.json：peerInitializedWithoutProjectOptOut、peerReadOriginalSeedProject、peerReceivedExternalProjectChanged、peerReadUpdatedSeedProject、sourceReadPeerProjectUpdate 全部 true。确认安装版隔离源原生项目可广播到非写入连接并双向修改同一对象，不再把“只通知写入者”作为当前结论。第二客户端只是原生协议检查，不冒充安卓/已配对 Bridge。
- GUI 仍主动排除 project/changed，通知和新名称读取仍 false，因此整体 passed=false，UI/宿主集成/完整共享状态不升级；本次未启用严格历史门槛。源/GUI 既有项目身份和线程归属继续通过，子进程退出、固定代理错误码为空，另查隔离 GUI/runtime/proxy 剩余 0。测试模型为回环合成服务，未改动生产桌面、账户或私有数据库。
- 验证：真实三方实验完成，脚本 ESLint/Prettier、相关 diff 检查通过。无 Rust、安卓、协议或数据库变更，不重复无关构建。架构文档持久化原生项目同步与桌面宿主缓存/发布必须分别适配的结论。
- 阶段 0/sharedDesktopRuntime 仍未完成。下一步核验宿主 projectBackend/publishProjects 的受支持接入与生命周期；原生目录/身份/事件可用于后续远程底座，但不能据此跳过桌面项目可见性和完整导航/历史验收。本轮选择性提交相关代码、真实证据和接手文档，保留独立 CI/发布改动，不推送。

## 2026-10-21 实施记录：项目归属、幂等与 GUI 主动排除变更通知（阶段 0 / P01）

- 前一轮提交 516868c。通过精确安装版在隔离 HOME 导出实验 schema，核验项目创建/更新参数、持久线程 projectId 及 project/changed 的 updated 枚举；未改动生产 schema lock。本轮扩展 --with-native-project：重复创建核验同 ID，首轮历史持久化后读取源线程归属，再核验 GUI 自己读取的归属；源重命名并重新读取后，分别检查 GUI 通知和新名称。只在本次重命名开始后计入事件。
- 真实 desktop-gui-project-lifecycle-probe.json：创建幂等、源/GUI 同线程项目归属、源更新持久化均 true；源更新连接收到 project/changed，GUI 没有该通知，也未重新读到新名称，整体 passed=false。最终项目实验没有启用 --shared-history，之前历史负面报告保留；不得把未启用的历史检查计入项目失败。子进程退出，无代理错误码，另查隔离 GUI/runtime/proxy 剩余 0。
- 关键新证据：desktopOptedOutProjectChanged=true，至少一个 GUI 连接的真实 initialize.capabilities.optOutNotificationMethods 明确包含 project/changed。安装代码 src-DsLVGakC.js 的 initialize 使用公共排除表，src-Dtwb7yKT.js 把该方法标 false。不能把缺失通知概括为服务端没有事件；尚未验证第二个未排除客户端的跨连接广播，也未证明所有 GUI 连接订阅。项目活动更新必须继续核验桌面宿主缓存/发布入口，不能删除 GUI 排除项或伪造事件来制造通过。
- 开发期间一次过早 thread/read 未通过，最终改为首轮合成历史持久化后验证；未把该前置失败作为原生归属不支持的证据。最终真实运行验证已包含该顺序。ESLint/Prettier、相关 diff 检查通过；无 Rust、安卓、协议或数据库变更，不重复不相关构建。
- 阶段 0/sharedDesktopRuntime 仍未完成。下一步核验独立原生客户端项目广播、宿主 projectBackend/publishProjects 的受支持调用，以及导航/完整历史和双向活动任务。可见侧栏与安卓真机仍未验收。本轮选择性提交实现、真实证据和接手文档，保留独立 CI/发布改动，不推送。

## 2026-10-21 实施记录：原生项目与 GUI 同源列表验证（阶段 0 / P01）

- 前一轮提交 7e68398。本轮只读安装代码定位 writeAppServerProject/listProjects/initializeProjects：桌面使用原生 project/create/list/read/update/import 并维护 legacy ID 映射；projects 最低原生版本为 0.148.0-alpha.21。不能继续把线程 cwd 或 Bridge 的目录列表等同桌面项目组织。
- 新增 --with-native-project（要求 --shared-index）：通过隔离源服务 project/create 创建真实项目并核验源列表，在 thread/start 传入 projectId，观察 GUI 自己的项目列表。没有写入私有数据库/global-state 或首次设置标志；线程归属响应尚未核验，不凭发送参数宣称归属通过。
- 真实 desktop-gui-native-project-probe.json：sourceListedSeedProject、desktopRequestedProjects、desktopListedSeedProject 均 true，原项目 ID 在 GUI 自身响应可见；源完整历史、同线程元数据/列表及外部重命名继续通过。GUI 仍未请求完整历史，两项原文 false，整体 passed=false，无代理错误码，子进程退出，另查隔离 GUI/runtime/proxy 剩余 0。加入原生项目没有解决历史导航，不把列表成功升级为可见 UI/工作区或共享运行时验收。
- 验证：真实隔离原生项目/GUI 检查已完成，选项依赖在启动前拒绝检查、脚本 ESLint/Prettier、相关 diff 检查通过。无 Rust、安卓、远程协议或数据库变更，不重复不相关测试。
- 阶段 0/sharedDesktopRuntime 仍未完成。下一步分别建模原生项目身份与桌面本机导航偏好，继续核验首次设置/深链接延续路径、线程归属与双向项目操作，再验证完整 GUI 历史和活动任务。本轮选择性提交相关实现、真实正负证据和文档，不混入独立 CI/发布修改，不推送。

## 2026-10-21 实施记录：源历史交叉核验及首次启动路由实证（阶段 0 / P01）

- 前一轮提交 e224802。本轮 GUI 探测在启动桌面前调用源 thread/items/list，要求原线程/轮次的完整用户输入和助手回复均匹配；缺失即失败。真实更新报告 sourceRetainsExactSeedInput/sourceRetainsExactSeedAnswer 均 true；GUI 仍未请求含轮次读取或 turns/items 分页，原文检查 false，整体 passed=false。排除了源合成历史未保存这一原因，不把元数据读取升级为历史加载。
- 新增 audit-desktop-onboarding.mjs：只读安装 ASAR，严格匹配已知纯路由函数并在 VM 中运行合成状态，保存文件 SHA-256/字符偏移与固定结果。10 组检查确认本地 allowed 状态的工作区/完成状态影响 welcome/app 选择，而登录、缺 token、gateway 登录要求仍优先。没有执行 bundle、读写生产 profile/账户、调用首次设置 API 或伪造完成标志。supportedFixtureSetupVerified/guiAcceptance 仍 false，源码条件不等于实际 GUI 状态。
- 验证：3 项历史判定回归、10 组安装代码纯函数实验、脚本 ESLint/Prettier 与相关 diff 检查通过；真实 GUI 严格历史检查按证据失败，子进程已退出，另查无测试路径进程残留。无 Rust、安卓、协议或数据库变更，不重复不相关构建。
- 阶段 0/sharedDesktopRuntime 仍未完成。下一步定位桌面工作区根目录的受支持设置接口及首次设置后的深链接延续方式，再验证真实 GUI 完整历史和双向活动任务；原生线程 cwd 不能等同桌面已配置工作区。仍需宿主集成、生产保留历史升级及安卓真机验收。本轮选择性提交实现、正负证据和接手文档，保留其他 CI/发布修改，不推送。

## 2026-10-21 实施记录：GUI 完整历史严格检查与未请求证据（阶段 0 / P01）

- 前一轮提交 80be7d2。本轮新增 --shared-history（要求 --shared-index），通过条件必须包含 GUI 自身请求得到的同线程、同轮次完整用户输入及助手回复；不注入 GUI 请求，不用直接客户端或列表元数据代替内容。覆盖 read/resume 内嵌历史及 turns/items 分页，关联原请求 threadId 与响应轮次，只保存固定布尔值。
- 新增独立内容判定模块和 3 项回归，覆盖不同线程/轮次、错误响应身份、元数据、原文片段、错误回复和两类分页。ESLint、Prettier、相关 diff 检查及选项依赖拒绝检查通过；无 Rust、安卓、远程协议或数据库变更。
- 两次真实隔离检查均未取得完整原文；最终带固定请求诊断的 desktop-gui-history-probe.json passed=false：原线程读取、GUI 列表及外部重命名仍通过，但原文两项 false，GUI 未请求该线程 includeTurns=true 或 turns/items 分页。没有代理失败码，子进程退出，另查无测试路径进程残留。不把“没有请求”解释为历史接口失败，也不把元数据成功升级为历史验收。模型为隔离回环合成服务，未使用账户或修改生产桌面。
- 阶段 0/sharedDesktopRuntime 仍未完成。下一步交叉核验源合成历史并核验首次设置/深链接导航的受支持测试路径，继续 GUI 内容、双向活动任务和宿主集成；可见 UI 与安卓仍未验收。本轮选择性提交相关代码、回归、负面证据和接手文档，不混入独立 CI/发布修改，不推送。

## 2026-10-21 实施记录：限时 GUI 检查与同线程读取证据（阶段 0 / P01）

- 前一轮提交 9dee0d9。本轮增加 --inspection-seconds=5..300 的有界独立实例保留选项，默认无等待；严格拒绝重复、额外等号、空值、小数、科学计数法和范围外值，结束后仍执行原有清理，不自动操作 UI。
- 真实安装版隔离运行保存 desktop-gui-inspection-probe.json：passed=true，首次 desktopOpenedSeededThread=true，即 GUI 自身 thread/read 或 thread/resume 成功响应包含另一原生客户端创建的同一线程 ID；源索引、GUI 列表及外部重命名事件仍通过，固定代理诊断为空，子进程退出。另查未见本次临时路径进程残留。合成模型不使用账户，生产桌面未修改。
- 只读窗口观察显示首次职业/个性化设置页，未点击、输入或代填选择。该可见页面没有阻止后台读取成功；不应将它解释为协议读取失败，也不能将后台响应解释为内容已展示。完整历史内容、渲染、双向活动任务、宿主集成与安卓真机仍未验收，mainAppBootstrapVerified/visualAcceptance/hostIntegrationVerified 仍 false。
- 验证：真实 GUI 探测正常结束并清理；10 项参数边界/拒绝检查通过且未启动 GUI；脚本 ESLint、Prettier 与相关 diff 检查通过。无 Rust、安卓、协议或数据库变更，不重复不相关测试。
- 阶段 0/sharedDesktopRuntime 仍未完成。下一步核验受支持的独立首次启动测试路径、完整内容及双向操作，不复制生产配置/私有数据库或代替用户作隐私选择。本轮只选择性提交探测实现、真实报告与接手文档，不混入 CI/发布修改，不推送。

## 2026-10-21 实施记录：插件启动配置诊断与 GUI 同源索引通过（阶段 0 / P01）

- 前一轮 `b6d484d` 为实际进展。本轮增加固定启动诊断，保留 PROXY_CONFIG_MISMATCH 拒绝语义，只输出 MCP/PLUGINS/FEATURES/OTHER 与 MISSING/TYPE/VALUE 的固定分类，不输出键、值、路径或任意 message；首项不一致不是全量差异。回归覆盖分类、父路径类型、陌生错误消息不回显、缺失仍拒绝及原有配置失败不放行排队任务。
- 真实无插件启动配置探测确认 PROXY_STARTUP_PLUGINS_MISSING。新增第 20 组原生实验，断言 App Tools 插件 MCP 开关同时存在于有效 config 和 sessionFlags 且同值门槛通过，排除接口隐藏字段。只读安装代码定位主连接 yc/C$e 的 App Tools/Code Review 插件开关与可用性条件，不读取生产环境或账户值。
- 新增显式 --with-desktop-plugin-startup（仅配合 --shared-index）：校验安装代码已知键，向全新隔离源服务追加两项 enabled=true；GUI 自己计算覆盖，转接继续严格核对。没有自动改写源服务配置、忽略参数或关闭集成。新的 desktop-gui-shared-index-plugin-startup-probe.json passed=true：GUI 自身列表响应含另一原生客户端创建的同一线程 ID，连接上观察到该线程外部重命名事件，代理错误码为空，子进程退出且另查无隔离路径进程残留。旧失败报告保留并增加固定诊断。
- 证据限制：本轮没有 GUI read/resume 打开成功证据，也没有内容渲染、UI 名称刷新、反向操作、真实插件工具、宿主 pipe/环境、活动任务或安卓/已配对 Bridge 验收；mainAppBootstrapVerified 与 hostIntegrationVerified 仍 false。测试模型仅为隔离回环合成服务，不使用账户模型。该启动选项不是通用握手或生产部署方式，不能据此把完整共享标记 true。
- 验证：stdio 8 项常规回归及含 20 组真实安装版配置的显式实验通过（9 测试、5.60 秒）；3 项真实运行时/实际代理历史及追加/中断检查继续通过（15.25 秒），包括更新后的固定诊断 stderr/空 stdout 断言。严格 Clippy、fmt、脚本 ESLint/Prettier 通过，无安卓/远程协议/数据库变更。
- 阶段 0/sharedDesktopRuntime 仍未完成。下一步验证真实 GUI 打开/内容和双向活动任务，并核验宿主集成对共享服务的配置与生命周期；本轮只提交相关实现、回归、正负证据和文档，不混入独立 CI/发布修改，不推送。

## 2026-10-21 实施记录：GUI 主连接动态配置拒绝与字面键修复（阶段 0 / P01）

- 前一轮 `3ef8ab4` 为实际进展；本轮扩展真实 GUI 探测为 --shared-index。独立原生客户端在全新目录通过回环合成模型完成一轮并核验源 thread/list 含原 ID，GUI 使用已核验的 codex://threads/<id> 初始参数打开目标，再从另一客户端重命名。额外通过条件要求 GUI 自身列表响应含相同 ID、连接收到相同 ID/名称的通知，不以原生客户端成功冒充 GUI。
- 新证据纠正接入范围：前置策略连接 initialize/config/read/initialized 可成功，但 GUI 主连接的额外启动覆盖被普通键限制拒绝。原生实验证明 @、Unicode、引号均为字面字符，连引号内的点也分段；修复转接键解析，新增固定 PROXY_CONFIG_KEY_UNSUPPORTED，仍拒绝空段/控制字符，不解码/丢弃键或参数。
- 最终真实扩展报告 passed=false：源合成任务完成且索引可见；GUI 前置连接成功，但无 GUI 索引、打开、外部重命名成功证据。修复键解析后，主连接仍 PROXY_CONFIG_MISMATCH，独立 GUI 日志明确主应用 bootstrap 失败。报告仅从本次全新 profile 有界提取固定错误码/布尔值，不保存原始日志、线程 ID、内容、凭据。mainAppBootstrapVerified=false；前一轮传输报告不能解释为主应用已可用。具体不一致覆盖字段尚未采集核验。
- 验证：stdio 7 项常规回归和 1 项含 19 组真实安装版配置实验全部通过（8 测试、6.08 秒），严格 Clippy、fmt、脚本 ESLint/Prettier 通过；真实扩展按预期退出 1 并保留失败报告。模型仅为隔离回环合成服务，未使用账户或更改当前桌面；无安卓/远程协议/数据库变更。
- 阶段 0/sharedDesktopRuntime 仍未完成。下一步核验主连接动态覆盖及与权威服务、宿主集成的一致接入路径，再验证同源会话/任务。不忽略覆盖、写入真实共享设置、关闭集成或另起副本来使测试通过。本轮选择性提交实现、回归、负面证据与文档，不混入独立 CI/发布修改，不推送。

## 2026-10-21 实施记录：真实原版 GUI 隔离接通与版本前缀修复（阶段 0 / P01）

- 前一轮 `832655c` 为实际进展。本轮首次运行真实安装版 GUI 的独立传输探测；先只读校验 bootstrap 独立 userData 在单实例锁之前设置，再创建全新 CODEX_HOME/Electron/Windows profile/AppData，子进程仅继承必要系统环境。未复制历史/登录、未重配当前桌面、未发送任务或调用模型。认证观察器只记录布尔检查点，不保存请求内容或凭据。
- 真实 GUI 揭示转接程序硬编码 Codex Desktop/ 前缀会误拒绝正确原生版本；修复为非空 originator + 精确版本及分隔符，保持原生 schema/认证/可执行程序版本门槛。新增错误版本、相似版本后缀、空 originator、缺少分隔符的拒绝回归，确认不释放初始化响应或转发排队任务。开发观察器曾误转为二进制帧，已修正；该错误前的失败不作为原生不兼容证据。
- 最终真实探测 passed=true：原生认证监听、带桌面 override 环境的代理版本、GUI initialize 请求/成功响应、精确版本、同连接 config/read、GUI initialized 通知、GUI 保持运行全部成立；旧硬编码前缀检查为 false，与修复原因一致。两个直接子进程退出确认，另查无本轮临时路径对应的 GUI/原生/代理进程残留。报告保留 bootstrap 指纹，无原始日志或令牌。脚本只清理自身 PID 树及新令牌/manifest。
- 验证：stdio 6 项常规测试通过（1 个显式配置实验默认 ignored）；原有 3 项真实安装版隔离运行时检查继续通过（15.17 秒），包含实际代理、同线程历史和追加/中断，本机合成模型不使用账户。严格 Clippy、Rust fmt、脚本 ESLint/Prettier 与相关 diff 检查通过，原生代理 build 成功。新增 GUI 探测与接手文档，更新桌面基准和 stdio 状态；无安卓/协议/数据库变更。
- 阶段 0/sharedDesktopRuntime 仍未完成。传输接通没有证明可见 UI、真实共享会话/活动任务、审批、登录、沙箱/宿主能力、重连或安卓真机。下一步在真实 GUI 接通基础上验证同源会话/任务与远程操作，再补完整基准；不再把“尚未运行 GUI”作为当前传输结论。本轮只提交相关实现、回归、探测证据和文档，不混入独立 CI/发布修改，不推送。

## 2026-10-21 实施记录：动态桌面启动参数与沙箱分支核验（阶段 0 / P01）

- 前一轮 `37cd238` 为实际进展。本轮扩充安装代码审计：严格匹配参数构造纯函数，在 VM 中只传合成环境，核验默认、空白、双 API 地址三组参数的顺序、JSON 字符串编码与 analytics 标志。不执行整个 bundle、不读取真实地址或凭据；未知布局失败。报告保留原文件 SHA-256、参数函数偏移及合成结果。
- 安装版真实隔离配置实验增加桌面双地址组合，核验 config/read 实际值与 Startup 门槛；错误地址仍 PROXY_CONFIG_MISMATCH。stdio 5 项常规回归与包含 15 组配置的显式真实实验通过（共 6 个测试，4.78 秒），严格 Clippy、fmt、脚本 ESLint/Prettier 通过。无生产实现或安卓变更，不重复此前已通过的全套构建。
- 新证据改变后续接入条件：CLI override 会避开 Windows 注册核心/沙箱服务的部分启动分支；已有配置门槛不能证明该宿主语义等价。另定位原生 tcp-tunnel 的 help 探测及通过 stdin 更新令牌的辅助进程，但打包版是否使用 override 解析路径尚未证明，故不盲目加入委派或另起服务。
- 更新桌面基准与 stdio 接手说明，修正基准中“重叠覆盖仍拒绝”的过时描述。阶段 0/sharedDesktopRuntime 仍未完成；没有重启或重配当前桌面，没有账户模型、隧道或 GUI/真机验收。下一步核验 Windows 核心/沙箱及辅助解析器，准备可回退的独立 GUI 接入。本轮只提交相关测试、脚本、证据和文档，不混入独立 CI/发布修改，不推送。

## 2026-10-21 实施记录：安装版 CLI 覆盖归并实证（阶段 0 / P01）

- 前一轮提交 `01cbdd4` 为实际进展。本轮修复 stdio 转接启动校验误拒绝：按顺序构建 CLI 覆盖表，父项替换先前子项，子项更新父项；最终表允许原生保留文件/默认字段，数组、标量及指定字段仍严格核对。特性 enable/disable 在显式配置之后分组应用；原始字符串回退去除首尾空白。
- 精确安装版 0.163.0-alpha.10.2 的 14 组隔离配置实验通过，明确断言合成字段结果并调用实际 Startup 门槛；覆盖重复、父子先后、空表、标量转表、表转数字、特性顺序、根/子命令组合与空白。表转数字的原生异常结构仍明确拒绝，不隐藏类型差异。只读隔离 HOME 配置，无账户模型、完整配置输出或原版桌面重配。
- 验证：常规 65 项 Rust 回归通过（9 lib、36 native、5 协议、6 WS、4 Basic、5 stdio）；14 组真实配置实验通过，另 3 项真实隔离运行时检查通过（17.78 秒），涵盖实际代理子进程、配置门槛、相同线程读取、历史和追加/中断；模型仍为本机合成服务。严格 Clippy、fmt、相关 diff 检查通过。无安卓或协议变更，不重复安卓构建。
- 阶段 0/sharedDesktopRuntime 仍未完成：其他 CLI 委派、完整动态参数与配置层、原版 GUI 安全启动/恢复、审批归属和安卓真机仍需验收。初始化门槛不是配置锁。下一步继续核验原版桌面 CLI 调用与可回退 GUI 接入，本轮选择性提交相关代码、回归和文档，不混入独立 CI/发布修改，不推送。


## 2026-10-21 实施记录：凭据文件驱动的同连接 stdio 转接（阶段 0 / P01）

- 前一轮提交 `61fae7d` 为实际进展。本轮实现独立开发程序 agentdeck-codex-proxy，使用相邻同名 JSON manifest（64 KiB、严格字段、绝对本机路径、精确已知协议、拒绝自身版本委派），从电脑文件读取原生 token。没有 token URL、inline credential、凭据参数/环境变量或自动启用桌面设置；不依赖 Basic 适配。固定诊断仅输出错误代码。
- --version 核验指定真实原生程序后返回匹配版本；app-server 首消息必须为真实 initialize，使用桌面原请求/原 ID 和同一 Bearer socket 校验响应 schema/userAgent，再以唯一内部 ID 执行只读 config/read。启动覆盖按 TOML 类型/整表检查共享配置；analytics 默认标志要求既有明确 opt-in/out，不开启 analytics。配置不符不会放行后续输入，不伪造 initialized，不另起执行服务或分叉任务。
- 支持开发所需 stdio、普通 dotted -c/--config、enable/disable 及 analytics 参数；重复/重叠覆盖、其他命令/子命令/不支持开关明确失败，不能称为完整 CLI 替代。初始化暂存最多 256 条/16 MiB，自己的配置响应不传桌面；8 MiB 行/帧和有界握手/写入，LinesCodec 保留通知打断时的半行/UTF-8。EOF 只关闭当前连接，不结束原生服务、其他连接或任务，不重试未知结果。
- 新增 toml 固定依赖及 core Cargo.lock；主服务 default-run 保持 agentdeck-service。无安卓协议、Room、服务数据库迁移或生产打包变更。新增 CODEX_DESKTOP_STDIO.md，更新适配和桌面基准接手说明；当前生产桌面未重配，不能将新程序直接当作已验收 CLI。
- 验证：9 单元 + 36 native + 5 协议版本 + 6 WS fixture + 4 Basic 适配 + 4 stdio 回归通过（5 项显式检查默认 ignored）；严格 Clippy、fmt/diff 通过。新增检查包括 TOML 整表/类型、未知参数与隐式 analytics、manifest 边界、配置失败不泄露快照或转发排队任务、同连接校验及半个 UTF-8 字符时交错原生通知完整还原；这些是 fixture 证据，不冒充 GUI。
- 精确安装版 0.163.0-alpha.10.2 三项真实隔离检查最终全部通过（23.33 秒）：临时目录运行实际复制的转接程序和相邻 manifest，核验真实版本、安装版默认特性/analytics 启动参数、配置不符的固定 stderr/空 stdout/已加载线程列表不变、读取同一 threadId、EOF 成功退出及原直接连接仍可读取。源服务只在隔离配置中显式 code_mode_host=true、analytics.enabled=false；原历史/追加/中断检查保持通过。源/转接的原生版本子进程均使用隔离 CODEX_HOME，模型仍为本机合成提供者，不使用账户模型。
- 阶段 0/sharedDesktopRuntime 仍未完成：完整动态参数与 last-write 合并、其他 CLI 工具调用、原版 GUI 安全启动/恢复、审批归属和宿主全部能力、双端真机仍需验收。配置门槛只核对初始化快照，不是配置锁；没有重启原版桌面或改变已有任务。本轮仅提交相关代码、依赖、测试和接手文档，不混入独立 CI/发布修改，不推送。
- 下一步核验并补齐桌面动态覆盖、CLI 委派与启动层级，准备相互隔离、可回退的原版 GUI 接入；继续完整功能基准和安卓恢复/内容工作，不将此开发传输提升为完整迁移交付。



## 2026-10-21 实施记录：原生 stdio/control 候选路径真实核验（阶段 0 / P01）

- 前一轮提交 `92b09f9` 为实际进展。本轮只读检查没有定位到可可靠配置本地 websocket_url 的宿主设置入口，不改写私有数据。确认 CODEX_CLI_PATH 为可执行路径覆盖，桌面仍附加 -c features.code_mode_host=true、app-server、--analytics-default-enabled 及动态配置覆盖；扩充安装代码指纹报告，不把方法存在当作可直接替换 CLI。
- 新增共享探测 --unix-proxy：隔离 HOME/目录，启动真实 app-server --listen unix://PATH 与原生 app-server proxy --sock PATH。新建目录沿用用户+SYSTEM 权限时原生拒绝私有性；仅当前用户 SID 后 listener 可启动，但 proxy 的原始 stdio 与 listener 的 WebSocket 握手不兼容，原生日志明确报告 failed to upgrade control socket websocket connection / httparse invalid token。此处不是账户令牌错误，没有为此读取凭据或关闭权限检查。
- 最终精确新版真实探测退出 1、passed=false，并记录 nativeListenerRejectsRawProxyHandshake=true；去除无关日志/路径的必要证据持久化为 native-stdio-proxy-incompatibility.json。该结果只否定这组精确参数，不宣称 Windows 没有 AF_UNIX 或所有 daemon 路径不可用。socket 文件的 stat/EACCES 不能作为运行成功或失败判据，探测要求真实 initialize。
- 探测 helper 限制 8 MiB JSONL、处理拆分 UTF-8/多帧、断开拒绝待处理请求，关闭仅结束自身 proxy；不作为发布版代理。新增 3 项 Node 分帧、超大输入及启动失败不回显路径回归通过。脚本 ESLint/Prettier/diff 通过。默认认证 WS 路径重新运行真实合成模型完整历史检查，19 个检查全部通过，2 次本机合成模型调用，不使用账户模型。
- 本轮未改变 Rust/安卓生产实现，无需重复其构建；未启动/重配原版 GUI、现有 daemon 或已有任务，未做真机验收。已检查探测进程终态并确认没有带本轮隔离目录参数的 codex 进程残留。阶段 0/sharedDesktopRuntime 继续未验收，不能把负面接入证据改写为阶段通过。
- 下一步实施受控 stdio→认证回环 WS 转接，将凭据留在电脑文件，桌面只配置可执行路径；必须核验 CLI 版本、startup -c/特性/analytics 与共享运行时配置，拒绝不支持项，不能丢弃参数或另起服务兜底。同时继续原生控制服务及完整桌面基准核验。每轮选择性提交，不混入 CI/发布修改，不推送。



## 2026-10-21 实施记录：认证环境继承证据与独立适配凭据（P01 / 阶段 0）

- 前一轮提交 `74f3526` 是实际进展。本轮只读检查安装包后确认一个具体障碍：桌面 buildTerminalEnv 先复制 process.env；工作树环境读取失败时回退继承环境，最终 Ct 仅清理崩溃报告变量，不清除 CODEX_APP_SERVER_WS_URL。因此认证 URL 的环境变量方案不能批准为生产桌面接入；没有重启、重配原版桌面，也未读取用户环境、日志或账户令牌。
- 新增 audit-desktop-ws-environment.mjs，读取 ASAR 指定代码、核验已知纯清理函数形状，在隔离 VM 中以合成标记执行该函数，证实保留 WS URL、移除对照崩溃变量。保存安装代码文件名、SHA-256、JS 字符偏移及布尔结论到 desktop-ws-environment-audit.json；不保存原始代码或真实凭据，未知布局/函数直接失败。此为静态代码与纯函数证据，不冒充原版 GUI 运行。
- 适配层新增必需 AGENTDECK_DESKTOP_ADAPTER_TOKEN_FILE，与端口成对配置、必须绝对路径；使用独立有界 base64url 凭据，启动和每次握手拒绝与原生 token 相同，原生 token 不再能认证适配入口。原生和适配文件各自读取/轮换，复用统一有界读取函数，无自动兼容降级，不修改安卓协议或配对数据。
- 验证：9 单元 + 36 native + 5 协议版本 + 6 WS fixture + 4 适配测试通过（5 项显式检查默认 ignored）；单独启用 Node ws 后适配共 5 项通过，新增漏配、相对路径、原生 token 认证拒绝及误轮换成相同 token 的握手拒绝。安装版三项真实隔离检查通过（12.61 秒），全部使用独立凭据完成适配初始化/同线程读取，原有历史与活动轮次检查保持通过。严格 Clippy、Rust fmt/diff、脚本 ESLint/Prettier 通过。
- 文档更新配置、具体继承证据和接手路径。独立凭据仍能经适配访问原生服务，不能称为环境暴露已经解决；URL 日志/诊断仍未完整审计。阶段 0/sharedDesktopRuntime 仍未验收，未运行原版 GUI 或安卓真机，真实模型检查仍使用隔离合成提供者。
- 下一步优先核验不通过环境变量传递的宿主配置或本机认证路径，并完成日志保护与可回退独立 GUI 验收准备；其他完整迁移目标保持不变。本轮只提交有用代码、回归、可复现证据和接手文档，不混入独立 CI/发布修改，不推送。



## 2026-10-21 实施记录：桌面本地认证传输适配（P01 / 阶段 0）

- 前一轮提交 `5900e9f`。只读检查安装版本地 WS 路由与云端账户路由：本地不注入 capability Bearer，不能套用云端账户 token。Node ws 可通过 URL userinfo 发送 Basic，新增默认关闭、仅 attached 模式的回环 Basic → Bearer 适配；不重启原版桌面，不动其 stdio 或现有任务。
- `AGENTDECK_DESKTOP_ADAPTER_PORT` 显式启用，0 自动端口或大于 1024 的固定端口，仅绑定 127.0.0.1；原生 boundary 检查后启动，本地状态仅含端口。新连接重新读取有界 token 文件，拒绝 Origin/query/子协议/错误 Host/重复认证；最多 16 个认证连接、8 MiB 帧/消息和有界连接/发送。退出取消适配连接，不结束原生进程或直接客户端。仅透传文本 RPC，不改写、重放、复制线程或绕过审批。无 schema、数据库或安卓变更。
- 验证：9 单元 + 36 native + 5 协议版本 + 6 WS fixture + 3 新适配测试通过，常规有 5 个显式检查 ignored；单独启用 Node ws 8.21.0 参数兼容检查，适配测试共 4 项全部通过。覆盖非法认证不连接上游、双向原文/审批帧、Ping、实际 token 轮换、新旧连接隔离、退出和固定错误。严格 Clippy 通过，fmt/diff 检查通过。
- 精确安装版 0.163.0-alpha.10.2 三项真实隔离检查通过（12.73 秒）：每项新增通过真实适配完成 initialize 并读取另一连接创建的相同原生 threadId；现有历史/追加/停止检查保持通过。模型为本机合成提供者，不使用账户模型。Node 参数检查不是运行原版打包 GUI，不代表原版桌面或安卓真机验收。
- 接手说明新增 CODEX_DESKTOP_ADAPTER.md 并更新桌面基准。重要未验证项：桌面认证 URL 在全部日志/诊断/环境继承中的保护，原版 GUI 安全启动与同任务操作、完整重连/审批归属。凭据 URL 方案在审计前不用于当前生产桌面；后续必要时改进认证传递。没有把可行传输等同完整共享，sharedDesktopRuntime 仍 false，阶段 0 未完成。
- 下一步先审计桌面凭据路径并准备可回退的独立 GUI 验收，再推进主会话完整恢复/内容语义与完整基准；本轮选择性提交，不包含独立 CI/发布修改，不推送。


## 2026-10-21 实施记录：主会话权威历史与实时内容合并（P03/P06）

- 前一轮提交 `8f926cf` 是实际进展。本轮增量能力 upstreamHistoryOrdering，sessions.history/historyContent 接受 asc/desc，默认 asc 保持旧客户端；方向贯穿原生分页及大资源分块，页面响应回传方向。授权、原线程身份、哈希与分页/传输保护沿用，无 schema/Room 迁移。
- 安卓主会话打开后直接读取最近原生历史，向上分页按 turnId/item.id 还原顺序，不再要求先打开独立历史弹窗才能看到源内容。TimelineHistory.kt 将持久内容与 journal 分开建模，不制造事件；本地 turnId 映射原生 ID 后合并相同内容，原生 user item 替换初始输入预览，跨轮次同 itemId 不混合。
- 已保存条目不冒充完成；不把可能重叠的 delta 接到保存文本上，真实 completed item 可替换预览。主视图保留 128000 字符预览及 16 MiB JSON 内容预算，完整原始记录仍可由历史分页入口读取。媒体等未知项保留原始详情，不宣称已完成语义渲染。
- 会话打开/刷新、WSS 重连、观察恢复与终态触发最近页读取；请求 revision、选中会话与 host epoch 阻止旧响应污染新视图，切换电脑取消加载，删除已选会话清除内存历史。刷新替换旧分页窗口，可重新向前翻页。观察失败单独显示错误，不阻断已授权历史读取。
- 验证：Rust 9 单元、36 native、5 协议版本、6 WS fixture 通过（4 显式真实检查默认 ignored），严格 Clippy/fmt 通过。新增 native 回归验证倒序分页、默认正序兼容、同方向大输出分块还原、跨方向哈希拒绝与协议非法值。Kotlin 新增 6 项测试覆盖投影层的重连保存内容合并、保存/流式去重、本地/原生身份、顺序、翻页刷新及游标循环；Android testDebugUnitTest/lintDebug 通过。
- 精确安装版同版本 0.163.0-alpha.10.2 三项显式真实隔离 Core 检查通过（13.32 秒），新增最新项/较早项与正序原记录逐项一致，源线程重连恢复后最新保存回复的 turnId/原文一致；补充单项真实检查通过（11.39 秒），确认保存项与在线完成通知的原生轮次/内容 ID/原文一致。模型为本机合成服务，不使用账户模型，不代表原版桌面或安卓真机验收。
- 尚未完成：进程重启后的完整离线历史缓存、断线终态/事件完整恢复、revert/删除对保留日志预览的全部失效处理、追加指令与源用户回显的精确关联、完整媒体/交互类型。保存快照与 delta 无共同原子游标，活动保存条目可能等待完成项或刷新才更新，不猜测拼接。完整 fullHistoryRead/sharedDesktopRuntime/externalThreadSync 仍 false。
- 阶段 0 与完整迁移仍未完成。下一步继续原版桌面认证与可见基准，并补基于原生身份的完整恢复和消息语义；本轮只提交有用的迁移代码、回归与文档，不混入 CI/发布修改。


## 2026-10-21 实施记录：原线程观察订阅与在线消息（P01/P06）

- 前一轮提交 `881edd6` 是实际进展。本轮新增 observation.rs、sessions.observe 和 attached-only externalThreadObservation。读取原线程、复核授权目录、分页核对已加载列表后，以原 threadId、相同 cwd、excludeTurns 重加入，不传递模型/审批/沙箱覆盖，不修改 Bridge 的执行就绪缓存。进程内最多记忆 128 个观察目标，原生重连及元数据变化后恢复；撤权/删除移除目标，单个恢复失败不阻止其他目标尝试。
- 真实检查发现归档后源线程可能卸载，直接 resume 会加载执行环境并报 AGENTS.md 访问拒绝。没有放宽权限；现在未加载源返回 observing=false/waitingForSource，安卓仍能读历史并显示等待说明，源端恢复后再订阅。检查 loaded 与 resume 之间尚无原生原子前置条件，竞态仍待完整验收；不把此实现说成纯只读或全部恢复问题已解决。
- 已验证的外部轮次/消息/工具通知以 upstream.progress 和原生 turn/item ID 保留，不创建本地假轮次；安卓支持外部用户文字、流式回复及最终项替换，跨轮次相同 itemId 不合并。源终态与停止查询改为事务内去重，避免两路并发重复写入/增加序号。大预览保留原生身份。
- 安卓打开/刷新会话和 WSS 重连时按能力协商建立观察；Bridge 的 RPC 重连由索引 worker 重建已记忆的订阅，不要求再次点击。新增 session.observed 元数据包含源端实际模型、审批与沙箱，当前不提供配置写入口。
- 验证：Rust 9 单元、35 native、5 版本、6 WS fixture 通过；包括无执行覆盖、原 ID、重复观察、未加载等待、错误源 ID、撤权、8 路同时终态只留一条日志，以及 Kotlin 流式替换/原问题/跨轮次身份。严格 Clippy、fmt 和 diff 检查通过。Android testDebugUnitTest/lintDebug BUILD SUCCESSFUL（1m9s）。
- 精确安装版同版本 0.163.0-alpha.10.2 的三项显式真实隔离 Core 检查通过（13.16 秒）：订阅前后仍为同一线程；原轮次输出原文与终态经真实通知进入 Core；重连后源端自行恢复执行环境，Bridge 自动订阅并收到下一轮终态；重加入时沙箱与审批策略与源端一致，不生成本地副本。模型是本机合成 Responses 服务，不使用账户模型；不是原版桌面认证或安卓真机验收。
- 限制：历史与在线流尚未完整合并，订阅前/断线漏消息和终态、外部审批接管、全部媒体/计划语义、观察租约/释放及跨进程目标恢复仍待实现。源端恢复读取失败继续保留明确错误，不换线程或配置。完整 externalThreadSync/sharedDesktopRuntime 仍 false，阶段 0 未完成。
- 下一步：优先解决原版桌面认证接入及可见 UI 基准，并补权威历史与实时内容的统一恢复/身份去重；保持完整迁移目标，每轮有效增量单独提交，不混入 CI/发布修改。


## 2026-10-21 实施记录：共享原轮次停止（P01/P04）

- 新增能力 activeTurnInterruption 和 turn.interruptActive；按原会话、当前授权目录、预期上游轮次及已验证执行边界检查后中断，不启动、复制或伪造本地轮次。活动 Goal 先暂停；沿用设备请求持久化去重，未知结果禁止自动重试。
- 安卓 Stop 保留已有本地轮次路径，外部活动任务通过权威轮次 ID 停止；回执只显示等待确认，真实终态覆盖等待状态，迟到请求事件不覆盖终态。外部终态按源 ID 投影并对保留日志去重。
- 真实隔离上游测试最初失败：非订阅连接不一定收到 turn/completed。修复为停止后最多 20 次、间隔 100 ms 查询最新权威轮次摘要；只记录同一 ID 的真实终态，异常或轮次已变化则保留未知/等待，不猜测完成。此机制仍不覆盖长期延迟、离线漏事件及完整订阅恢复。
- 验证：Rust 9 单元、33 native、5 协议版本、6 WS 测试通过（4 显式真实测试默认忽略）；安装版同版本 0.163.0-alpha.10.2 的三项真实隔离 Core 检查通过，涵盖原线程追加后完成、外端启动新轮次、错误目标拒绝、中断真实终态与无本地副本。合成模型在本机，不使用账户模型。
- Android testDebugUnitTest、lintDebug 通过；严格 Clippy 和格式检查通过。新增测试覆盖请求重放、Goal 暂停、源终态去重及安卓终态乱序保护。未做安卓真机或原版桌面连接验收。
- 阶段 0 未完成；原版桌面连接认证和完整入口基准仍待解决。下一步补外部任务完整生命周期订阅与断线恢复，并继续推进桌面接入。每轮选择性提交，不混入 CI/发布修改。


## 持续目标与每轮提交约定

用户最新要求每轮完成后提交一次有用且经过验证的改动，替代此前“仅阶段验收后提交”的规则。本聊天 active goal 保持完整迁移目标。当前阶段 0 未完成；轮次提交不能用作阶段完成证据，不自动推送。提交只包含迁移代码、测试、必要依赖与文档，不混入独立 CI/Pre-release 任务。下方旧记录中的“不创建阶段完成提交”是当时执行记录，不限制今后的轮次提交。

## 2026-10-21 实施记录：向原活动轮次追加文字指令

- 前一轮提交 `c25cc5a`。本轮新增 steering.rs 和增量能力 activeTurnSteering：turn.active 校验原线程/精确工作区授权，通过公开 thread/turns/list 的 limit=1、desc、notLoaded 查询当前轮次；turn.steer 必须携带 expectedTurnId，再核验目标后调用原生 turn/steer。不新建/分叉/恢复线程、不改变模型或权限、不制造外部本地轮次。
- 写操作接入现有 per-device/requestId 持久化去重，clientUserMessageId 由该操作身份派生。响应必须匹配原 turnId；网络中断、错误确认或接受后本地记账失败返回 OUTCOME_UNKNOWN，不自动重发。取消安全 busy guard 在退出/取消时释放。成功追加 turn.steered 保留文字与原轮次，只有既有本地轮次才关联本地 turnId。
- 安卓输入框在活动状态下保留停止按钮并显示追加入口；先取得权威轮次身份，再发带前置条件的请求，成功确认才清除对应草稿。新增投影保留原始问题、独立显示追加文字且重放不重复。初版追加仅支持文字；已有附件草稿会明确提示先移除，不静默丢弃。未知旧 Bridge 不展示不支持的追加入口。
- 真实核验发现任务刚启动时原生轮次摘要短暂不可见；源线程 active 但无轮次 ID 时返回 TURN_STATE_UNAVAILABLE，避免误判任务结束。真实新旧版脚本均验证无全量历史读取也能发现原活动轮次，成功报告分别保存在两版基准目录的 shared-runtime-active-turn-check.json；旧版仍使用 --prime-turn 规避既知空历史恢复限制。
- 新增 real_desktop_baseline_steers_original_turn_through_core：隔离真实服务启动外部原轮次 → 实际 Core 发现 ID → 错误目标被拒绝 → 原目标追加获确认 → 本机合成模型的后续请求确实收到追加文字 → 完成仍是同一个原 turnId；不生成本地假轮次。新版三项显式真实检查通过（13.15 秒）。这不是原版桌面/真实账户模型/安卓真机证据。
- 常规 9 单元 + 32 native + 5 版本 + 6 WS fixture 通过，真实检查默认 4 项 ignored；严格 Clippy、脚本 ESLint/Prettier 通过。native 新回归覆盖请求重放只记一次、原身份不变、错误目标与授权撤销、结果未知不重发；Kotlin 新回归覆盖原问题/追加不覆盖和重放。Android testDebugUnitTest/lintDebug 最终 BUILD SUCCESSFUL（54 秒）。
- 限制：尚未实现完整排队、追加附件、外部活动消息投影和外部停止/审批接管；账户/权限来源及跨端并发归因仍待完整验收。当前追加只确认原生接受并在隔离提供者验证消费，不宣称完整活动任务迁移。下一步继续活动任务身份和实时投影，原版桌面认证及阶段 0 基准仍未完成。

## 2026-10-21 实施记录：权威删除事件与持久化清理

- 前一轮提交 `d508cf9` 是实际进展。本轮确认两版稳定 schema 均定义 thread/deleted，并在精确新版真实隔离服务中观察外部 thread/delete 成功后的权威通知。attached 模式校验该通知后持久化 threadId 删除标记，能力新增 externalThreadDeletionEvents；managed 模式不声明外部删除订阅能力，完整 externalThreadSync/sharedDesktopRuntime 仍 false。
- 增量 migration 5 增加 thread_deletions，不迁移或重写既有配对/线程。索引 worker 在本地 busy 释放后清理已确认删除的缓存会话、轮次、审批和保留事件；清理、retentionFloor、序号及 session.deleted 事件在同一事务完成，提交后广播。通知处理与清理之间发生进程退出，下一次启动仍可继续；重复删除不生成第二条事件。
- 索引读取跳过已确认删除的通知 ID/已加载候选，事务提交再复核 tombstone，阻止并发旧快照复活线程。读取期间收到权威删除后，该候选读失败不会阻断其他线程更新。安卓沿用已有 session.deleted 和快照恢复处理，无新 Room 迁移。丢失于列表不等于删除，断线期间完全错过的上游删除仍未实现权威补查。
- 新增崩溃恢复/事务注入回归：记录 tombstone 后重开数据库；强制删除事件 INSERT 失败时会话和 cursor 保留；解除故障后原子清理、旧 cursor 返回 REPLAY_GAP、删除事件可续传；重复清理及旧索引导入不会新增事件或复活数据，项目授权保留。
- 真实隔离检查扩展：外端新建原线程自动导入 → 本地 busy 期间外端删除 → 本地缓存暂保留 → 释放后自动清理且只有一条删除事件 → 其他原线程改名仍能自动同步。最终 9 单元、31 native、5 版本、6 WS fixture 全部通过；两个显式新版真实检查通过（11.36 秒）；严格 Clippy 通过。补充模拟 migration 4 数据库升级至 5 后保留会话和 cursor，再验证删除恢复，单项复验通过。模型为本机合成提供者；不代表原版桌面、安卓真机或真实账户模型已验收。
- 后续：断线遗漏删除的权威恢复、活动任务身份/追加/审批与竞态、原版桌面认证接入和完整基准。阶段 0 仍未完成，按用户最新规则提交本轮有效增量。

## 2026-10-21 实施记录：附着运行时的自动元数据同步

- 前一轮提交 `92d47e9`。本轮新增附着 WS 运行时的索引监听任务：每次就绪/重连扫描已有授权目录，校验 thread started/name/archive/unarchive/status 通知后合并触发索引读取，250 ms 合并等待，不阻塞 RPC 事件读取。managed stdio 不启用该监听，能力新增 externalThreadMetadataSync（仅 attached 为 true）；完整 externalThreadSync/sharedDesktopRuntime 继续 false。
- 使用既有事务索引与本地版本保护，不授予新目录、不删除缺失条目。提交前复核运行时 generation；本地 busy、分页竞争及瞬态错误保留旧索引并以 2–30 秒退避重试，相同错误不连续弹报。通知 ID 的有界待核实集合保留不同修订，成功提交只清除该次读取对应的修订，避免吞掉读取期间的新变化。
- 真实检查发现零轮次线程 unarchive 后可同时缺失于 thread/list 与 thread/loaded/list，原索引因此不能更新。现在按校验通过的通知 ID 经 thread/read 补查，仍复核精确目录授权；与归档列表同页重复的候选只按列表权威归档关系处理。未直接使用通知伪造完整线程，也未访问私有数据库。
- 修正已导入线程的外部轮次完成通知导致连接被误断的问题：未绑定的外部轮次不写入虚假的本地 progress/turn，started/completed 只触发索引核实；逐字 delta 不触发整表扫描。真正的活动轮次接管、排队归因和审批仍待实现。
- 真实隔离检查已改为不调用手动 sync，验证自动导入原线程、外端改名/归档/恢复、外端新建零轮次线程、本地 busy 期间不覆盖且释放后自动重试；有历史模式再验证已导入会话中的外端模型轮次完成不换 generation、不生成本地假轮次，后续历史与重连身份保持。模型始终为本机合成 Responses 服务，不代表真实账户模型或原版桌面/安卓验收。
- 最终常规 8 单元 + 31 native + 5 版本 + 6 WS fixture 全部通过，3 个真实检查默认 ignored；显式新版真实两项检查均通过（7.61 秒）；严格 Clippy 通过。本轮无安卓生产代码变更，不将以前的构建结果计为本轮真机通过。仍缺外部删除、原版桌面认证接入、共享活动任务与完整 UI 基准，阶段 0 不标记完成。若通知后线程已被删除，补读失败会保留索引并报告待同步；删除的权威恢复需后续实现，不能推断删除或悄悄丢弃来源错误。

## 2026-10-21 实施记录：已完成助手内容与实际 Core 历史链路

- 前一轮提交 `1681eb4` 已形成可构建迁移基线。本轮是实际验证进展，没有修改生产账户、原版桌面或用户会话。合成内容经精确新版真实服务执行、保存，再由公开接口读取，不直接写 rollout 或数据库。
- 探针新增 `--synthetic-turn --complete-history`：先验证双端追加和中断，再完成独立后续轮次；逐条分页核对两种消息类型、原始轮次关系、唯一条目身份、中文/Emoji/代码块助手原文及第三客户端重连后全部内容一致。真实运行 18 项通过，3 个条目/3 页，2 次本机合成模型请求。证据：`docs/baselines/codex-0.163.0-alpha.10.2/shared-runtime-completed-history-check.json`，不含完整消息或凭据。
- 新增 ignored Rust 检查 `real_desktop_baseline_persisted_history_through_core`，使用隔离 HOME 和本机合成 Responses 提供者：真实 Codex 完成轮次 → 原线程导入 → 实际 Core 读取两个单项页 → 核对原 turnId/条目与助手原文 → 外端重命名/归档 → Core 重新连接后全部历史响应仍一致。未伪造 Core ready 或跳过实际入口/boundary 检查。
- 显式运行 `real_desktop_baseline_ -- --ignored --nocapture` 两个检查均通过（4.73 秒，包含原无模型检查）；严格 Clippy、脚本 ESLint/Prettier 通过。新增代码均为隔离验收设施，无安卓生产代码变更；不把既有安卓构建当成本轮真机验收。
- 仍未验证原版桌面认证接入、真实账户模型、工具/媒体/超大内容的真实历史与安卓流程。当前证据仅扩大到原生已保存用户/助手内容、分页及 Core 重连，不宣称共享活动任务或完整迁移完成。

## 2026-10-21 实施记录：真实非空历史与提交规则更新

- 上一轮是实际进展。本轮扩展隔离真实运行时探针：合成模型启动并中断原轮次后，逐页读取 thread/items/list，检查原始用户输入、原 turnId 及两个客户端读取内容完全一致。报告仅保存条目数量和类型，不保存完整任务内容或凭据。
- 实际命令：`node scripts/check-shared-codex-runtime.mjs <0.163.0-alpha.10.2 exe> artifacts/parity-history-native --synthetic-turn`，13 项检查全部通过。实际持久化条目为 1 个 userMessage、1 页；不能据此宣称跨多页或助手/媒体内容真实验收。报告保存到 docs/baselines/codex-0.163.0-alpha.10.2/shared-runtime-history-check.json。
- 原版桌面接入、真实账户模型、安卓真机与全部历史语义仍未验收。上轮 fixture 的大条目/分页以及真实 Core 空历史证据保持各自范围。未改用户桌面配置或账户数据。
- 按最新指令，本轮将已验证的迁移底座、历史入口及其必要协议/测试/文档一起提交，使前序尚未提交的依赖形成可构建基线；不包含独立发布工作。后续每轮只提交有用交付，不以提交数量代替阶段验收。

## 2026-10-21 实施记录：已保存历史分页与安卓查看

- 新增 history.rs，使用当前连接版本校验 thread/read 与 thread/items/list；每次读取核对原线程身份、精确授权目录，读取后复核授权。不复制线程、不伪造 journal、不把预览当完整内容。
- 增量 sessions.history（1–50 项，默认 20）与 sessions.historyContent：分页自动缩小到 384 KiB；单个大条目改为 48 KiB base64 分块，逐块重读并核对 SHA-256，内容变化返回 CONTENT_CHANGED。游标、哈希和偏移严格校验，能力 upstreamHistoryPages/upstreamHistoryContent 独立声明，fullHistoryRead 仍 false。
- 安卓会话工具栏增加在线“历史”入口，原生全屏分页显示已保存内容，支持文本选择、完整原始记录、前后翻页与失败重试。重建大条目时检查会话/条目/轮次身份、分块连续性、总长度和最终哈希；切换主机后丢弃结果，无新增缓存或数据库迁移。
- Rust 回归：8 单元、31 native、5 版本、6 WS fixture 通过（2 真实检查默认忽略）；新增 >1 MiB Unicode 条目完整重建、内容变化、非法 EOF 偏移、授权撤销和 journal 不污染验证。严格 Clippy、双版本/实验 schema 和 diff 检查通过。
- 新版真实隔离检查显式运行 1 passed（5.37 秒），新增导入原线程后通过实际 Core 读取空历史的断言。未驱动真实非空模型历史；大内容证据来自 fixture，不能当成原版桌面或真机验收。
- Android testDebugUnitTest/lintDebug 首次修正协程取消检查后成功；最终导航重试与资源游标校验调整后再次 BUILD SUCCESSFUL（1 分 5 秒），未安装安卓设备。
- 限制：上游 8 MiB 帧上限仍存在；单页重建在内存中，尚无任意大小产物传输。历史暂为独立查看器，未合并实时投影，未实现全部媒体语义。阶段 0 未通过，不创建阶段完成提交。下一步验证真实非空历史、原生条目身份投影及活动任务/外部变更同步，继续核验原版桌面认证接入。

## 2026-10-21 实施记录：权威已有会话索引导入

- 上一轮为实际进展。本轮新增 thread_index.rs，经 Windows-local workspaces.sync 在目录授权后导入已有上游线程索引。使用公开 thread/list（归档/未归档、全部已知 sourceKinds、所有 provider、分页）和 thread/loaded/list + thread/read；从不 thread/start/fork 复制对象，不读写桌面私有数据库。
- 真实新版实测发现：零轮次线程可 read/resume，但 thread/list（包括 useStateDbOnly）暂不返回。增加已加载列表补查后，原始线程也能被索引。持久化归档列表优先于 loaded 回退；后者未出现在归档列表时归为未归档。所有候选仍按精确授权目录复核，忽略 ephemeral 与未授权目录；不把 cwd 子目录自动当成已授权项目。
- 增量 migration 4 新建 session_metadata：保存来源、原 session 树、parent/fork ID、项目归属、模型/强度、section 和权威运行状态。保留既有 sessionId、thread ID、pin、已知活动轮次；更新上游标题/归档和模型选择。SQLite 单事务提交索引、元数据及 sessions.synced journal 后再广播；失败回滚全部索引。此次本机项目授权是独立既有操作，后续索引失败不会撤回已完成授权。
- 分页重复 ID/cursor、超时、100 页/20000 项等限额明确失败，不提交残缺索引；并发导入互斥。提交前复核授权、busy 与开始时的 updatedAt/事件序号，避免同一时间戳下本地 pin/rename/turn 变更被旧快照覆盖。缺失于列表的旧索引暂保留，不能据非原子跨页列表推断删除。
- 外部 active/systemError 或未知状态索引为 unknown，启动/会话管理先在 busy 锁内检查；不会把尚未接管的外部活动任务当 idle。之后需实现活动 turn 共享、steer/审批及权威恢复，不能长期以这个限制代替完整能力。
- 安卓 Session 增加可选 upstream JsonObject，兼容旧响应及未知类型；Room 表结构不变，现有快照 JSON 缓存保留来源和派生关系。新增 2 个 Kotlin 测试验证旧会话和元数据缓存回环。能力增加 threadIndexImport，scope 改为 bridge-created-and-imported；sharedDesktopRuntime/externalThreadSync 继续 false。
- 新增 native fixture：跨页/归档/外部重命名/来源/派生/未授权目录/保留 pin 与原身份/活动保护/持久化；重复 cursor 不推进 cursor、不产生残缺索引。单元验证同时间戳的事件序号冲突回滚、元数据删除级联。最终常规 8 单元 + 30 native + 5 版本集成 + 6 WS fixture 全部通过，2 个真实检查默认 ignored。
- 新版真实隔离检查扩展到索引：两个真实客户端、Core 监督/入口/boundary，导入外部原线程，外端 rename/archive 后重新同步，同 sessionId 和 threadId 保持；最终代码复验 1 passed（4.98 秒）。不执行模型或原版桌面/安卓操作，不能称完整共享验收。
- 安卓 `gradlew.bat testDebugUnitTest lintDebug`：BUILD SUCCESSFUL，包含新增缓存测试；既有 deprecated/kapt 提示仍在。严格 Clippy 通过。阶段 0 尚未完成，不创建阶段完成提交。
- 下一步：完整历史分页读取与安卓投影、外部变更自动订阅/删除冲突、活动任务接管、原版桌面认证及完整 UI 基准。显式索引不是完整聊天历史或自动跨端同步，不能用空内容冒充已迁移会话。

## 2026-10-21 实施记录：新版监督、生产入口与版本报告

- 上一轮为实际进展。本轮 RuntimeTarget 支持本机可选 AGENTDECK_RUNTIME_PROTOCOL_VERSION，精确允许 0.159.2 和基准 0.163.0-alpha.10.2。版本选项必须与认证 WS 地址/token 文件同时使用；旧配对两项不变，未指定版本保持固定版。未知/近似版本拒绝，不自动选择或降级。
- main 以所选 profile 校验实际 AGENTDECK_CODEX_EXE/发现的二进制，并对该二进制运行实际 boundary；sandboxVerifiedVersion 记录同一版本。新版需本机显式指定匹配 exe，不自动更换全局 CLI。supervisor 用同一 profile 建立/重建 WS，并继续检查实际 initialize 身份、readiness 和既有权限配置。
- Core 快照、system.capabilities、system.diagnostics 使用配置的 schema 版本，不再在新版连接下错误报告固定版。启动检查报告增加 codexVersion/runtimeMode；这些是增量字符串字段，安卓现有模型兼容，不改数据库结构。只有 ready 才表示握手及就绪校验通过，sharing/externalThreadSync 仍 false。
- 真实新版实验扩展：实际 sandbox 通过 → 真实服务二进制 main 经隔离环境选取新版 → startup-check PASS/attached-local-ws/新版本与持久化 boundary 版本一致 → Rust Core 新版监督 ready → 创建标题被另一客户端读到 → 断开后新 generation 保留同一线程绑定与 profile → Core shutdown 后外部服务/另一客户端仍可读。
- 首次入口测试失败是测试使用 Tokio Child::wait 自动关闭了仍归 Child 所有的 stdin，服务据 EOF 正常退出监督；保留父端输入管道后最终实验通过。没有禁用 EOF 生命周期或放宽服务条件来绕过。测试收集最多 16 条本机启动错误消息用于诊断，不保存凭据或会话内容。
- 验证：常规 7 单元 + 29 native + 5 版本集成 + 6 WS fixture 通过。最终显式 `real_desktop_baseline_uses_versioned_rust_contracts -- --ignored --nocapture`：1 passed（3.80 秒）；严格 Clippy、Rustfmt、双版本/实验 schema 校验和 diff 检查通过。真实检查仍默认 ignored，不消耗模型额度。
- 限制：只是迁移开发的显式版本接入，默认 managed 仍固定版；新版真实模型/交互式审批/完整 Goal 生命周期、原版桌面认证连接、安卓及全部历史同步尚未验收。仍要求现有 AgentDeck 限制配置，未擅自修改共享服务权限或启用集成。阶段 0 未完成，不创建阶段完成提交。
- 下一步：用隔离合成模型驱动新版真实 Core，验证 Plan/Goal/审批/停止及断线恢复的业务链路；继续解决原版桌面认证路由和权威会话/项目索引接入。不能因入口 PASS 宣称已共享原版桌面任务。

## 2026-10-21 实施记录：连接级业务校验与 Plan/Goal 版本适配

- 上一轮为实际进展。本轮会话创建/恢复/管理、模型、配置、历史恢复、通知和审批收发改用当前 Rpc 的版本校验，避免新版连接落入全局旧 schema。审批决策/过期拒绝按同一 generation 的连接版本校验；Store 展示仍用旧版 choices 包装，两版当前稳定审批合约一致，实际发回上游另经连接版本验证。
- 精确新版 CLI 再导出 experimental v2/TurnStartParams，原始字节保存在版本目录，新增 composer-lock.json；Rust build 和 schema:verify 校验哈希。pin 工具增加显式 --composer 模式，仍拒绝覆盖既有捕获。旧版 Plan schema 保持原字节不变。
- composer::validate_turn_for 按版本选择 Plan/默认参数合约。新增 GoalOrigin 类型；新版显式传 user/automatic，旧版不添加新字段。当前开关 Goal、选择其他模式和中断均源于用户操作；自动来源必须显式选择 Automatic，不把缺省来源等同用户授权。普通用户轮次不伪造 parentTurnId/rootTurnId。
- 新增 Plan 模式正反例、Goal 来源与旧版参数保持、两版审批不返回 acceptForSession/权限仅 turn scope 回归；protocol_versions 最终 5 passed。6 单元、29 native、6 WS fixture 通过；真实实验默认 ignored。
- 新版真实隔离双客户端测试增加实际 native Windows MXC boundary 验证，最终 `real_desktop_baseline_uses_versioned_rust_contracts -- --ignored --nocapture`：1 passed（2.51 秒），同轮验证元数据共享/恢复及服务存活；未启动模型或操作用户历史。
- 严格 Clippy、Rustfmt、脚本 ESLint/Prettier、双版本稳定与新版实验 schema 校验通过。测试编译期间曾因旧测试进程占用可执行文件发生 LNK1104；后续串行重跑 protocol_versions 成功，未更改断言绕过失败。
- 尚未接入新版生产 supervisor/环境选择，也未验证新版真实模型/审批交互/原版桌面/安卓。下一步实现带版本的 RuntimeTarget 和同版本 executable/boundary/version reporting，扩展真实 Core 新版监督/重连测试，再验证完整轮次；随后推进共享权威索引和原版桌面适配。阶段 0 仍未通过，不创建阶段完成提交。

## 2026-10-21 实施记录：桌面基准版本化校验与真实 Rust 连接

- 上一轮为实际进展。本轮新增桌面 CLI 0.163.0-alpha.10.2 稳定 schema overlay：318 个有效 schema，279 个复用固定版原始文件，39 个保存新版原始导出及逐项 SHA-256。新增 pin-desktop-protocol.mjs 只接受精确基准版本，拒绝覆盖已有捕获；生产旧 lock 不变，没有手改 schema。
- Rust build.rs 和 schema:verify 校验 overlay 来源和哈希。新增 ProtocolVersion 与按（版本、schema 名）隔离的 validator cache；Rpc 可显式选择本机 WS profile，请求按所选版本校验，initialize_attached 按该连接的精确版本校验真实握手响应后才发送 initialized。
- 新增 2 个版本隔离测试：新版新增 attachmentOwner/list 不会被旧版放行；namespaceTools 在旧版必需、新版移除，两个版本不会复用错误缓存。修正基准文档上一轮将该字段方向写反的问题。
- 真实隔离检查 `real_desktop_baseline_uses_versioned_rust_contracts` 显式运行：1 passed（1.48 秒）。新版真实认证回环服务、隔离 HOME/项目、两个 Rust 客户端精确握手、新建/设置名称/另一端恢复同一线程、新方法查询及响应 schema、关闭 A 后 B 读取且服务存活。未读取既有历史、未启动模型或原版桌面客户端。
- 验证：6 单元 + 2 版本集成 + 6 WS fixture、29 native 集成通过；真实新版检查如上。严格 Clippy、Rustfmt、脚本 ESLint/Prettier、schema:verify（旧版 314；新版有效 318/overlay 39）和 diff 检查通过。安卓产品代码本轮未改，未重复构建。
- 限制：profile API 仅显式本机适配/实验使用，Core 生产 supervisor/环境变量仍只选择 0.159.2。业务层仍有旧版自由 validate 调用，Plan 实验 schema 也尚未版本化，因此不能把新 profile 注入 Core 即宣称支持新版完整任务。未放开权限或改写共享配置。
- 下一步：统一业务层的连接级校验、版本化 Plan/Goal 来源与归因映射，并验证新版本地 boundary、审批和完整生命周期，再接入生产 supervisor。原版桌面认证路由、完整 UI 基准及宿主功能接口仍待完成，阶段 0 不标记通过、不提交阶段完成记录。

## 2026-10-21 实施记录：逐合约协议差异审计

- 扩展 `scripts/audit-codex-protocol.mjs`：除文件/方法清单，比较客户端请求、服务端请求、服务端通知、所有目录的 Response schema。每个方法包含其传递引用，循环定义可终止，缺失/外部引用明确失败；对象键顺序不产生伪差异。导出临时目录结束后清理，不替换生产 schema。
- 新增 `scripts/lib/protocol-contracts.mjs` 和 4 项 Node 回归测试，覆盖同名方法的嵌套形状变化、循环引用、无关定义、增删方法、无效引用与大值证据。报告保留 JSON Pointer、前后哈希及有界差异值，超过 2048 字符的值使用哈希/长度并明确说明可重新导出。
- 实际安装版稳定域结果：105 客户端请求（新增 1、变化 4）；10 服务端请求（无变化）；85 通知（新增 2、变化 7）；115 Response schema（新增 1、变化 18）。报告含文档字段变化，不自动判定兼容或不兼容。重点及字段说明已写入 CODEX_DESKTOP_BASELINE.md。
- 真实固定 CLI 再导出为对照：稳定四域零变化，报告在 ignored artifacts/parity-pinned-audit；安装版证据在 docs/baselines/codex-0.163.0-alpha.10.2/protocol-contract-differences.json。没有读取用户会话/账户令牌或启动模型。
- 验证：`node --test scripts/lib/protocol-contracts.test.mjs`：4 passed；脚本 ESLint、脚本及报告 Prettier、`node scripts/schema.mjs`（314 个生产 schema 未变）和 diff 检查通过。无 Rust/Android 产品代码变化，本轮未重复运行其测试。
- 版本仍不切换：新版 Goal 操作来源、派生任务归因、ThreadItem/错误扩展、MCP OAuth loginId、模型能力必需字段等需逐项实现和真实验证。原版桌面认证接入与逐入口 UI 基准仍待完成，阶段 0 未通过，未创建阶段完成提交。
- 下一步：以差异报告建立版本化 schema/请求映射，验证新版权限及生命周期；继续解决桌面 URL 路由认证和宿主专属接口。不能单改版本字符串放行新版。

## 2026-10-21 实施记录：认证连接接入服务监督

- 上一目标轮次为实际进展。本轮新增 `RuntimeTarget`，默认 Managed；同时配置本机 AGENTDECK_RUNTIME_WS_URL/TOKEN_FILE 才启用 Attached。地址先校验，token 文件必须绝对路径且有界读取，凭据不进入协议、错误或诊断。配置缺失/非法不自动降级。
- main 读取选择并调用 `Core::supervise_runtime`。Attached 经 WS 接入并在重连时重读 token，不启动/停止上游进程、不修改共享服务 MCP 配置、不回退独立运行时。保留原有 config、sandbox readiness 和生产 boundary 校验。
- `initialize_attached` 校验服务实际 userAgent 的精确 Codex Desktop/0.159.2 版本前缀，错误版本在 initialized 通知前拒绝；不能用本机 CLI 的版本代替实际服务身份检查。schema 仍固定，不支持新版服务的声明保持不变。
- capabilities 增加 attached-local-ws 模式值，scope 仍 bridge-created，桌面共享/外部线程同步仍 false。Kotlin 已按字符串兼容解析，不改数据库与请求格式。
- 隔离真实测试扩展到 Core 监督链路：真实固定服务、真实 native MXC boundary 通过后建立 Core，验证 ready、创建会话及另一客户端可见初始标题、断开后生成新连接且保留绑定、关闭 Core 后上游服务和另一客户端仍工作。未读取用户原会话、未启动模型任务或重启原版桌面。
- 常规验证：6 单元 + 29 既有集成 + 6 WS 集成测试通过，真实实验默认 ignored；严格 Clippy、Rustfmt 和 diff 检查通过。最终真实 supervisor 实验显式运行 `real_pinned_runtime_accepts_two_rust_clients -- --ignored --nocapture`：1 passed（7.12 秒），包括真实 boundary、重连与连接关闭后的外部服务存活。
- 当前仍未完成阶段 0：原版桌面 URL 路由认证适配、新版 schema/宿主功能、完整 UI 与账户入口盘点。阶段 1 的全部历史导入与跨端业务事件还未实现；本轮只是对共享底座的可验证推进，不标记阶段完成或创建阶段完成提交。

## 2026-10-21 实施记录：Rust 认证共享传输

- 上一目标轮次为实际进展。本轮将隔离实验推进为 Rust 可复用传输：`Rpc::connect_local_websocket` 接入仅限精确 127.0.0.1/[::1] + 显式非零端口的 ws 地址。禁止远程主机、URL 内嵌凭据、路径与查询，凭据只进入敏感 Authorization 头，不进入连接错误文字。
- 复用 RPC 请求 schema 校验、操作 ID 和 8 MiB 上限；增加 10 秒连接/写入超时，处理通知、响应、Ping/Pong、异常帧及连接丢失。停止连接会清理 pending 并发出 $lost，不终止服务进程；满事件队列可被 stop 中断。
- `tokio-tungstenite` 从已有 dev dependency 移到正式依赖，版本/锁定包不变；未增加 Node 产品运行时。stdio 路径保留，帧对象检查复用于 WS。
- 测试发现 URL 转换会归一化 userinfo，已在转换前明确拒绝内嵌凭据。新增 4 个传输 fixture 测试：认证头/通知/停止后 listener 存活、异常 JSON 导致 pending 失败、401 不泄漏信息、满事件队列仍可停止；新增地址/凭据边界单元测试。
- 验证：`cargo test --locked --manifest-path desktop/core/Cargo.toml --lib --test native --test runtime_websocket`：4 单元 + 29 原集成 + 4 WS 集成通过，1 个真实实验默认 ignored。显式设置 AGENTDECK_SHARED_PROBE_EXE 到实际固定版二进制后，`cargo test ... --test runtime_websocket real_pinned_runtime_accepts_two_rust_clients -- --ignored --nocapture`：1 passed。真实实验校验固定版本、隔离 HOME/项目、连接两个 Rust 客户端、初始化/响应 schema、同线程标题可见、停止 A 后 B 仍可读取，未启动模型或访问已有用户线程。
- 此 API 目前仅为传输底座，尚未连接 Core::supervise，也未证明原版桌面认证接入。调用方在发布 ready 前仍必须校验运行时版本/schema 和权限策略。capabilities 继续报告 managed-stdio 和未共享；不能因 transport 测试通过改为完整共享。
- 补充生命周期检查：事件接收者被丢弃时自动断开闲置连接，新增回归测试通过；最终 WS fixture 共 5 passed（真实实验仍默认 ignored），Clippy、Rustfmt 和 diff 检查通过。其余原集成未因这个连接清理分支重复扩大验证，真实双 Rust 客户端实验则按最终代码复验。
- 下一步：完成桌面 URL 路由认证适配与版本选择/服务监督设计，随后导入权威项目/线程并处理跨客户端事件。阶段 0 的 UI/账户入口清单和桌面宿主能力仍未齐全，不提交阶段完成记录。

## 2026-10-21 实施记录：原生共享运行时实测

- 上一目标轮次为实际进展；本轮继续推进 P01。新增隔离双客户端实验脚本 `scripts/check-shared-codex-runtime.mjs`，显式开发依赖 ws 8.21.0（已有锁定包复用，Node 不进入产品运行时）。
- 安装版静态检查找到 CODEX_APP_SERVER_WS_URL 路由及 Windows 排除默认 daemon 的条件。当前本地 URL transport 未发现 capability-token 注入；需本机认证适配，尚未修改/重启桌面应用。
- 新版 0.163.0-alpha.10.2 使用隔离 HOME、仅回环认证 WS 和合成 Responses provider，10 项检查通过：缺失/错误凭据拒绝、同线程读/恢复、双向名称更新、同活动轮次 steer、双端权威中断终态、断线恢复身份和名称通知。
- 固定 0.159.2 空历史恢复出现真实 lineage 错误；首轮开始后双客户端测试也通过 10 项。正/反例报告保存在 docs/baselines 各版本目录，不把合成模型结果冒充真实账户/原版桌面/安卓真机证据。
- 修复新建会话仅在 Bridge 保存标题的问题：thread/start 后 schema 验证并执行 thread/name/set，再建本地索引。去掉 rollout 丢失时自动 thread/start 并替换绑定的逻辑；rollout/lineage 不可恢复均返回 THREAD_NOT_FOUND，Android 显示原身份保留。fixture 新增两类缺失历史回归验证。
- 验证：最终 Rust 3 单元 + 29 集成测试通过；严格 Clippy 通过；Android testDebugUnitTest + lintDebug 构建成功；新增实验脚本元数据/合成活动轮次两种模式实际执行，新旧 CLI 分别保存结果；脚本 ESLint、Prettier 及 git diff --check 通过。原版桌面和安卓真机尚未验收。
- 未完成：原版桌面接入认证服务、完整桌面 UI/账户入口盘点、真实模型与安卓全链路。阶段 0 保持进行中，不创建虚假的阶段完成提交。

## 2026-10-21 实施记录：技术基准及会话身份保护

- 新增 `CODEX_DESKTOP_BASELINE.md`，记录 Windows 包 26.1013.3656.0、应用 package 26.1013.31256、CLI 0.163.0-alpha.10.2 三个独立版本及传输线索。只读检查安装包元数据与进程已知标志，没有提取用户记录、令牌或修改原应用。
- 新增 `scripts/audit-codex-protocol.mjs`，对选定本机 CLI 分别导出稳定/实验 schema，输出方法清单、相对固定稳定导出的文件差异和摘要哈希。审阅报告在 `docs/baselines/codex-0.163.0-alpha.10.2/protocol-audit.json`；生产 schema lock 未更改。
- 实际导出：105 稳定方法、172 含实验方法。稳定导出 318 schema（新增 4、内容变化 35）；实验导出 452 schema（相对固定稳定新增 138、内容变化 46）。新增方法少不能证明 schema 兼容。
- 修复 writer-conflict 自动 fork 并更换线程绑定的行为，改为 THREAD_IN_USE 保留身份。Android 错误说明明确不会自动创建副本。有/无历史的 fixture 都验证线程 ID 不变，并确认已有轮次不增加。
- 验证：`cargo test --locked --manifest-path desktop/core/Cargo.toml --test native`：28 passed。Android `gradlew.bat testDebugUnitTest lintDebug`：BUILD SUCCESSFUL。审计脚本及报告的 Prettier 检查、生产 `node scripts/schema.mjs`（314 schema）、`git diff --check` 通过。
- 严格 Clippy 发现既有 composer/Goal 代码告警后修正：附件上限计算使用 div_ceil，内部启动参数归组，Goal 路由改用 if let；保留公开 composer 签名并对其参数数量作局部注释豁免。`cargo clippy --locked --manifest-path desktop/core/Cargo.toml --all-targets -- -D warnings` 通过。修正后 `cargo test --locked --manifest-path desktop/core/Cargo.toml --lib --test native`：3 单元测试 + 28 集成测试全部通过。
- 阶段 0 仍待：完整可见 UI/账户入口盘点、桌面共享 endpoint 和同线程双客户端实测、桌面宿主专属接口评估。基准文件已把候选接口与未核验项分开，不宣称阶段完成。

## 2026-10-21 实施记录：CI 与 Pre-release 分发

- 复用既有 Windows/Android CI，增加 workflow_call；分支 push/PR 保留检查，标签发布由独立 prerelease workflow 调用检查，避免重复触发。Windows 构建后运行既有 package:windows 并生成便携 ZIP；两端分别上传可发布附件，缺失文件即失败。
- 按用户修订统一为 `release.yaml`：release 分支 push 创建 Pre-release；标签 push 先验证提交属于 main，再创建正式 Release/Latest。复用双端检查，发布安装器、便携包、debug APK 与 SHA-256 清单。
- README/DEVELOPMENT 补充下载及发布操作、阶段版定位、内部版本号和临时 Android debug 签名限制。未修改运行时权限、协议或既有业务改动。
- 本地验证：两个 workflow 的 Prettier 检查通过；actionlint 1.7.7 静态检查通过（关闭外部 shellcheck/pyflakes）；git diff --check 通过。三份 Markdown 的 Prettier 检查提示格式差异，未对既有文档做全量重排。未执行 GitHub runner、远端 Release 发布或真机安装，不将 YAML 实现视为实际发布成功。
- 下一步：按用户授权推送 release 分支测试，核验双端 CI 和 Release Assets；长期发布需另行配置受保护的稳定 Android 签名与版本递增策略。

## 当前结论

处于阶段 0：仓库实现已初步检查，完整安装版基准和共享运行时可行性尚未核验完成。完整迁移尚未实现，不能据本文件宣称已支持双端共享活动任务。

已完成：持久化用户确认计划、能力域清单、验收要求与 Agent 接手入口；新增连接级能力协商底座（详见本文件实施记录）。完整安装版基准尚未完成，不将本次底座增量视为阶段 0/1 整体完成。

## 已检查的事实

| 事实 | 代码/文档来源 | 验证级别 |
| --- | --- | --- |
| Rust Bridge 经私有 stdio 管理独立 Codex App Server，安卓使用 WSS v1 | `desktop/core/src/codex.rs`、`service.rs`、`rpc.rs` | 静态检查 |
| 当前固定 CLI 0.159.2，稳定 schema 与 Plan 实验 schema 分离 | `packages/codex-protocol/`、`docs/PROTOCOL.md` | 静态检查 |
| 项目同步调用 config/read、thread/list，不等于导入全部桌面会话 | `desktop/core/src/tasks.rs` | 静态检查 |
| 消息/审批/只读 Git、基础会话管理、模型/强度已有 | `service.rs`、`protocol.rs`、Android UI | 静态检查，未复验 |
| 附件、Plan 问题、Goal 已有在工作区中的实现 | `composer.rs`、`tasks.rs`、Android `Composer.kt`、`Questions.kt` | 静态检查，含既有未提交变更 |
| 启动参数包含关闭 Web 搜索、MCP、hooks 的策略；需结合 service 的配置处理核验最终行为 | `desktop/core/src/codex.rs`、`service.rs` | 静态检查，不能推断完整运行行为 |
| Android 主要为 Compose；Markdown 已接 Markwon 和表格插件 | Android `Ui.kt`、`Chat.kt`、`Markdown.kt` | 静态检查 |

文档可能滞后：`CONVERSATIONS_AND_API.md` 中附件未实现描述与当前代码不一致。后续逐项按代码和实际运行更新，不能批量将文档清单当作事实。

## 待完成的阶段 0 事项

1. 只读确认当前安装版桌面版本、运行服务、可用 CLI 和 schema；不读取或输出账户令牌。
2. 盘点实际桌面入口、菜单、设置、实验能力与消息类型，扩展计划中 P01–P17 为逐项矩阵。记录账户/平台不可用项，不猜测桌面功能。
3. 核验公开服务连接/订阅接口及同一活动任务的多客户端能力；只有共享目录不算通过。必要时用隔离会话测试，避免影响用户真实任务。
4. 为桌面专属功能确定版本化适配路径。无法接入则记录具体证据、受影响条目及解决动作，不虚构接口。
5. 完成基准及可行性后，先实现能力协商和共享底座，再推进 UI；不要提前给未接通功能增加空入口。

## 阻塞与未知

| 项目 | 当前状态 | 解阻动作 |
| --- | --- | --- |
| 原版桌面共享运行时连接 | 未核验，不等同已证明不可行 | 检查实际安装版及公开接口并记录证据 |
| 桌面活动线程多客户端操作 | 未核验 | 隔离任务验证订阅、追加、停止、冲突与恢复 |
| 浏览器/自动化/语音等桌面专属接口 | 未核验 | 分域检查服务接口与可版本化本机适配 |
| 当前完整安装版逐入口清单 | 未完成 | 建立可追踪矩阵与截图/流程基准 |

## 工作区保护

本次开始前工作区已有大量未提交修改：Android 聊天、模型、仓库、Compose/Markdown 依赖；Rust build、协议、服务、审批、存储、任务、fixture 与真实测试；Plan 实验 schema；相关协议文档等。另有未跟踪的 Composer、Questions、PhysicalComposerTest 等文件。

这些是既有工作，不能归为本轮新增成果，也不能回滚或覆盖。接手时重新运行 `git status --short` 与定向 diff 确认边界，不直接清理未跟踪文件。

## 验证与交付记录规范

每个实现单元追加日期、关联 Pxx/子项、变更摘要、实际命令与结果、真实上游/真机证据位置、未验证限制、下一步。测试未执行写“未执行”，不能把构建成功写成真机通过。证据中禁止存储凭据、登录令牌和不必要的用户任务内容。

历史构建与验收证据见 `docs/ACCEPTANCE.md`，不自动继承为本次修改的验证结果。

## 2026-10-21 实施记录：能力协商底座（P01/P05）

- 新增 Rust `capabilities` 模块，经现有 `system.capabilities` 调度返回增量字段，保留 v1 既有字段；明确 managed-stdio、bridge-created、未共享桌面运行时、未同步外部线程。不把服务 ready 当作桌面共享成功。
- 安卓新增 `BridgeCapabilities` / `BridgeRuntime`，hello 后每次重连读取并校验协议版本，存在内存状态中；切换主机由新 DeckState 清除。旧响应缺失字段默认为未知/未支持，未知增量字段可忽略。无数据库迁移。
- features 表示已实现能力，不代表已就绪、已授权或经过完整桌面对齐验收。后续新增功能使用相同发现机制，仍需服务端校验。
- 只读实测：PATH 中 Codex CLI 为 `0.163.0-alpha.10.2`，不同于 Bridge 固定 `0.159.2`。这是 CLI 版本证据，不是桌面应用版本。机器上也存在 VS Code 扩展及 AgentDeck 固定 CLI 的运行进程。
- 新 CLI help 显示 `app-server proxy --sock` 可连接运行中的控制套接字，daemon 提供 version 等管理入口。只执行 help 与 version，没有启动、停止、重启服务或启用远程控制。
- `codex app-server daemon version` 失败：默认控制套接字连接报 Windows socket error 10050。不能据此推断所有桌面共享接入不可行；下一步需查明桌面实际 endpoint/传输协议并验证 schema 兼容性，不自动换到默认 daemon。
- `cargo test --locked --manifest-path desktop/core/Cargo.toml --lib`：3 passed（包含能力就绪状态与共享边界测试）。
- `cargo test --locked --manifest-path desktop/core/Cargo.toml --test native capabilities_reports_live_readiness_without_claiming_desktop_parity`：1 passed，验证经真实 Core 调度获得就绪状态，未运行上游模型。
- Android `gradlew.bat testDebugUnitTest assembleDebug`：BUILD SUCCESSFUL；包含旧响应默认值、增量能力字段兼容测试，生成 debug APK，未安装设备。构建有既有废弃 API、SDK XML 和 kapt 提示。
- `cargo fmt --manifest-path desktop/core/Cargo.toml -- --check`、`git diff --check`：通过。
- 未进行真实模型任务或安卓真机验收；没有改变 Codex 版本、默认权限、MCP/hooks/搜索开关。

下一步：确认安装版桌面产品版本与真正使用的服务连接，完成逐入口基准；验证新版服务的共享线程/订阅/并发语义后再设计运行时适配。当前能力协商只报告现状，不开放原始 RPC 透传。

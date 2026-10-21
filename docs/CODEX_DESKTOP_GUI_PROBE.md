# 原版桌面隔离传输探测

阶段 0 开发检查，不是 UI、账户、沙箱、双端任务或安卓验收。不得将通过结果解释为 sharedDesktopRuntime 已完成。

## 运行条件与范围

仅 Windows，使用安装版 ChatGPT.exe、精确 0.163.0-alpha.10.2 原生 codex.exe 和本仓库构建的 agentdeck-codex-proxy.exe。先执行：

```powershell
cargo build --locked --manifest-path desktop/core/Cargo.toml --bin agentdeck-codex-proxy
node scripts/check-desktop-gui-runtime.mjs <ChatGPT.exe绝对路径> <codex.exe绝对路径> <proxy.exe绝对路径> <report.json绝对路径>
```

探测会启动独立原版 GUI，可能显示测试窗口。它校验安装包 bootstrap 的独立 userData 路径设置在单实例锁之前；未知代码布局直接拒绝启动。每次创建全新 CODEX_HOME、Electron userData、Windows profile/AppData 和临时目录，不复制已有数据库、登录或浏览器配置。子进程只继承必要的 Windows 系统变量，设置合成测试环境，不继承账户/API/代理/桌面地址变量。CLI override 会改变 Windows 核心/沙箱启动分支，故此实验不能证明该分支等价。

原生服务使用认证回环 WebSocket，转接程序读取临时相邻 manifest 和独立随机令牌文件。中间观察器校验同一 Bearer，保持 JSON 文本帧，不修改消息语义，仅记录 initialize/config/read 的成功布尔值和 initialized 通知，不持久化参数、完整响应、会话或令牌。原生版本和转接 --version 先行核对；GUI 冷启动最多等待 60 秒。未发送任务或调用模型，未自动批准任何操作。

清理只结束本次 spawn 返回的 PID 树，不按进程名结束当前桌面；关闭探测 socket/服务，移除本次令牌和 manifest。其余全新临时目录保留用于排查，报告不包含该路径或原始日志。不操作生产桌面设置、历史和任务。此探测不适合代替有状态升级测试。

## 证据解释

报告 passed 需要真实原版 GUI 经转接发送 initialize、源服务返回成功、同一 socket 配置读取成功、桌面收到放行后的初始化响应并发出 initialized，以及 GUI 仍在运行。只看到 GUI 进程或端口监听不足以通过。

默认模式报告 visualAcceptance/androidVerified/modelTurnExecuted 保持 false。即使传输通过，仍须验证原版页面、同一任务双端操作、审批、断线恢复、Windows 沙箱/宿主依赖、登录与全部功能矩阵。探测失败先检查观察器、冷启动和具体协议检查点；不能只凭超时宣称不支持。首次开发时观察器曾错误转发二进制帧，修正前的失败不作为原生不兼容证据。

## 2026-10-21 结果

安装版 26.1013.3656.0 的最终报告为 `baselines/codex-0.163.0-alpha.10.2/desktop-gui-runtime-probe.json`，passed=true。bootstrap SHA-256、真实原生版本及初始化/配置/通知各检查点均已保存；退出时两个直接子进程终态均确认，另查 Windows 进程没有本轮临时路径对应的 GUI/原生/转接进程残留。

真实 GUI 返回的 userAgent 包含精确原生版本，但不是先前写死的 `Codex Desktop/` 前缀。转接已按非空 originator + 精确 `/版本 (` 分隔符核验，同时保留原生 schema、认证和版本可执行程序检查。错误版本、相似版本后缀、空 originator 和无分隔符回归均拒绝，且不释放 initialize 响应或转发排队任务。没有改写 GUI 的原 initialize 请求或伪造响应。

下一步是同源会话/活动任务在真实 GUI 与远程客户端间的操作和恢复验证；当前报告没有证明这些行为，sharedDesktopRuntime 继续为 false。

## 扩展：共享索引及外部变更

上述命令末尾加 `--shared-index`，使用独立报告路径（本次为 `baselines/codex-0.163.0-alpha.10.2/desktop-gui-shared-index-probe.json`）。此模式启动回环合成模型，以独立原生客户端创建只读沙箱线程并完成合成轮次，先断言权威 thread/list 确实含该对象，再通过安装版支持的 codex://threads/<id> 参数启动独立 GUI。GUI 初始化后等待打开目标，随后由原生客户端重命名；扩展 passed 额外要求 GUI 的 thread/list 响应包含同一原生 ID，且 GUI 连接收到该 ID/新名称对应的 thread/name/updated。不能以另一个原生客户端读取成功代替 GUI。

未自动批准请求；不使用账户模型，modelTurnExecuted 仅在合成服务实际收到请求时为 true。GUI read/resume 成功另记 desktopOpenedSeededThread；无该证据不称已打开，更不声称内容已渲染。探测不向报告写 threadId、名称、完整消息或参数。退出后仅从本次全新 profile 的日志提取固定代理错误码和“主应用 bootstrap 失败”布尔值，不保存日志原文；读取目录和总字节有界。

最终扩展报告 **passed=false**：合成轮次及源索引成功、前置 GUI 初始化成功，但没有 GUI 索引/打开/重命名通知的成功证据。新发现主连接启动仍追加配置覆盖：起初被普通键名限制拒绝，原生 19 组配置实验证明特殊字符应按字面分段后修复；随后出现 **PROXY_CONFIG_MISMATCH**，独立 GUI 日志确认主应用 bootstrap 失败。前一轮报告只证明前置策略连接，不证明主应用就绪；新报告 mainAppBootstrapVerified=false，保留该区别。

下一步必须核验 GUI 主连接的实际动态覆盖如何与权威运行时/宿主集成保持一致（具体不一致字段尚未采集核验），再继续同源会话和活动任务实验。不能丢弃参数、关闭集成、伪造读到的配置或另起平行线程来获得绿色报告。当前生产桌面和账户保持原样；这只是否定当前隔离配置组合，不是否定所有共享接入路径。

## 显式插件启动配置的共享索引验证

后续诊断收敛为 **PROXY_STARTUP_PLUGINS_MISSING**。安装代码 main-C4DYk222.js 的 `getConfigOverrides` 调用 `yc` 和 `C$e`，分别为 `plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled` 与 `plugins.code-review@openai-bundled.mcp_servers.code-review.enabled` 生成开关。前者依赖 GUI App Tools pipe/插件定义等可用性，后者依赖本地非 WSL 和 Node 解析；不能仅凭这两个键存在认定宿主集成已可用。对应代码文件指纹已在 desktop-ws-environment-audit.json 记录。

在 `--shared-index` 后再加 `--with-desktop-plugin-startup`，用新的独立报告路径运行。该选项仅供本安装基准的隔离实验：校验安装代码含两个已知启动键，向新建原生源服务显式追加这两个 enabled=true 的 -c 参数；GUI 仍独立计算自己的覆盖，转接仍严格核对，不改写或忽略 GUI 参数。不适用于直接部署生产服务，也未实现通用动态参数握手。不同宿主条件使 GUI 选择不同值时仍应失败。

最终 `desktop-gui-shared-index-plugin-startup-probe.json` **passed=true**：合成线程在源索引可见，真实 GUI 自身发起的 thread/list 响应含同一原生线程 ID，GUI 的原生连接上观察到该线程的外部重命名事件；没有代理失败码，测试子进程全部退出，另查没有对应临时路径的进程残留。原来的不带启动配置报告仍为失败，保留作对照，不能用新报告覆盖或删除该证据。

本轮没有观察到 GUI 打开该线程的 read/resume 成功；不声称线程内容渲染或通知后的 UI 名称刷新。`mainAppBootstrapVerified` 和 `desktopPluginStartup.hostIntegrationVerified` 保持 false；通过的是明确的索引/连接事件检查，不是完整主应用、插件工具调用或双向活动任务验收。测试模型只是回环合成服务，另一客户端也只是原生协议探测客户端，不冒充安卓或已配对 Bridge。下一步验证实际打开/内容、双向操作与活动任务，以及 GUI 宿主 pipe/环境对共享服务的真实集成方式。

## 限时检查与后续线程读取证据

命令可追加 `--inspection-seconds=120`，在协议检查后保留本次独立实例，随后沿用原有 finally 清理。只接受一次该参数及 5..300 的十进制整数秒；额外等号、重复参数、空值、浮点及范围外值均拒绝。默认不等待。等待期继续观察协议，因此最终报告可包含检查期间到达的结果；该选项不自动点击、修改首次设置或完成 UI 验收。

后续同配置运行保存为 `baselines/codex-0.163.0-alpha.10.2/desktop-gui-inspection-probe.json`，passed=true，并首次观察到 desktopOpenedSeededThread=true：GUI 自己请求的 thread/read 或 thread/resume 成功响应包含原线程 ID。它只证明线程读取，不证明完整历史内容或渲染，也不区分这两个方法。报告不保存 ID 或响应原文。索引和外部重命名检查仍通过，子进程退出，无固定代理错误码。

本次独立窗口的只读可访问性观察显示首次职业/个性化设置页（含 Engineering 等选项、个性化建议复选框和未启用的 Continue）；没有输入、点击、代填职业或修改个性化设置。该页面与后台读取成功可以同时存在，不能把页面解释为协议读取失败，也不能把后台读取解释为用户已看到会话。可见内容验收仍未完成；后续需核验受支持的独立测试初始化方式，不能复制生产配置/私有数据库或绕过账户与隐私选择。

## 严格历史内容探测

在共享索引命令后追加 `--shared-history`，使用单独报告路径。该选项要求 `--shared-index`；通过条件额外要求 GUI 自己请求所得的成功响应包含同一线程、同一轮次的完整用户输入和完整助手回复，分别记录 desktopReceivedExactSeedInput/desktopReceivedExactSeedAnswer。不注入 GUI 请求，不把直接客户端响应或 thread/list 元数据算作内容。原有检查后最多再观察 30 秒；缺少任意原文即失败，不能只凭 desktopOpenedSeededThread 通过。

观察覆盖 thread/read、thread/resume 内嵌 turns，以及 GUI 请求的 thread/turns/list 和 thread/items/list 分页响应；分页通过原请求 threadId 和返回 turnId 关联。只在内存比较合成原文，持久化布尔值；不保存请求、响应、线程 ID 或内容。回归命令：`node --test scripts/lib/gui-history.test.mjs`，包括跨线程/轮次误归属、元数据、原文片段和错误回复的拒绝。此检查仍不能证明 UI 渲染、长历史全量分页、生产账户或安卓真机。

真实结果保存在 `baselines/codex-0.163.0-alpha.10.2/desktop-gui-history-probe.json`：**passed=false**，GUI 线程元数据读取、列表和外部重命名仍成功，但两项完整原文检查均 false。固定请求诊断确认观察期内 GUI 未请求 seed 的 includeTurns=true、thread/turns/list 或 thread/items/list；没有代理失败码，子进程退出。不能把上一轮 desktopOpenedSeededThread=true 解释为完整历史加载，也不能把本次未请求历史解释为上游接口拒绝历史。下一步核验首次设置/深链接导航的受支持测试路径，并先交叉核验源服务的完整合成历史，再验证 GUI 实际请求、内容及双向操作。

后续探测在启动 GUI 前新增源服务 thread/items/list 交叉核验，只认可原线程和轮次的完整合成输入/回复；缺失则在启动 GUI 前失败，不能将无效种子解释为 GUI 缺陷。更新的真实报告 sourceRetainsExactSeedInput/sourceRetainsExactSeedAnswer 均 true，而 GUI 原文及历史请求仍 false。因此本次缺口不是源合成历史未保存；并未因此证明生产数据、长历史全量分页或可见内容通过。

## 首次启动路由的只读代码核验

运行 `node scripts/audit-desktop-onboarding.mjs <app.asar绝对路径> <report.json绝对路径>`。严格匹配安装版 app-initial 中已知纯路由函数，未知布局失败；只在 VM 中以合成状态运行该函数，不执行 bundle、不访问生产配置、不调用账户或首次设置 API。`baselines/codex-0.163.0-alpha.10.2/desktop-onboarding-route-audit.json` 保存文件指纹、字符偏移和 10 组结果。

本安装基准的合成 allowed/local 状态无工作区时选择 welcome，有工作区或已有完成状态时选择 app；加载状态可暂不选页。需要登录、缺少 ChatGPT token 或 gateway 要求登录时，即使已有工作区或完成标志也仍选 login。它仅说明路由条件，不证明这些合成状态就是当前 GUI 实际状态，也不证明创建原生线程的 cwd 等于桌面工作区根目录。supportedFixtureSetupVerified 仍 false；后续应查清桌面工作区的受支持设置接口和深链接延续路径，不写入伪造完成标志、复制生产 profile 或以源码分支推断 UI 已可用。

## 原生项目共享索引

共享索引命令可追加 `--with-native-project`（必须有 `--shared-index`），以新报告路径运行。该选项在全新隔离源服务通过 project/create 创建真实项目，参数为 name、roots（path 对象数组）、metadata 和稳定 idempotencyKey，再以源 project/list 核验创建返回的 ID。随后 thread/start 发送该 projectId，观察 GUI 自己的 project/list 响应是否包含同一 ID；新增通过门槛要求两端列表均含原项目。不写入私有数据库或桌面 global-state，不添加首次完成/职业/个性化设置标志。没有核验线程归属返回字段，不凭发送 projectId 声称归属已验收。

安装代码 main-C4DYk222.js 的 writeAppServerProject/listProjects 明确使用这些原生接口；initializeProjects 读取服务项目并维护原生/legacy ID 映射，且仍使用桌面缓存/迁移状态。src-Dtwb7yKT.js 的 projects 最低版本为 0.148.0-alpha.21。代码读取只是接入定位，不能证明全部项目元数据或侧栏已经迁移。

真实 `baselines/codex-0.163.0-alpha.10.2/desktop-gui-native-project-probe.json` 中 sourceListedSeedProject、desktopRequestedProjects、desktopListedSeedProject 均 true，源完整输入/回复仍存在，同线程列表/读取和外部重命名仍通过；完整 GUI 历史检查仍 false，整体 passed=false，子进程退出、无代理失败码。因此原生项目共享列表已取得真实证据，但添加原生项目本身没有使 GUI 请求历史；尚未证明可见侧栏、桌面工作区根目录状态、首次设置完成、线程项目归属或双向项目操作。下一步应将原生项目身份及桌面本机导航偏好分别建模，继续核验实际导航阻塞，不把项目列表成功冒充 UI 或阶段 1 完成。

## 项目生命周期与通知排除

后续 `--with-native-project` 增加严格门槛：以相同 idempotencyKey/相同参数重复创建须返回同一 ID；首轮合成任务完成后通过源 thread/read 核验持久 projectId，GUI 自己读取的原线程也须携带同一 projectId；源 project/update 重命名后通过 project/read 核验新名称，再观察 GUI 的 updated 通知和项目 read/list 中的新名称。通知仅在本次重命名开始后计入，不将启动期间其他变化算作成功。线程读取安排在首轮持久化之后，不用尚无历史时的读取失败否定归属功能。

最新实验请求/响应约束来自精确安装版的隔离 `generate-json-schema --experimental` 导出：project/create 的 name、roots、idempotencyKey 必填，metadata 为字符串值映射；thread/start 的 projectId 用于持久线程归属，thread/read 返回权威 projectId；project/changed 只含 projectId/changeType，updated 是有效枚举。未手改既有 schema lock，也未将实验接口加入安卓生产协议。

真实 `baselines/codex-0.163.0-alpha.10.2/desktop-gui-project-lifecycle-probe.json` 确认创建幂等、源/GUI 原线程归属及源重命名持久化均 true。源更新连接收到 project/changed，但 GUI 未收到该通知、未读到新名称，**passed=false**。本报告未开启 --shared-history，不将未开启的严格历史门槛混入项目生命周期结论；此前历史负面报告保留。子进程退出，无代理失败码。

新增诊断 desktopOptedOutProjectChanged=true：至少一个 GUI 连接的真实 initialize.capabilities.optOutNotificationMethods 明确包含 project/changed。只读安装代码 src-DsLVGakC.js 的 initialize 构造使用公共排除表，src-Dtwb7yKT.js 的表把 project/changed 标为 false。这解释了相应连接不接收事件，不是服务端普遍无事件的证据，也未证明所有连接的订阅或跨客户端广播。源连接收到通知不能代替第二个未排除客户端的广播测试。

接入结论：原生项目列表/归属有路径；桌面活动项目更新还需核验宿主缓存、发布与跨端变更入口。不能为了通过探测而修改 GUI 自己的 initialize、移除排除项、伪造变更通知或写入私有全局状态。下一步应定位宿主 projectBackend/publishProjects 的受支持调用和生命周期，并验证独立原生客户端广播；可见侧栏、新名称刷新、双向操作及完整共享运行时仍未验收。

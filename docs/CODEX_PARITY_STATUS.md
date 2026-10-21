# 完整迁移开发状态与接手记录

最后更新：2026-10-21。

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

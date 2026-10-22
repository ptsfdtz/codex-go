# 账户、执行配置与技能

[协议总览](../PROTOCOL.md) · 合约正文按功能归档；能力标志不代表完整迁移已验收。

## Read-only account and usage summary

`accountSummary:true` enables read-only `account.status {}`. Bridge reads native account/read with refreshToken:false and account/rateLimits/read, validates the locked schemas, then returns an explicit display-only projection: account type/email/plan, requiresOpenaiAuth, usage buckets/windows/credits/spend-control flag, optional ordinaryUsageAllowed and readAt. A usage request failure can return an account summary with usageErrorCode; raw backend errors, account IDs, auth fields, upsell contents and unknown keys are not forwarded. A second account read and runtime-generation check refuse mixed snapshots. Availability is taken only from an explicit backend boolean, never inferred from percentages or reset timestamps.

This read does not enter the durable mutation journal, emit account contents into Bridge events, refresh credentials, or perform login/logout. Android retains the response only in the open settings page and clears it on host/connection changes. There is no realtime account-change subscription in this unit; use the explicit refresh and read timestamp. Existing clients remain unchanged.

## Display projection of effective execution configuration

`executionConfigView:true` enables read-only `settings.execution {projectId?}`. Project context is resolved solely from an enabled Bridge grant and revalidated after native config/read with includeLayers:true. Omitted projectId means the service default context. Current RPC generation must remain unchanged.

The response includes projectId, a bounded allowlist of scalar execution settings, source types for those keys, up to 128 layers with the same projected values and a disabled boolean, workspacePolicyCompatible, sandboxVerified and readAt. It excludes raw config, instructions, credential maps, source file/profile/enterprise metadata, versions and disabled-reason text. Complex values are represented as null instead of forwarding arbitrary objects. Policy compatibility is a read-only observation; it does not change runtime readiness or authorize execution. Clients must label this as a display view, not a complete config editor, and retain the response only in page memory. Existing retention settings.get/update remain unchanged.

## 2026-10-22：结构化技能选择（增量 v1）

`skills.catalog {projectId}` 返回授权项目的技能投影，新增 `skills[].id` 为名称与上游路径组合的 SHA256 标识；标识不是访问令牌，安卓不获得技能路径。`projectSkillCatalog` 表示目录，`composerSkills` 表示结构化发送。

`turn.start` 可选 `skills: string[]`，最多 8 个目录标识；缺省保持旧行为。电脑发送前以同一授权项目 `skills/list(forceReload:true)` 重新取权威目录，拒绝重复、失效、歧义或已禁用选择，并只用匹配条目的 name/path 构造原生 `{type:"skill",name,path}`。复查项目授权根和 runtime generation，不读取技能正文，不扩大执行权限。该读取和上游启动非原子事务，技能文件仍可能在运行时变化。原生 schema 保持导出内容，不手工修改。

原有 `start_turn_composer` 方法保留兼容入口；新内部选项与 `start_turn_with_skills` 复用原启动锁、模式、权限、生命周期和去重。`turn.queued` 增量 `skills` 只含名称以供即时展示；旧客户端忽略。当前 queue.add/start 和 active steer 不支持技能，安卓保留草稿并阻止丢引用发送。结构化历史修订仍未支持技能重放。

2026-10-22 增量：queue.add 同样接受可选 skills 标识数组，受 nativeQueueSkills（仅锁定桌面 profile）门控。入队重新解析，queue.start 对原生技能输入重新核验当前目录身份/启用状态，沿原生队列执行。active steer 和结构化历史修订仍未支持技能；上述旧队列不支持说明由本增量覆盖。

2026-10-22：nativeQueueResourceEdit 支持保留图片/技能的单段文字队列编辑。queue.list 新增 inputRevision；queue.update 增加 expectedInputRevision，资源编辑必填匹配值，旧文字请求可省略。不支持多段或结构化 text_elements 编辑，不承诺跨客户端原子条件更新。

2026-10-22：sessionSkillRevision 表示 sessions.revise 可从权威原生输入保留 skill。回退前和新轮次准备时重新检查目录身份与启用状态，响应增量 retainedSkills，retainedImages 为实际图片计数。仅一段普通文字，不接受客户端资源路径，仍非原子回退/发送。

2026-10-22：projectFileBrowser 能力提供 files.list {projectId,directory?}，directory 为项目相对目录（根目录用空串）。返回同 projectId/directory、entries（name/path/kind/size）和 truncated；最多扫描 4000 项，不读取正文，不等价于 mention/文件引用授权。

2026-10-22：projectTextPreview 提供 files.readText {projectId,path}，path 为授权项目相对文件路径。实际文件句柄授权、普通文件、最多 256 KiB 严格 UTF-8，无 NUL；返回 projectId/path/text/size/sha256/encoding。正文读取不是原子快照。files.list 另增加 384 KiB 元数据响应预算，达到任一边界时 truncated=true。

2026-10-22：projectFileReference 提供 files.reference {projectId,path}。仅授权项目内实际句柄普通文件，返回 projectId/path/referenceText（已转义 Markdown 文件链接）。客户端追加至草稿文字，沿普通 text 输入发送；不是原生 mention、文件内容快照或额外执行授权。

2026-10-22：skillConfiguration 提供 skills.setEnabled {projectId,skillId,enabled,expectedEnabled}，按设备请求持久去重。目录身份和预期状态校验后调用原生 skills/config/write，返回 projectId/skillId/requestedEnabled/effectiveEnabled；写入结果不确定时 OUTCOME_UNKNOWN，须刷新核对。此配置可能影响其他项目，非原子跨客户端 CAS，不接受客户端技能路径。

## 默认模型配置写入（增量，未通过真实上游验收）

能力 modelDefaultsWrite 提供 settings.modelDefaults：必填 model、expectedUserRevision（64 字符 SHA256 摘要），可选 effort；executionConfigView 的无 projectId 读取响应新增可空 userRevision。旧客户端忽略增量字段，项目读取不提供可写版本。服务端仅从权威配置唯一启用的基础用户层取得 filePath/version，以 config/batchWrite 的 expectedVersion 写 model/model_reasoning_effort 两键；缺省 effort 发送 null，实际清除行为仍待真实锁定源验收。客户端不能指定任意配置键/路径。模型与强度经 model/list 核验，不修改权限或沙箱。响应 status/overridden 表示原生写入与覆盖状态，不承诺已加载会话改变。设备持久去重；写入未确认、写后 runtime/响应校验异常统一 OUTCOME_UNKNOWN，必须刷新核对后再操作，不自动重试。不导出原始配置、路径或凭据。

## Model catalog display metadata (additive)

models.list also projects native description (empty when unavailable) and inputModalities (empty when not reported). These are display metadata, not media authorization or a promise of client media support. No schema export or version lock changes. Existing Kotlin clients ignore unknown fields; new clients default missing fields for older servers. Hidden models remain omitted. Selection and reasoning validation remain server-owned.

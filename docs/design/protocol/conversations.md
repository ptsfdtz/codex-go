# 会话、历史、执行与目标

[协议总览](../PROTOCOL.md) · 合约正文按功能归档；能力标志不代表完整迁移已验收。

## Latest native turn (additive contract 1)

`latestUpstreamTurn:true` advertises read-only `turn.latest` with required `{sessionId,contractVersion:1}` and no caller-supplied native thread ID, project scope, cursor or limit. This is available for both locked profiles. Old servers reject the new action; clients must capability-gate it. No database migration or mutation-journal entry is used. Remote dispatch has a 30-second overall timeout and returns UPSTREAM_TIMEOUT on expiry.

Response: `{contractVersion:1,sessionId,upstreamThreadId,threadStatus,turn:{upstreamTurnId,status}|null}`. `turn:null` means the source descending turn list returned no turn, not that a previous turn succeeded. `status` is the validated native status (including `inProgress`); no items, error details or task content are projected. Empty/incomplete identities, an over-limit source page, deleted threads, changed grants, changed session mapping or replaced/dead runtime fail explicitly.

The server resolves the original thread from the authorized Bridge session, checks public thread/read identity and exact cwd authorization, then requests thread/turns/list with limit 1, descending order and itemsView notLoaded. It rechecks authorization, deletion and runtime generation before returning. It never resumes a thread or modifies execution settings. Existing turn.active reuses the reader and retains its old response and active-state checks.

This is a fresh bounded observation, not an atomic combined thread/turn snapshot or a subscription. threadStatus is observed before the turn page; clients must reject conflicting/unknown state and bind results to the expected host, connection, Bridge session and native thread. New activity can begin after any read. Android now capability-gates bounded native replay checks, requiring exact latest terminal identity and idle thread status. This is not atomic notification delivery or shared-desktop acceptance; see ANDROID_NOTIFICATIONS.md.

## Conversation options and independent API mode

## Additional instructions for the exact active turn

`activeTurnSteering:true` enables `turn.active` (`sessionId`) and `turn.steer` (`sessionId`, `expectedTurnId`, `text`). The read endpoint checks the original thread/cwd against the current project grant and uses `thread/turns/list` with one descending `notLoaded` entry; it returns `sessionId` and nullable `upstreamTurnId`. A source reporting active without a visible turn identity returns `TURN_STATE_UNAVAILABLE`, not an inferred terminal result.

The write endpoint rechecks authorization and the active identity, requires the normal verified boundary, and sends the native `turn/steer` precondition. It never starts, resumes, forks or switches models/permissions. A changed target returns `TURN_CHANGED`. It participates in per-device durable request reservation; the native clientUserMessageId is derived from the device/request pair. Accepted instructions append `turn.steered` with text and native turn identity, linked to a local turn only when one already exists. An acknowledgement means accepted, not completed. Transport loss, invalid acknowledgements or failed post-acceptance persistence return `OUTCOME_UNKNOWN`; no automatic resubmission occurs. A cancellation-safe busy guard releases contention on every exit.

Android keeps Stop available and adds a text-send action while the selected session is active and the capability is present. It fetches the current identity before steering, preserves the draft on failure, and projects accepted additions as separate user rows without overwriting the initial input or duplicating replay. This first endpoint accepts text only; attachments, queued instruction management and external approval ownership remain pending. Incremental external observation and stopping are described below; they do not constitute full active-task parity.

## Persisted upstream history (incremental v1 capability)

`upstreamHistoryPages` enables `sessions.history` with `sessionId`, optional opaque `cursor` (up to 32768 characters) and `limit` (1–50, default 20). Returns `sessionId`, `source: upstream-persisted`, native `ThreadItemEntry[]` in `data`, `nextCursor` and nullable `resource`. Reads schema-validated `thread/items/list` in ascending order after checking upstream thread identity and exact granted cwd. This is separate from `sessions.detail` / the bounded live event journal; it does not insert fabricated events or change thread IDs.

Pages are reduced to fit 384 KiB. A single oversized entry returns empty `data` and a resource descriptor containing the original cursor, SHA-256, byte count, item/turn IDs and `chunkBytes: 49152`. `upstreamHistoryContent` enables `sessions.historyContent` with `sessionId`, the same optional cursor, lowercase `sha256` and byte `offset`. Returns base64 `data`, exact identity/offset/totalBytes and nullable `nextOffset`. Every chunk rechecks the grant and current source hash; changed content returns `CONTENT_CHANGED`, so callers reload the page. Content is not snapshotted or cached by Bridge. The upstream transport still has an 8 MiB frame ceiling; this is not an unlimited file/media transfer API. `fullHistoryRead` remains false.

Android provides an online saved-history viewer with bounded page navigation, text selection and complete raw entry inspection. It reconstructs large entries, verifies SHA-256 and item/turn identity, and discards results after host switching. The main Android timeline now also reads the latest persisted page when ordered history is supported, and merges items by native turn/item identity with journal previews; media rendering and all native semantic types remain pending acceptance.

Session records add `archived` and `pinned` (integer 0/1), `model` and `effort` (strings, empty means Codex default). The optional turn parameters are validated against the live account catalog, then forwarded as official `model` / `effort`. Session management requires no queued/running/waitingApproval/unknown turn. Rename/archive/restore/delete wait for a schema-valid upstream response before updating local records; pin is local. A crash between upstream and local persistence can still leave an unknown outcome and requires reconciliation, never an automatic retry.

Deletion emits `session.deleted` and removes local turn/approval/event history. Removing history raises the replay floor so older cursors require a fresh snapshot. Android removes vanished sessions from its cached events and selected view. In attached mode, validated thread metadata notifications trigger an authorized index refresh. Attached mode also handles schema-validated thread/deleted notifications (`externalThreadDeletionEvents:true`). A durable local tombstone is recorded immediately; cache deletion waits for local contention to finish, atomically erases retained session data and emits session.deleted, preserving replay-floor/sequence rules. Tombstones prevent stale index pages from resurrecting the identity. Missing list entries are still not evidence of deletion; deletions missed while disconnected have not been reconciled.

Independent Android API conversations do not use WSS or Codex credentials. They use HTTPS OpenAI-compatible Chat Completions with `reasoning_effort` (different spelling from Codex `effort`); see CONVERSATIONS_AND_API.md.

`turn.start.permissionMode` is an authenticated per-turn choice: `full` maps to Codex `dangerFullAccess` + `never`; `workspace` (also the legacy omitted-field default) maps to `workspaceWrite` + `on-request`. Android remembers the composer selection and initially uses full access. `turn.queued` records the selected mode. Switching mode is allowed between turns; both upstream policies are explicitly reset each time.

`activeTurnInterruption:true` enables `turn.interruptActive` with exactly `sessionId` and `expectedTurnId`. It shares active identity, project grant, verified boundary and durable per-device mutation checks with steering. A changed target returns `TURN_CHANGED`. An active native Goal is paused before native `turn/interrupt`, preventing its scheduler from continuing after Stop. The response `{sessionId,upstreamTurnId,requested:true}` acknowledges the request only; it does not assert termination. Unknown interrupt acknowledgement or failed post-acceptance persistence returns `OUTCOME_UNKNOWN` without automatic retry.

`turn.interruptRequested` includes the native turn ID. For imported external turns, a schema-valid native terminal notification produces `upstream.turn.completed` with `upstreamTurnId`, terminal `status` and nullable `error`; no local turn is fabricated. Stop also queries the latest native turn summary up to 20 times at 100 ms intervals because an unsubscribed connection may not receive terminal notifications. Queries stop on source failure or a different latest identity; late/unobserved terminals can remain pending and require history refresh. This bounded reconciliation is not full subscription/offline recovery. Android preserves a confirmed terminal row if a late request event arrives. Existing local `turn.interrupt` remains compatible.

## Observing original external threads

`externalThreadObservation:true` is available only for attached runtimes. `sessions.observe` accepts exactly `sessionId`. It checks the authoritative thread ID and canonical project cwd, queries bounded native `thread/loaded/list` pages, and rejoins the same loaded thread using `thread/resume` with `threadId`, the identical `cwd` and `excludeTurns:true`. No model, approval or sandbox override is sent. It does not mark the thread execution-ready in Bridge's `loaded` cache; later execution retains its independent policy checks. Native errors are not repaired with a fork or permission change.

Returns `{sessionId,upstreamThreadId,observing:true}` after a verified join. Unloaded threads return `observing:false,state:"waitingForSource"`; observation does not intentionally initialize their execution environment. Native unloading can race the public read/rejoin calls, so this is not an atomic native loaded-only precondition. Archived/unloaded notifications invalidate the subscription marker. The in-memory desired set (maximum 128 conversations) survives upstream reconnects in the same Bridge process; the attached index worker restores it on reconnect and source metadata changes. Revoked/deleted sessions are dropped, and one failed join does not prevent attempts for other sessions. Bridge process restart relies on Android's selected-conversation refresh to register again. There is not yet an unobserve/lease API or durable full subscription registry.

`session.observed` records successful joins with native effective model, approval policy and sandbox metadata. Validated external turn/item/delta notifications append `upstream.progress` with native `upstreamTurnId`, native fields and `method`, with no fabricated local turn. `upstream.turn.completed` is deduplicated with reconciliation in the same journal transaction; replay does not consume a new event sequence. Oversized previews retain native turn/item identity. Android scopes live rows to native turn/item IDs, renders external user text, and lets complete assistant/tool items replace streamed previews. Full semantic media rendering, joining persisted history into the live timeline, deltas missed before subscription or during outages, and external approval ownership remain pending. The saved-history API remains the source for complete persisted content.

Android requests observation when opening/refreshing a supported conversation and after its WSS reconnect. A waiting source shows a historical-view notice and still allows saved-history reading. Old managed services keep the existing behavior through capability gating. This is not proof of an authenticated connection to the original desktop application.

## Ordered history and the Android conversation timeline

`upstreamHistoryOrdering:true` adds optional `sortDirection` (`asc` or `desc`) to `sessions.history` and `sessions.historyContent`. Omission preserves ascending order for older clients. Page responses echo `sortDirection`; cursors belong to the selected direction, which must also accompany every large-resource chunk request. Hash/identity checks remain in force: applying a descending resource hash to an ascending entry returns `CONTENT_CHANGED` rather than unrelated content. The native schema, cwd grant, page limits and chunk limits are unchanged.

Android opens the latest descending page in the main conversation view and reverses it for chronological display. Older pages prepend by native `(turnId,item.id)` identity, with cursor-cycle checks and a 16 MiB JSON-content budget in memory. The independent paged history inspector still provides access to complete records, including items above the main timeline's 128,000-character preview. This is not a second business database or a synthesized journal; Room's schema remains unchanged.

`conversationTimeline` maps Bridge-owned turn IDs to source IDs using snapshot/validated event identities, merges matching native items, and suppresses the optimistic initial input when its native user item is present. Completed live items can replace saved previews. Saved content is not evidence of completion; possibly overlapping deltas are never concatenated onto a saved prefix. Refresh, selected-conversation reopen, WSS reconnect, source observation/reconnect and observed terminal events request a new latest page. A refresh replaces the previously loaded native page window; the user can then page backward again. Request revision, selected session and host epoch prevent obsolete requests from changing another view. Observation failure does not block separately authorized history reads.

Remaining limits include persistent offline history caching, terminal/event reconciliation beyond persisted content, full revert/deletion invalidation against retained journal previews, complete media/semantic rendering, and exact correlation of accepted steering instructions with native echoed user items. Active saved items can show a snapshot until a complete live item or another history refresh arrives; the protocol has no shared atomic snapshot/delta cursor. These limits keep fullHistoryRead/sharedDesktopRuntime/externalThreadSync false. No original-desktop or Android device acceptance is implied by the isolated Core and JVM checks.

## Native conversation fork (additive)

`sessionFork:true` advertises `sessions.fork` with exactly `{sessionId}`. It creates a new authoritative thread through the selected locked profile's `thread/fork`; it never copies Android messages or replaces the source mapping. Response is `{session:<new or concurrently imported Bridge session>,sourceSessionId}`. Older clients remain unchanged; clients must hide the action when the flag is missing. No database migration is required; existing session_metadata stores forkedFromId and source attribution.

Forking currently requires a locally reconciled idle source, a fresh authorized native identity/cwd check and a verified execution boundary. The fork uses workspace approval defaults, never inherits an unconfirmed full-access choice, starts no turn and does not rename the source. Concurrent native-index import reuses the exact derived native identity. The existing per-device request journal deduplicates the mutation. Transport loss or failure after upstream submission returns OUTCOME_UNKNOWN; refresh the authoritative index before considering any new request. Automatic resubmission is unsafe. The initial operation forks all persisted history; selecting a turn boundary, edit/resend and retry remain separate pending work. This implementation is not original-desktop or physical Android acceptance.

## Fork at a persisted turn

`sessionForkAtTurn:true` allows optional `lastTurnId` on sessions.fork. It must be an original upstream turn ID belonging to the authorized source. The Bridge searches up to 100 pages of 100 metadata-only turns, rejects repeated cursors, oversized pages, absent boundaries and nonterminal boundaries, then forwards the inclusive lastTurnId to thread/fork. Omission retains full-history behavior. Android offers the operation on source-identified assistant messages; it does not send local turn IDs. Forking at a reply includes that reply and excludes later turns. This operation is distinct from editing/resending an earlier user message. Neither locked schema currently exposes thread rollback; no unsupported raw method is called to simulate it.

## Native persisted history revision

`sessionHistoryRevert:true` adds `sessions.revert` with required `{sessionId,beforeTurnId,expectedLastTurnId}`. It calls stable `thread/revert` in the existing locked protocol, retaining the same upstream identity and the prefix before the specified native turn. It never reverts workspace files. The target must exist and be terminal; local active/unknown work, archived sessions, authoritative nonidle state, changed expected last turn, grant or runtime are rejected. Requests use the durable device mutation journal; unknown submitted results must not be automatically retried. Native revert has no atomic expected-revision field, so the double-read check does not provide an atomic cross-client revision guarantee.

`sessionHistoryEvents:true` maps validated current-generation `thread/reverted` to content-free `session.historyChanged`. Old Bridge previews and terminal-turn caches are invalidated and the replay floor advances; active/unknown reconciliation records remain. Clients must cancel old history reads, clear cached session events and rebuild from native history. A replay-gap snapshot recovery must also clear prior events. The additive Android historyGeneration/historyRevision guards do not change Room schema.

Android text edit/resend and retry perform revert, then a separately acknowledged normal turn.start with current composer model/effort/permission choices and session mode. They are not an atomic native retry transaction; if the second step fails, history may already be reverted. Only an exactly recoverable single text user input is enabled at present; attachment and multi-input replay remain pending. No automatic resend after unknown outcomes.

History revision also rejects an active native Goal and validates the returned thread cwd. Android revision attempts expose progress and block a second destructive confirmation after an unsuccessful attempt; the user can refresh state and preserve the pending text in the existing draft. Replay eligibility excludes nonempty text_elements until structured-reference replay is supported. A confirmed turn.start followed by a refresh failure is not classified as an unconfirmed send.

## Resource-preserving revision

`sessionResourceRevision:true` adds `sessions.revise` with required `{sessionId,beforeTurnId,expectedLastTurnId,itemId,text}` and optional existing `{model,effort,permissionMode,mode}`. One durable device request and one local session lock cover native source resolution, revert and replacement turn submission. The native operations remain separate, with no atomic expected-revision contract or rollback of workspace files.

The server resolves the exact saved user item in the granted original thread (bounded 100 pages × 50 items), requires exactly one user input for the target turn, and preserves its authorized localImage parts alongside replacement text. Client-supplied resource paths are not accepted. Structured text elements, remote media, voice and multiple user inputs are currently rejected before revert. Local image authorization and format/size bounds match native queue execution; resources are not downloaded to Android or reuploaded under the phone attachment limit. Resources are checked again while preparing the replacement turn, but native path reopening is not atomic with validation.

After confirmed revert, replacement failures return `REVISION_SEND_FAILED`: persisted history has already changed and the send may need reconciliation. Never automatically repeat the combined request under a new operation id. Old clients continue using existing text-only revert/start, and ordinary turn.start and upload contracts are unchanged.

## 会话用量通知与实时内容增量

sessionTokenUsage 能力新增 session.tokenUsage 事件，payload 为 upstreamTurnId 与 tokenUsage（原生 last/total/modelContextWindow）；经锁定 schema、当前 runtime generation、已映射会话与项目授权检查。仅观察，不创建或绑定轮次；沿既有有界事件缓存重放，不保证完整累计存储。旧客户端可忽略事件。三个 item/reasoning/\* 分片通知沿既有 turn.progress/upstream.progress 传输，使用原生索引与轮次/item 身份，不新增文本推断或执行能力。完成记录仍为展示权威来源。

## 原生会话目标只读视图

sessionGoalView 提供 sessions.goal {sessionId}，返回 sessionId/upstreamThreadId/goal（可空）/readAt。先校验原生 thread/read 工作目录，再读取 thread/goal/get；核对目标线程、读后项目授权/映射、删除状态和 runtime generation。目标正文上限 128000 UTF-8 字节。只读，不修改状态/预算，不恢复任务，不把本地 mode 当目标权威；旧客户端忽略新增能力。

## Existing native goal editing (additive)

sessionGoalEdit gates sessions.goal.edit with required sessionId/objective/expectedGoalRevision and optional positive signed-64-bit tokenBudget. sessions.goal adds nullable goalRevision, a SHA256 digest of the authoritative full goal JSON. New clients require this revision; older clients ignore the added field. Objective must be nonblank and at most 128000 UTF-8 bytes. Omitted tokenBudget preserves the current budget; null/removing budget is not supported by this action.

The server uses the existing session management lock, rejects archived/active/unreconciled conversations, resolves native identity and cwd/root, requires an existing non-active goal and idle source thread, rereads and compares the goal revision, then sends thread/goal/set with user provenance on the locked desktop profile. It changes only objective and optional budget, without status, turn/start, permission or sandbox changes. This does not resume execution. Grant/mapping/deletion/runtime checks run before and after the write; response and fresh read must match identity, text, budget and preserved status. Durable device request dedup applies. Any failure after submission becomes OUTCOME_UNKNOWN; refresh rather than automatically retrying.

The native API has no atomic expected-version write. Local locks and rereads cannot eliminate another native client's change between checking and writing. Fixture evidence verifies identity/revision/dedup/state boundaries, not true multi-client CAS or real-source edit behavior. No database migration, credential projection or schema-lock modification.

## Clear existing inactive goal (additive)

sessionGoalClear gates sessions.goal.clear, requiring sessionId and expectedGoalRevision, no status/objective/budget fields. It shares the edit lock, identity/root/grant/runtime/deletion/archived/idle checks and rejects missing or active goals. Calls locked thread/goal/clear with user provenance where supported, validates cleared:true and a fresh null goal. Uses durable device request dedup; post-submission failure is OUTCOME_UNKNOWN. No turn is started, no thread/history/files are deleted by Bridge. The same native non-atomic check/write window applies. Old clients ignore the capability, old servers reject this action. No database/schema-lock migration.

## 恢复现有目标（增量，阶段未验收）

`sessions.goal.resume`（能力 `sessionGoalResume`）必填 `sessionId`、64 位十六进制 `expectedGoalRevision`，无可选字段。只恢复原线程 paused/blocked 目标；复用输入执行锁和持久请求去重，检查目标摘要/原线程及 idle，然后原生 goal/set 激活并 turn/start 发送继续指令，响应为原会话 Turn（含 upstreamTurnId）。保持目标正文、预算与累计统计，固定 workspace/on-request，使用已保存或默认模型。激活提交后不能确认返回 OUTCOME_UNKNOWN，客户端刷新核对，不自动重试；原生没有 CAS，摘要双读不代表跨客户端原子操作。旧客户端不受影响，导出原生 schema 不变。

## 原线程上下文压缩（增量，阶段未验收）

`sessions.compact`（能力 `sessionCompaction`）仅接受 `sessionId`、`expectedLastTurnId`。复用会话管理锁与设备请求持久去重，要求执行边界已验证、原会话未归档/无本地运行或未知任务、原线程 idle 且已有保存轮次，无 active 持续目标。核对原线程/项目授权/root/runtime/删除状态和最新轮次，双读相同后调用既有 `thread/compact/start`，不自动 resume、不改执行权限、不创建替代线程或本地假轮次。原生接口无 CAS，双端竞态仍可能存在。

成功仅返回 `{sessionId, upstreamThreadId, accepted:true, completed:false}`，表示原生接口受理，不保证压缩完成；生命周期和历史仍以上游为准。提交后确认失败返回 OUTCOME_UNKNOWN，不自动重试。原线程未加载时可能由原生拒绝，Bridge 不擅自恢复。旧客户端忽略新增能力，旧服务端拒绝新动作；无数据库迁移或导出 schema 修改。fixture 仅验证边界、原身份、受理记录及持久响应重放，不代表真实压缩/宿主共享验收。

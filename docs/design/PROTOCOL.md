# AgentDeck protocol v1

本文保留配对、消息信封、能力协商、状态与重放规则。增量接口按功能查阅：

- [会话、历史、执行与目标](protocol/conversations.md)
- [原生项目与索引](protocol/projects.md)
- [会话图片资源](protocol/resources.md)
- [原生待发送队列](protocol/queue.md)
- [账户、执行配置与技能](protocol/settings.md)

## Incremental capability discovery

Windows-local workspace sync now also imports authoritative thread indexes within exact locally authorized project directories. Capability `threadIndexImport:true` and runtime scope `bridge-created-and-imported` describe this explicit operation; `externalThreadSync` and `sharedDesktopRuntime` remain false. Session objects may include `upstream` metadata (source, originator, session tree, parent/fork IDs, project, status, model/effort, section); Android preserves it in snapshot JSON without a Room schema change. Missing metadata remains compatible. A committed `sessions.synced` event prompts the existing snapshot refresh. Attached runtimes additionally reconcile on connect/reconnect and schema-validated thread started/name/archive/unarchive/status notifications; `externalThreadMetadataSync:true` reports this incremental behavior. Managed stdio reports that feature false. A coalescing worker reads the same authorized index without blocking event delivery, retries contention with bounded backoff, and rejects changed runtime generations before committing. Index import does not supply full message history, shared active-turn ownership, or deletion inference from missing pages. Externally active/unreconciled sessions report unknown and cannot start/manage work until authoritative reconciliation is implemented. Local Bridge metadata migration 4 preserves existing sessions, pairing and history; additive migration 5 adds authoritative deletion tombstones without rewriting those records. Failed pagination/concurrent local revisions roll back the entire index transaction and event; already accepted local project grants are independent.

After `system.hello`, Android requests `system.capabilities` on every connection. Existing v1 fields remain unchanged. `capabilitiesVersion:1` adds `upstreamReady`, `runtime` (`mode`, `sessionScope`, `sharedDesktopRuntime`, `externalThreadSync`), `features` (boolean map), and `limits` (integer map). Default runtime is `managed-stdio`; the explicit authenticated local WS mode is `attached-local-ws`. Both use `bridge-created-and-imported` scope; full desktop sharing and full external-thread synchronization remain false. Capability flags describe implemented endpoints, not runtime readiness or permission grants; callers must also respect readiness, per-operation authorization and authoritative errors. They do not assert equivalence with the desktop app.

Explicit local WS attachment reports `runtime.mode:attached-local-ws`; default remains `managed-stdio`. Both currently report `sessionScope:bridge-created-and-imported`, `sharedDesktopRuntime:false`, and `externalThreadSync:false`. Connection transport selection does not prove original desktop attachment or external-thread synchronization. No new WSS request can select a runtime or read its native credential. For explicit local attachment, codexVersion reports the selected locked schema profile (0.159.2 by default, or the exact desktop baseline 0.163.0-alpha.10.2); upstreamReady remains false until the actual server handshake and readiness checks pass. Snapshots and diagnostics report the same selected version. This does not change the Android envelope version or imply desktop sharing.

Older responses without these additions decode with version 0, unknown runtime, false sharing flags and empty maps. Missing features are not supported by inference. Unknown additive fields remain forward compatible. Discovery is connection-scoped and resets when switching hosts; it is not persisted as authoritative cached state. Protocol versions other than 1 are rejected by Android. No database migration is needed for this extension.

Session creation now sets the initial title on the authoritative upstream thread before publishing the local session index. Resume failure due to a missing rollout or history lineage returns `THREAD_NOT_FOUND`; writer ownership conflicts return `THREAD_IN_USE`. Neither condition forks or starts a replacement thread, and the original `upstreamThreadId` remains unchanged. A user-requested new conversation remains a separate explicit action.

Windows 0.3.0 uses a private stdio channel between the Rust Tauri host and native Rust Bridge. It is never exposed over WSS; local `workspaces.sync` and `pair.create` cannot be invoked by Android. `localRequestId` correlates local actions independently of the pairing `requestId`. React receives revisioned snapshots and human confirmation requests through typed Tauri commands/events. Android v1 envelopes and pinned Codex JSON schemas remain unchanged. See [desktop migration](../history/TAURI_MIGRATION.md).

TLS 1.2+ HTTPS; WSS at `/api/v1/ws`; no plaintext transport. The certificate fingerprint is SHA-256 of certificate DER (not SPKI). Android verifies the exact pin, validity, self-signature and default HTTPS hostname matching; IP SANs must match the selected endpoint. Redirects are disabled.

## Pairing

Windows local QR creation produces `{v,endpoint,fingerprint,token,expiresAt,hostId}`. Token: 32 random bytes, base64url without padding; validity: 120 seconds. Only private IPv4 addresses assigned to the host or loopback can be selected. A QR must be obtained from the physical PC; pinning cannot protect a QR substituted by an attacker.

1. `POST /api/v1/pair/request` with `{token,displayName,nonce}` consumes the token once and returns `{requestId,claimToken,code,expiresAt}`.
2. Both screens display the six-digit code. Windows local user confirms the requesting device.
3. `POST /api/v1/pair/claim` with `{requestId,claimToken}` returns pending/rejected, or one approved response containing `deviceId`, `hostId`, `credential`. The claim can succeed once.
4. WSS uses `Authorization: Bearer <device credential>`. Only hashes persist in the device table. QR and plaintext credentials are not logged. Revocation closes existing sockets and rejects reconnects.

Pairing requests are bounded to 4 KiB. New requests: 10 burst / 0.1 per second per source IP; claims: 30 burst / 2 per second. Browser Origin headers are refused on pairing and WSS.

## Envelopes

The Android composer extends `turn.start` with optional `mode` (`default`, `plan`, `goal`) and `attachments` (`[{name,data}]`, standard base64). There are at most four files totaling 512 KiB decoded, within the existing 1 MiB WSS frame limit. Files are written to a unique `.agentdeck-attachments_*` directory directly inside the granted project. Images use native `localImage` input; other files are passed as attachment paths for Codex to inspect. Only filenames appear in queued events, never base64 contents. Uploaded files remain in the project until the user deletes them.

Plan uses the native `collaborationMode` field with built-in mode instructions, requiring `experimentalApi:true`. Its parameter schema is separately pinned to the Codex 0.159.2 experimental export at `packages/codex-protocol/experimental/TurnStartParams.json`; the stable schema lock is unchanged. Explicit `default` resets Plan. Goal uses `thread/goal/set`; selecting another mode pauses the managed goal on the next send, and interrupt pauses the goal before interrupting its turn. Automatic goal turns are tracked in the same conversation. Session snapshots include the last selected `mode`.

`item/tool/requestUserInput` is handled as a pending question rather than an unsupported approval. To answer, send `approvals.decide` with `decision:"approve"` and `answers:{questionId:{answers:["answer"]}}`. Every question must have a nonblank answer. `reject`/`cancel` sends an empty answer map. Existing session/turn/generation/expiry and one-time claim checks also apply to questions.

```json
{
  "v": 1,
  "type": "request",
  "id": "client-uuid",
  "action": "turn.start",
  "payload": { "sessionId": "session-id", "text": "Fix the build" }
}
```

Responses include the same ID/action, `payload` and ISO `ts`. Errors contain `type:error`, ID where parsed, `code`, safe `message`, `retryable`. Events contain `type:event`, `action`, global `eventId` string, `seq`, nullable `sessionId`/`turnId`, `payload`, `ts`. Unrecognized fields in incoming request envelopes/payloads are rejected. An optional envelope project/session ID is informational; payload IDs are always checked by handlers. Android ignores additive response fields for forward compatibility but requires protocol v1.

First send `system.hello` with `{client,version:1}`. A socket receives events only after hello. Heartbeats ping every 15 seconds; unresponsive sockets terminate. Authenticated request limit: 60 burst / 20 per second per device. No raw RPC passthrough exists.

| Action                              | Payload                                                                                 | Result                                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| system.hello                        | client, version                                                                         | hostId, serverVersion, heartbeatSeconds                                                                                |
| system.capabilities                 | empty                                                                                   | supported approvals, concurrency, sandboxVerified                                                                      |
| system.diagnostics                  | empty                                                                                   | versions, platform, upstream/sandbox readiness, cursor, retention, structural counts                                   |
| settings.get                        | empty                                                                                   | retention: days and maxMiB                                                                                             |
| settings.update                     | days 1–365, maxMiB 16–1024                                                              | persisted retention; authenticated, journaled mutation                                                                 |
| snapshot.get                        | empty                                                                                   | host/projects/sessions/active turns/pending approvals/cursor                                                           |
| projects.list                       | empty                                                                                   | authorized projects                                                                                                    |
| projects.add                        | empty                                                                                   | awaitingLocalConfirmation; Windows folder dialog                                                                       |
| projects.remove                     | projectId                                                                               | awaitingLocalConfirmation; Windows confirmation                                                                        |
| sessions.list                       | optional projectId                                                                      | sessions                                                                                                               |
| models.list                         | empty                                                                                   | models: model, displayName, description, inputModalities, isDefault, defaultReasoningEffort, supportedReasoningEfforts |
| sessions.rename                     | sessionId, title ≤160                                                                   | upstream-confirmed session                                                                                             |
| sessions.archive / sessions.restore | sessionId                                                                               | upstream-confirmed session                                                                                             |
| sessions.delete                     | sessionId                                                                               | deleted, sessionId; permanent upstream deletion including descendants                                                  |
| sessions.pin                        | sessionId, pinned boolean                                                               | session; local ordering preference                                                                                     |
| sessions.create                     | projectId, title ≤160                                                                   | session                                                                                                                |
| sessions.detail                     | sessionId, optional before, limit 1–500                                                 | session, turns, events                                                                                                 |
| turn.start                          | sessionId, text ≤64000, optional model / effort ≤160, permissionMode: full or workspace | submitted turn; not terminal success                                                                                   |
| turn.interrupt                      | sessionId, turnId                                                                       | requested and currently confirmed state                                                                                |
| approvals.list                      | optional sessionId                                                                      | pending approvals                                                                                                      |
| approvals.decide                    | sessionId, turnId, approvalId, approve/reject/cancel                                    | one-shot local delivery result                                                                                         |
| git.status                          | projectId                                                                               | working-tree files, baseline, truncation                                                                               |
| git.diff                            | projectId, opaque fileId                                                                | read-only current preview, binary/truncated flags                                                                      |
| events.replay                       | optional cursor, limit 1–500                                                            | ordered events, cursor, more                                                                                           |
| devices.revokeSelf                  | empty                                                                                   | revoke paired device                                                                                                   |

Mutation IDs are journaled per device with a hash of action/payload. An identical completed request returns its cached response. ID reuse with different content conflicts. A pending/unknown outcome returns `OUTCOME_UNKNOWN`; clients reconcile instead of replaying a potentially executed action under a new ID. Android does not automatically retry mutations.

## State and replay

Session/turn states: idle, queued, running, waitingApproval, completed, failed, interrupted, unknown. UI never interprets socket send, HTTP 200, or `turn/start` response as completion. Events include `host.status`, `projects.updated`, `session.updated`, `turn.queued`, `turn.started`, `turn.progress`, `turn.completed/failed/interrupted`, `turn.interruptRequested`, `approval.requested/resolved`, `git.changed`, `bridge.error`.

Snapshot captures cursor and state in a SQLite transaction. Replay is exclusive of the supplied cursor; loop while `more`. IDs ≤ last cursor are duplicates. A cursor below the retention floor or ahead of current journal yields `REPLAY_GAP`; fetch snapshot then session details. Event payload truncation is explicit, not presented as network loss. Cursor replay detects transport gaps; the retained preview policy may intentionally omit excessive content.

`settings.updated` carries `{retention:{days,maxMiB}}`. The periodic pruner uses the persisted policy. Diagnostics contain structural counts and readiness only, with no prompts, project paths, credentials, output or approval context. Android exports this response through the system document picker and adds app/Android versions, connection state and its cache cursor.

Approvals bind session, turn, upstream ID, exact method and process generation. Only approve once is offered; persistent policies and accept-for-session are never returned. `reject` maps to decline where advertised, otherwise cancel where available. Cancel may interrupt the turn; final status still comes from Codex. A successful local approval response means the reply was queued to upstream, not a durable end-to-end acknowledgement; later upstream events remain authoritative.

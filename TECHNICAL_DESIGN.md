# AgentDeck — Technical Design Document

Version: 1.0 | Date: 2026-10-20 | Target: Xiaomi Pad 7 + Windows 11

## 0. Purpose and non-goals

AgentDeck is a locally controlled companion for Codex development tasks. Android presents project/task dashboards, structured event streams, Git diffs, and human approvals. A Windows Bridge runs and supervises Codex App Server via stdio. The tablet never stores Codex/ChatGPT credentials and never launches shell commands directly.

**v1 scope**: one paired Android tablet, one Windows host, multiple authorized workspaces and multiple Codex threads, one Codex App Server integration, foreground real-time supervision, task creation/continuation/interruption, approvals, git changes, reconnect/resume, authenticated local-network operation.

**Out of scope**: Claude or other agents; remote Internet port exposure; remote shell; code editor; automatic commit/push; taking over arbitrary existing Codex CLI/IDE sessions; background push delivery guarantee; multi-user account system.

## 1. Platform and dependencies

- Android: Kotlin, Jetpack Compose Material 3, MVVM + repositories, Coroutines + Flow, OkHttp WebSocket, kotlinx.serialization, Room, Android Keystore. Android minSdk selected after confirming device and dependency compatibility; target current Play policy compatible SDK, pinned in Gradle.
- Windows: Node.js current supported LTS, TypeScript strict, pnpm workspace, Fastify or minimal HTTP server, `ws`, zod, better-sqlite3/SQLite, built-in child_process and crypto. Pin exact versions in lockfile.
- Codex: installed and logged in on Windows by the local user. Bridge spawns `codex app-server` in stdio mode, using its existing user identity. Do not implement OAuth token extraction or store model provider tokens. Codex version and generated protocol schema version are recorded.
- Git: invoke only fixed commands with array arguments and `shell:false`, short timeouts, max output caps. Git interactions require verified authorized worktree paths.

## 2. Core architecture

```
Android Compose UI
  -> ViewModels -> repositories -> local cache + authenticated WSS client
  -> AgentDeck Bridge (Windows)
      |- Pairing/Auth/Device registration
      |- Project registry and path guard
      |- Codex adapter and JSON-RPC request router
      |- Persistent event journal + replay snapshots
      |- Approval coordinator
      |- Git diff/status read-only service
      |- Process supervision and diagnostics
      -> Codex App Server [stdio newline-delimited JSON-RPC]
          -> Codex thread/turn execution in approved workspace
```

Only the Bridge speaks Codex JSON-RPC. Android speaks independently versioned AgentDeck messages. Adapter must handle official v2 stable methods, preserve request IDs, correlate threadId and turnId, and never assume mere RPC acceptance means a turn succeeded. Completion requires `turn/completed` with `turn.status == completed`; failed/interrupted are distinct terminal states. Early response/late notifications must be reconciled.

## 3. Official Codex protocol integration

Protocol is version-sensitive. At setup/build time, run (check supported syntax in the installed binary):

```
codex --version
codex app-server generate-ts --out ./generated/codex
codex app-server generate-json-schema --out ./generated/codex-schema
```

If current release CLI differs, inspect `codex app-server --help` and adapt; do not invent a schema. Prefer nonexperimental generated types; experimental API disabled unless explicitly required and isolated. Use stable generated types from the installed Codex version; maintain a tested compatibility matrix.

Boot sequence:
1. Spawn one supervised `codex app-server` process with stdio pipes; no shell string concatenation.
2. Send JSON-RPC `initialize` containing `{clientInfo:{name:'agentdeck',title:'AgentDeck',version:'1.0.0'}}`; await success.
3. Send notification `initialized`.
4. For a new workspace, call `thread/start` with canonical authorized cwd and conservative supported approval/sandbox settings, store `result.thread.id`.
5. Call `turn/start` with `threadId` and typed text input. Save returned turn ID.
6. Handle item/agentMessage/delta and other structured event notifications; `turn/completed` provides authoritative terminal status.
7. Continue using another `turn/start` on the thread; recover using `thread/resume`/`thread/read` if supported by installed schema.
8. Interrupt with `turn/interrupt` for an active turn, then wait for terminal notification or record unknown when disconnected.

**Approvals**: Codex sends server-initiated JSON-RPC requests (including command and file change approval, depending on installed release). Preserve upstream request `id`, exact request method, underlying thread/turn, command, cwd and context. Convert to a Bridge approval record. When the tablet chooses, send the method-specific response using the *installed generated response type*. Never guess response enums. A timeout/disconnect causes denial or keeps request blocked safely; never auto-approve. Reject stale, already-resolved or mismatched approval IDs. Set user-reviewed approval configuration; do not use blanket never-ask or unrestricted sandbox as a shortcut.

Official references:
- https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
- https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/schema/typescript
- https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/schema/json
- https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

## 4. AgentDeck Bridge transport protocol v1

One encrypted WebSocket endpoint `wss://host:port/api/v1/ws` after device pairing. For development on loopback, plain WebSocket can be used only for local simulator, never on LAN. Use TLS with locally created certificate and verified pinned certificate/SPKI on Android (show fingerprint at pairing). Device-specific high-entropy access credentials, scoped to Bridge control, are stored using Android Keystore and Windows DPAPI. Pair through a short-lived, one-use QR token showing host endpoint and certificate fingerprint; user must confirm code on both screens. Rotate/revoke device credentials. Block cross-origin browser clients and unauthenticated upgrades.

**Envelope** (application protocol, not Codex JSON-RPC):

```json
{
  "v": 1,
  "type": "request",
  "id": "req_01...",
  "action": "turn.start",
  "projectId": "proj_01...",
  "sessionId": "ses_01...",
  "payload": { "text": "Fix build errors" },
  "ts": "2026-10-20T03:00:00Z"
}
```

- `type`: request | response | event | error; `action` stable names; `id` request correlation; `eventId` server generated monotonically sortable cursor, `seq` per session for ordering; `ts` ISO8601; payload validation by strict Zod schema and max size.
- Every request receives explicit success/error response; never infer success from WebSocket send.
- Events are persisted on Bridge before fan-out, except high-volume streamed deltas that may be coalesced into checkpoints with loss signalled. Resume via `events.replay` since cursor + `snapshot.get` on gaps.
- Operations are idempotent with client `requestId`/idempotency key; duplicate approval never sends two upstream replies; turn creation deduplicated or returns conflict if not safely retryable.
- Heartbeat/ping, exponential reconnect with jitter and network-change awareness. UI indicates `connected`, `reconnecting`, or `stale`. Never show old events as live.

**Required requests**:
- `system.hello`, `system.capabilities`, `snapshot.get`
- `projects.list`, `projects.add` (local host confirmation of canonical directory), `projects.remove`
- `sessions.list`, `sessions.create`, `sessions.detail`
- `turn.start`, `turn.interrupt`
- `approvals.list`, `approvals.decide`
- `git.status`, `git.diff`
- `events.replay`

**Required events**:
- `host.status`, `session.updated`, `turn.started`, `turn.progress`, `turn.completed`, `turn.failed`, `turn.interrupted`, `approval.requested`, `approval.resolved`, `git.changed`, `bridge.error`

**Proposed sample approval request**:

```json
{"v":1,"type":"request","id":"req_approve_1","action":"approvals.decide","payload":{"approvalId":"ap_123","decision":"reject"}}
```

Do not expose raw upstream approval response objects to Android; map user choices after validating compatibility. Supported UI actions are resolved from each upstream request's allowed choices.

**Error format**:

```json
{"v":1,"type":"error","id":"req_1","code":"APPROVAL_STALE","message":"Approval is no longer pending","retryable":false}
```

Other structured error codes include `UNAUTHORIZED`, `INVALID_REQUEST`, `NOT_FOUND`, `CONFLICT`, `UPSTREAM_UNAVAILABLE`, `UPSTREAM_VERSION_UNSUPPORTED`, `WORKSPACE_FORBIDDEN`, `UPSTREAM_TIMEOUT`, `REPLAY_GAP`, `RATE_LIMITED`.

## 5. Domain model and database

- `Host(hostId,name,endpoint,pairedAt,lastSeen,certFingerprint)`
- `Project(projectId,name,canonicalPath,gitRoot,createdAt,enabled)`
- `Session(sessionId,projectId,upstreamThreadId,title,status,createdAt,updatedAt)`
- `Turn(turnId,sessionId,upstreamTurnId,status,startedAt,endedAt,error)`
- `AgentEvent(eventId,sessionId,turnId,seq,type,summary,payloadJson,createdAt)`
- `Approval(approvalId,sessionId,turnId,upstreamRequestId,method,status,contextJson,createdAt,expiresAt,resolvedAt)`
- `PairedDevice(deviceId,displayName,credentialHash,permissions,createdAt,revokedAt)`

Bridge SQLite is source-of-truth for local session index/events/approvals. Codex remains source-of-truth for execution state. Android Room stores non-secret cache and cursor; no OAuth/API token.

State machines:
- Session: idle -> running -> waitingApproval -> running -> completed/failed/interrupted; disconnected marks `unknown` without fabricating terminal outcome.
- Approval: pending -> approved/rejected/expired; transitions must be atomic and single-use.
- Turn: queued -> running -> completed/failed/interrupted/unknown; wait for authoritative event to finalize.

## 6. UI/UX screens (landscape tablet first)

Navigation: Home, Projects, Session Detail, Review, Settings. 11.2-inch 3:2 adaptive layout; narrow portrait fallback. In landscape: 240dp project/sidebar, flexible timeline middle, 360dp approval/diff right pane; responsive split panes based on measured width, not hardcoded pixels.

Home: connection status, project list, active turns, pending approvals, recent completed turns. No fabricated progress percent. Show activity stages and durations.

Project: authorized roots, sessions, open Git changes, create task with sandbox/approval choices restricted to safe server policy.

Session: streaming messages, tool steps, timestamps, errors, next-prompt entry, Interrupt with confirmation. Virtualized lists and throttled rendering to support high-volume event flow.

Review: side-by-side/inline diff using line numbers, additions/removals, file filtering, binary warning and truncation indicator. Avoid rendering secrets; scrub known sensitive patterns and allow local redaction. Clearly distinguish `working tree` vs `turn-specific` diff; do not claim perfect attribution if Git is modified by external processes. Show baseline revision and dirty-state caveat.

Approval: command, cwd, justification, affected files if known, origin, risk hints, allowed decisions; no default selection and no auto-approval. Desktop still usable independently.

Settings: host cert fingerprint, revoke pairing, retention, diagnostics, notification toggles, visual preferences.

## 7. Windows service behavior

Bridge operates initially as a foreground tray process started by the user, with clear status and Stop control; do not initially run as SYSTEM service. Startup on login optional in a later phase. Only allowlisted project directories created/confirmed locally, resolving symlinks/junctions and rechecking before operations. Each session bound to immutable project ID/workspace; no arbitrary path parameters from Android. Only known API actions; never add a general `exec` endpoint.

One managed Codex process per Bridge initially, supporting multiple threads; queue/concurrency limit configurable (default 2 active turns). On crash, persist errors, restart with exponential backoff, reinitialize, attempt thread recovery. Pending approvals invalidated on process restart until re-discovered. Protect persisted history and credential stores. Provide redacted diagnostic export.

## 8. Git operations

Allow only read-only Git commands for v1: `git -C <verified-root> status --porcelain=v1 -z`, `git diff --no-ext-diff --no-color --binary` with output caps, and diff against known baseline if feasible. Do not execute Git hooks or use attacker-supplied aliases/config. Consider `--no-optional-locks`, `-c core.pager=cat`, and environment hardening; sanitize filenames. Binary files and huge diffs display metadata and truncation warnings. When project is not a Git repo, show 'Git unavailable' while task execution still works.

## 9. Security threat model

Attacker surfaces: unknown LAN client, QR interception, malicious web page issuing WebSocket connections, compromised Android device, command content from prompts, prompt injection in repository files, symbolic link path escape, sensitive tokens in logs, replayed approvals, upstream schema drift.

Controls:
1. TLS with pinned verified fingerprint, not `trust all certificates`.
2. QR pairing 60–120 seconds, one-use; desktop user confirms pairing and matching code, cannot be completed solely from tablet.
3. Per-device strong credential in OS secure stores, revocation and rotation.
4. Strict allowlist path enforcement including Windows junction/symlink revalidation; no arbitrary shell endpoint.
5. Explicit user-mediated approvals, mapping exact upstream allowed choices, deny on loss of connectivity/timeouts; no force approvals.
6. Rate limiting, frame/payload size caps, bounded event buffers, retention, DoS protection.
7. Redact access credentials, environment secrets, tokens and sensitive paths in logs and exports; offer configurable retention and delete.
8. Default LAN bind disabled until pairing is configured; Windows firewall scoped to Private networks; no UPnP/public tunnel.
9. Pin Codex version and contract-test against generated schemas; fail closed on unknown approval methods.
10. Treat AI/tool outputs as untrusted text; escape in UI, never execute markdown/links/scripts automatically.

## 10. Milestones, deliverables and acceptance

### M0 — Repository and protocol spike
- `pnpm install` + `pnpm test`, Android Gradle build work on a clean machine.
- Produce `docs/compatibility.md` containing Codex version, generated schema hash, supported methods/approvals.
- Spawn local app-server, initialize, create test thread and one turn, receive terminal notification from a real Codex session.
- Integration smoke test; if login unavailable, smoke test reports SKIPPED with instructions, not success.

### M1 — Secure Bridge + pairing
- Tray/console host, project allowlist, device pairing, cert pinning, heartbeat, reconnect, persistent event journal.
- Unauthenticated LAN clients cannot list projects, start turns or approve requests.
- Restart preserves paired device and projects; revoked device cannot reconnect.

### M2 — Real Codex lifecycle
- Create/resume session, start/continue/interrupt turn; structured progress; correct completed/failed/interrupted transitions.
- Concurrent project sessions isolated by thread/project IDs.
- Restart during active turn yields honest unknown/reconciled state, no falsely 'completed'.

### M3 — Approval forwarding
- Real approval requests are visible, actionable and correlated to upstream request IDs.
- Approved/rejected responses are delivered once. Double taps rejected as stale; disconnect does not approve.
- Support each stable approval method present in pinned version or fail closed with documented unsupported state.

### M4 — Android experience
- Landscape three-pane app responsive in portrait; long event stream stays smooth.
- Pairing flow, project and session list, new prompt, streaming timeline, approval card and interrupted/error states.
- Cache stale state labelled; no fake status/progress.

### M5 — Git review and release
- Correct Git status and diff from real workspace including renamed/binary/truncated cases.
- APK debug/release build and Windows packaged installer or reproducible startup script; README and setup screenshots.
- Automated test suite, manual acceptance log, security checklist, GitHub Actions; no secret keys committed.

## 11. Test matrix

Unit: Zod packet schemas, request-id routing, state machines, replay cursors, duplicate/expired approval, workspace traversal/junction guard, log redaction.

Integration: fake app-server fixture with scripted RPC envelopes; real Codex smoke when authenticated; Git repo fixtures (dirty/untracked/rename/binary); host restart; socket drops; outdated Android protocol version; upstream unknown approval; large streaming payload.

Android: Compose UI/navigation tests, Room migrations, reconnect, screen rotation, device sleep/wake, Wi-Fi switch, denied notification permission, long logs; target physical Xiaomi Pad 7 test.

Security: unpaired socket rejected, replayed pairing denied, wrong TLS cert rejected, stale credentials rejected, unauthorized project ID rejected, approval cross-session rejected, no auto-approve under timeout or disconnect.

Exit criteria: all v1 acceptance cases pass on real Windows + Pad 7 LAN; no P0/P1 security bugs; unimplemented features labelled rather than mocked; docs reproducible from clean checkout.

## 12. Delivery commands / documentation

Required repo docs: README.md (Windows and tablet install), docs/ARCHITECTURE.md, docs/PROTOCOL.md, docs/SECURITY.md, docs/COMPATIBILITY.md, docs/ACCEPTANCE.md, docs/DEVELOPMENT.md, CHANGELOG.md. Maintain `.env.example` with non-secret fields. Provide Windows PowerShell startup commands and Android `gradlew.bat assembleDebug` procedure matching actual files.

After each phase run actual tests/builds and summarize commands, exit codes, blockers, remaining risks. Do not fabricate green tests. Avoid unbounded dependency upgrades and lock versions.

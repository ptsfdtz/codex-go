# Codex compatibility

Windows desktop 0.3.0 uses React 19.2.0, Vite 6.4.1, Tauri 2.11.5 and a native Rust Bridge. Locally built with Rust 1.97.1/MSVC; the service declares Rust 1.88 minimum. Both Cargo.lock files pin dependencies. Android v1 envelopes are unchanged; chat-management actions and optional model/effort fields are additive. Node 22 is required for source tooling, not the installed application. The old Node service and C# helper sources have been removed.

Validated locally 2026-10-20 on Windows 11 Pro build 26300; **Codex CLI 0.159.2**. Node 22.22.3, pnpm 12.3.4, Git 2.54.0, JDK 21, Android SDK 36. Physical device detected: Xiaomi `2410CRP4CC`, Android 16/API 36, 2136×3200. Detection is not successful physical acceptance.

## Sources and generated contracts

- [Official App Server documentation](https://developers.openai.com/codex/app-server)
- [Official configuration reference](https://developers.openai.com/codex/config-reference)
- [Permissions documentation](https://learn.chatgpt.com/docs/permissions)
- [Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- [Official repository App Server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Protocol source](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol)

The local CLI's exported stable schema is the implementation authority. `codex app-server --help`, `generate-ts --help`, `generate-json-schema --help` were inspected before generation. The original export contained 1,048 TS/JSON files. Rust consumes JSON schemas directly; the 314 JSON files now live in `packages/codex-protocol/schema`, unchanged byte-for-byte. Unused generated TypeScript was removed. The filtered `packages/codex-protocol/schema-lock.json` manifest SHA-256 is:

```text
ddf660102dca5dd531ad7a4e9db9feb3c2c3360b7022c334b3df04f64138e484
```

`pnpm schema:verify` hashes every JSON schema and rejects additions/removals. Updating the manifest requires explicit review; no automatic record command is retained. It does not verify against a newly installed CLI. Production checks the exact CLI version and refuses a mismatch. Regenerate with the pinned binary:

```powershell
codex app-server generate-json-schema --out <temporary-review-directory>
pnpm schema:verify
```

## Methods actually used

Migration development also pins the installed desktop baseline `0.163.0-alpha.10.2` under `packages/codex-protocol/versions/`: 318 effective stable schemas, with 39 changed/new files and 279 byte-identical sources reused from the old export, plus a separately locked experimental TurnStartParams. `schema:verify` and the Rust build check every effective source hash. `Rpc::connect_local_websocket_profile` selects an explicit connection-local schema profile; validator caches and business validation use that version. Plan parameters and explicit Goal mutation origins are version-aware. An isolated real two-Rust-client metadata check and native Windows boundary check passed against that version, including same-thread resume and a newly added method. Explicit local WS attachment can now select that baseline with AGENTDECK_RUNTIME_PROTOCOL_VERSION and a matching AGENTDECK_CODEX_EXE. A real isolated binary-entrypoint check verifies version/boundary reporting; Core supervision and reconnect preserve the same profile and thread identity. Actual model/approval lifecycle, original desktop attachment and Android acceptance remain unverified. Default managed startup remains pinned to 0.159.2; neither a successful handshake nor this opt-in adapter establishes full desktop compatibility. Detailed evidence is in CODEX_PARITY_STATUS.md.

The table describes the pinned integration contract. Real verification entries include historical Node-version checks; current Rust evidence and pending physical checks are listed separately in ACCEPTANCE.md.

| Method                           | Contract / role                                                         | Verification                                        |
| -------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| initialize / initialized         | InitializeParams/Response (JSON schema under v1), experimentalApi true (Plan composer; separately pinned turn schema) | real smoke                                          |
| config/read                      | effective workspace permissions and integration safety gate             | real startup/Bridge smoke                           |
| windowsSandbox/readiness         | require ready                                                           | real startup                                        |
| thread/start                     | cwd, approvalPolicy on-request, approvalsReviewer user                  | real create                                         |
| thread/resume                    | persisted thread ID, same cwd/policy, excludeTurns                      | real resume/continue                                |
| turn/start                       | threadId and typed text input (`text_elements:[]`)                      | real concurrent tasks                               |
| turn/completed                   | validated TurnCompletedNotification; terminal status                    | real completed and interrupted                      |
| turn/interrupt                   | exact threadId/turnId                                                   | real terminal interruption                          |
| thread/read; thread/turns/list   | persisted terminal recovery; summary pagination                         | exported stable contract + fixture recovery         |
| model/list                       | paginated visible account catalog and supportedReasoningEfforts         | current Rust real smoke                             |
| thread/name/set                  | threadId, name; method-specific response validation                     | current Rust real smoke                             |
| thread/archive; thread/unarchive | threadId; method-specific response validation                           | current Rust real smoke                             |
| thread/delete                    | threadId; permanently removes thread and upstream descendants           | current Rust real smoke on its own temporary thread |
| account/read                     | smoke-only auth availability, refreshToken false                        | real smoke; no login token read                     |

Task stream additionally validates generated schemas for turn/started, plan/diff updates, item started/completed, agent message/plan/output deltas, file patches, MCP progress and error. MCP invocation is disabled by the production safety policy. Unknown notifications do not establish state; unknown server requests are rejected and interrupt their correlated turn where possible.

## Approval responses

| Upstream request                      | Stable response implemented                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------ |
| item/commandExecution/requestApproval | `{decision:"accept"}` once; `decline` / `cancel` for denial                                               |
| item/fileChange/requestApproval       | `{decision:"accept"                                                                                       | "decline" | "cancel"}`; grantRoot must not broaden authorized root |
| item/permissions/requestApproval      | `{permissions:<validated in-root requested subset>,scope:"turn"}`; denial `{permissions:{},scope:"turn"}` |

Each response is validated against the exported method-specific JSON schema. Original numeric/string request IDs and method are retained, scoped by subprocess generation. Legacy exec/apply-patch, tool user-input, credential refresh, unsupported tool calls, and other server requests fail closed. No `acceptForSession`, execpolicy amendment, persistent network rule or credential handoff is implemented.

**Observed differences and corrections:**

1. Stable `AskForApproval` still includes `untrusted`, while installed CLI help retires it. AgentDeck uses `on-request` with human reviewer. `approvalsReviewer` is present in the stable export despite an unstable documentation annotation; it was actually accepted locally.
2. Stable command params omit `availableDecisions`; an actual 0.159.2 request supplied it, with `accept`, an execpolicy amendment object, and `cancel` (without `decline`). AgentDeck treats this observed additive field only as a restriction, validates each value using the generated response schema, and chooses cancel for rejection where decline is unavailable. It never accepts a new response shape from the additive field.
3. Actual approval cwd can contain escaped/repeated Windows separators. Approval containment resolves the real path rather than comparing display strings. Permission paths recheck junction containment.
4. `thread/start` has no persisted rollout until its first turn. Empty never-run sessions may be recreated only after the observed exact missing-rollout error; existing task history is never silently replaced.
5. `turn/start` can acknowledge before the active-turn table is ready. Only exact `no active turn to interrupt` triggers a bounded retry; interruption remains unconfirmed until terminal evidence.
6. Dotted CLI config assignments using quoted `:minimal` were interpreted literally. The tested permission profile is a full inline TOML table. `config/read` normalizes optional `glob_scan_max_depth` to null; that harmless null field is accepted.
7. Legacy Windows elevated sandbox did **not** enforce deny-read outside cwd. Production explicitly selects **MXC** and probes actual inside/outside read/write at startup. It does not claim the legacy sandbox meets this boundary.
8. `mcp_servers={}` does not remove inherited entries. Supervisor discovers configured names, stops the probe, then restarts with per-name `enabled=false`; each workspace is checked before a thread/turn. Inherited hooks or broadened filesystem/network rules are refused. Discovery initialization may observe the user's integration configuration; do not configure untrusted MCP servers in the local Codex profile.

9. Real command review initially succeeded as a transport operation while the selected Desktop cached PowerShell executable failed to start. Removing that child PATH entry exposed an MSIX `pwsh.exe` alias, which MXC also refused. Production now removes only those incompatible cached PowerShell/WindowsApps locations from the child environment. Installed unpackaged PowerShell and Windows PowerShell remain discoverable; the parent environment and sandbox permissions are unchanged. The real shell smoke requires exit code 0 and an exact output marker. See [the pinned upstream shell discovery implementation](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/shell-command/src/shell_detect.rs) and [official configuration reference](https://developers.openai.com/codex/config-reference/). No undocumented Codex request/config field was added.

Historical Node-version physical tablet command approval and rejection were verified through authenticated WSS request audit and authoritative terminals. Approval success additionally requires actual `AGENTDECK_APPROVAL_OK` command output with exit code 0; `turn/completed` alone never proves individual tool success. Real file/permission variants remain separately listed in `ACCEPTANCE.md`.

## Local workspace discovery

Simplified Windows sync uses generated stable `ThreadListParams`, `ThreadListResponse` and `ConfigReadResponse`, validated against pinned JSON schemas. It requests all providers, explicit cli/vscode/appServer sources, cursor pagination and both archived groups. Only config.projects entries explicitly marked trusted contribute config paths. Current [official app-server documentation](https://developers.openai.com/codex/app-server/) confirms the history API; newer fields absent from pinned schemas are not used. CLI 0.159.2 stable ClientRequest has no Desktop project-list method. Discovery includes config/history directories and historical projects; it cannot claim exact Desktop sidebar enumeration or current-thread takeover. No private Desktop file/API is used. Real read-only smoke verified 18 valid directories; paths are omitted from the distributable report.

## Models and independent Android API (2026-10-20)

Current official [App Server documentation](https://developers.openai.com/codex/app-server/) and the pinned 0.159.2 schemas confirm `model/list`, `thread/name/set`, `thread/archive`, `thread/unarchive` and `thread/delete`. Exported `TurnStartParams` uses `model` and **`effort`**, not reasoning_effort. Models and supported reasoning levels come from the current account rather than a static product list. The real isolated Rust test returned 8 visible models and completed two turns with the selected default model/effort; management methods were accepted and only its own thread was deleted. See artifacts/native-real-codex.json.

Android independent mode implements the documented [Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), with `model`, text `messages`, `stream` and optional **`reasoning_effort`**. It is not a Codex App Server transport and does not implement Responses, tool calls or provider-specific extensions. OpenAI-compatible servers must support the same wire format; model/parameter availability is provider-dependent. HTTPS local-fixture tests do not prove real provider/account compatibility. No real API credentials were configured or tested for this delivery.

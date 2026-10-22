# 原生项目与索引

[协议总览](../PROTOCOL.md) · 合约正文按功能归档；能力标志不代表完整迁移已验收。

## Native project read views (additive contract 1)

`projects.nativePage` is read-only, independent of `projects.list` (local directory grants). Payload requires `contractVersion:1`; optional `limit` defaults to 50 (1..100) and optional `cursor` must be an opaque 43-character URL-safe token. Omit cursor to restart; do not send null, raw native cursors, device IDs or local project IDs. The authenticated connection supplies device identity.

Capability `nativeProjectReadViews` is true only for DesktopBaseline. It describes this bounded read endpoint, not readiness, desktop sidebar parity, live synchronization or write support. Older clients/servers retain the prior project API; Android hides the entry when this flag is missing/false. No data migration is required.

Response payload: `contractVersion:1`, `source:upstream-native-projects`, `consistency:bounded-read-view`, `viewId`, `expiresInSeconds:120`, `data:[{project:<complete native object>,rootGrants:[{rootIndex,projectId:<local grant ID>}]}]`, `nextCursor:<opaque token|null>`. Native identity stays in project.id. All roots must have exact live local grants; unknown/mixed/rootless projects are omitted entirely. Source metadata is preserved, never copied into local authorization records.

Read views may be stale until refreshed; expiry is measured from view creation, and retries do not extend it. Page size is fixed per view. Same continuation can be retried; matching viewId is required across pages. `SYNC_CONFLICT`, `INVALID_CURSOR`, `UPSTREAM_UNAVAILABLE` or changed connection require discarding the displayed page and restarting without cursor. `BUSY` means retry a fresh read later. `UPSTREAM_CONTENT_TOO_LARGE` does not return a partial catalog. No mutation journal entry is used for these reads.

RPC-observed project changes invalidate existing/in-flight views; dead/replaced connections reject continuation. Silent missed notifications on a surviving connection remain a limitation; this contract deliberately promises only a bounded read view with explicit refresh, not automatic project synchronization. The Android initial viewer refreshes manually and clears results after an error; The viewer can now open already-synchronized sessions only when upstream.projectId exactly matches the native project and session.projectId belongs to rootGrants. This does not enumerate all source threads, create a project-bound thread or support project mutations.

## Explicit authorized thread-index refresh

`threadIndexRefresh:true` advertises `sessions.refreshIndex` with required `{contractVersion:1}` and no scope/device overrides. It reuses the existing authorized source-index reconciler, including archives/loaded metadata and pagination checks. It does not resume threads, start turns, grant directories or copy source threads. The response is `{contractVersion:1,indexed:<candidate count>}`; count is not a count of newly created or changed records. Read snapshot.get after success.

The handler has a 30-second bound (within Android's 45-second request timeout). Existing index lock/contention and source errors are returned; retry is safe because this is a metadata reconciliation with stable native thread identities, not a task submission. It is not put into the user-mutation journal. It does commit Bridge index/cache metadata and existing sync events; that is distinct from a source business mutation. Timeout/cancellation does not promise a changed-row count; fetch a snapshot before deciding whether another refresh is necessary.

Android's native-project viewer shows “同步会话” only when supported, disables it offline/busy, refreshes the snapshot after success, and rejects switched-host/connection results. Failure preserves the previous committed index and displays an error; it never creates replacement tasks. Threads with absent authoritative projectId remain unassociated with a native project even when the requested project or cwd matches.

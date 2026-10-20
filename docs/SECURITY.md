# Security and deployment

## Trust boundaries

Unknown LAN clients cannot upgrade WSS without a valid device credential. Browser-origin requests are refused. Pairing is the only unauthenticated HTTP operation, is rate limited, consumes a short-lived secret, and still requires local Windows matching-code confirmation. One approved device replaces the previous one. Revocation terminates live sockets. Android retains the exact certificate pin in its encrypted host record; default hostname verification stays enabled. Never add a trust-all manager, hostname bypass, cleartext port or public tunnel.

Authorization is an explicit Windows-local workspace sync or folder selection, never an Android path. Sync reads trusted project config and thread cwd through the official protocol, canonicalizes/deduplicates paths, excludes temporary/private state directories, and skips missing directories; discovery alone grants nothing. The sync button also authorizes a certified local LAN listener and generates a short-lived pairing invitation. Existing locally authorized listeners may restore after restart; a new listener is not granted by an unauthenticated network request. Canonical root plus filesystem identity are stored and rechecked before operations. UNC/device/ADS/root-drive grants, traversal and links escaping the authorized tree are refused. Git requires the authorized repository root and in-root Git metadata. Untracked regular files are opened only after path checks and file identity recheck. Git subprocesses use fixed arguments and `shell:false`; external diff, textconv, fsmonitor, hooks, global/system config and inherited Git routing variables are disabled. V1 does not support linked worktrees/external `.git` directories.

Codex runs using the PC's current login, with a dedicated on-request human-reviewed workspace profile and MXC sandbox. No authentication tokens are read or forwarded. Network starts disabled. Inherited active MCP and hooks are refused for tasks; see compatibility notes on initial config discovery. Sandbox approval can explicitly authorize a command to run with broader privileges: review the **entire command** and reject any operation outside your intent. Never treat the model's explanation as authorization. The application does not try to decide that an arbitrary command is safe. A compromised paired tablet can submit prompts and make approvals; revoke it locally immediately.

Approvals are associated with immutable session/turn IDs, exact upstream ID/method and process generation. Atomic pending→sending transitions prevent double replies. Five-minute expiration, socket loss, process loss, unknown method and stale IDs fail closed. Permission and grant-root widening is rejected before approval. UI output is plain text; no embedded output can execute, navigate automatically or silently grant access. Rejection/cancellation can cause an interrupted turn; the UI waits for authoritative completion.

## Local data

`%LOCALAPPDATA%\AgentDeck` is restricted to current user and SYSTEM. The TLS private key and certificate are stored as a CurrentUser DPAPI blob; QR claim credentials are DPAPI protected while pending and only their hashes persist. Android credentials are AES-GCM encrypted by a non-exportable Keystore key; backup is disabled. Codex's own identity files are managed solely by Codex. SQLite contains prompts, task output, paths and approval context; it is protected by NTFS ACL, **not whole-database encryption**. BitLocker is recommended for protection against offline disk access.

Known API keys, JWTs, bearer values and secret assignment fields are redacted from public journal previews/logs/Git text. This is best-effort pattern redaction, not a guarantee that arbitrary project secrets will be recognized. Only authorize projects appropriate for viewing on the paired tablet. Raw approval context is required for response validation and stays in the ACL-protected Bridge database. No secret files/private test keys are committed. The test certificate is public-only.

Retention runs at startup and periodically (30 days / 256 MiB payload target). Request idempotency records remain while retained for at least the event horizon to prevent unsafe duplicate operations. Stop Bridge before deleting its data directory. Deletion resets local grants/devices/certificate and requires re-pairing; upstream Codex history is not deleted. To rotate the certificate without deleting sessions, stop Bridge, remove `tls.dpapi`, restart, and pair again. DHCP address changes can require this because the old certificate's IP SANs no longer match.

## Windows Firewall

First-start loopback is not LAN-accessible. Choose the explicit LAN address in the local window; bind does not use `0.0.0.0`. Only that Windows-local action saves `listenAddress`. On restart it is reused only if still an assigned private IPv4 with a matching certificate IP SAN; otherwise startup falls back to loopback. Selecting loopback locally saves that choice. Remote requests cannot alter this grant. Keep the firewall restricted to trusted Private networks, including after network changes. Do not open your router. For a trusted Private network, an administrator may create this narrow rule, replacing paths/port if configured:

```powershell
$nodeExe = (Get-Command node.exe).Source
New-NetFirewallRule -DisplayName 'AgentDeck Private LAN' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 49321 -Program $nodeExe -Profile Private -RemoteAddress LocalSubnet
# Remove when no longer needed
Remove-NetFirewallRule -DisplayName 'AgentDeck Private LAN'
```

The program never changes execution policy, firewall, elevation policy or login files. Avoid letting another node program reuse this rule's port; stop/delete the rule when not using AgentDeck.

Authenticated retention settings are bounded to 1–365 days and 16–1024 MiB, defaulting to 30 days / 256 MiB. The Android UI asks for confirmation before submitting a policy that may remove local history. Diagnostic export includes only structural counts, versions, readiness, retention and cursor; it excludes prompts, project paths, credentials and approval context. Notification preferences default off. Notifications require OS permission and never include command text, prompts or file contents.

Android's temporary display mask accepts one literal fragment of 3–256 characters. It applies only to event and Diff text, after Diff source numbering, and never interprets regular expressions. The fragment stays in application memory, survives Activity recreation, and is excluded from SharedPreferences, Room, saved instance state and diagnostic export. The entry field uses password display and disables autocorrect. Process restart clears it. It does not redact original storage or approval context: human approval must retain the actual operation. This presentation feature is not encryption or a guarantee against arbitrary secrets elsewhere in the UI.

## Limits and remaining review

TLS and schema checks do not remove same-user Windows compromise or filesystem rename races. Canonical path checks and MXC probes reduce path escapes; adversarial junction replacement during active tasks still needs dedicated hardening review before a broad release. Physical LAN pairing, tasks, normal-UI command decisions, actual Git, Wi-Fi off/on and abrupt production restart have recorded evidence. Camera QR/two-screen comparison as a single observed flow, different-network roaming, sleep/wake endurance and real file/permission approval variants remain separate acceptance requirements. The current version is a development build, with no claim of external penetration testing or complete production certification.

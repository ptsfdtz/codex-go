# Changelog

## Conversation UX update — 2026-10-20

- Replaced dashboard/tab navigation with project/session sidebar, continuous conversation and persistent composer.
- Projected real streaming events by item identity; completed text replaces deltas without duplicate echoes or replay messages.
- Added inline human approval review, collapsed execution cards, basic Markdown/code copying, neutral themes and responsive session drawer.
- Preserved separate drafts through rotation/recreation; clear only after acknowledged submission and dismiss the keyboard when sending.
- Added real physical composer-to-Codex verification and regression coverage. See docs/CHAT_EXPERIENCE.md for evidence and limits.

## 0.1.0 — 2026-10-20 development build

- Added pinned Codex 0.159.2 stable JSONL adapter and real create/continue/interrupt lifecycle.
- Added Windows local project authorization, MXC boundary probe, native tray management and DPAPI-protected TLS.
- Added short-lived QR pairing, exact certificate pinning, WSS auth, single-device revocation and replayable SQLite events.
- Added atomic human approval forwarding and fail-closed expiry/disconnect behavior.
- Added Android Compose workbench, Room/Keystore, offline state, QR scanner and working-tree Git review.
- Added fixture/security tests, real smoke commands, Android tests, CI and reproducible source distribution.
- Added persisted theme/notification preferences, bounded retention settings and structural diagnostic export.
- Corrected Git source line gutters, added current/previous-path filtering, and discarded delayed Diff results after project changes.
- Added memory-only literal masking for event/Diff text while preserving full approval operations.
- Physical Pad 7 installation, eight isolated UI tests and six physical LAN scenarios passed, including real Codex edits, interruption, Git, Wi-Fi recovery and abrupt production Bridge restart.
- Verified human command approval and rejection through the normal tablet UI, with duplicate refusal and actual successful command output.
- Avoided inaccessible Desktop cached/MSIX PowerShell paths in the Codex child environment, without changing the parent PATH or widening the sandbox.
- Restored only previously locally authorized, still assigned and certified listener addresses after restart; first startup remains loopback-only.

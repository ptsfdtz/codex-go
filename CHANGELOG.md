# Changelog

## Simplified Windows connection window — 2026-10-20

- Removed the system title bar and sidebar; home combines workspace sync with QR pairing.
- Moved project/device/network management into the more menu; added custom drag, resize, minimize and tray controls.
- Discover projects via validated config/read and paginated thread/list, canonicalize paths, skip temporary/missing directories and preserve IDs across repeated syncs.
- Generate pairing QR after explicit local sync and reuse existing credentials; preserve human approval requirements.
- Added pagination/security tests and real read-only Codex smoke. Scope: docs/DESKTOP_EXPERIENCE.md.

## Windows management UX update — 2026-10-20

- Rebuilt the native window with Chinese sidebar navigation, consistent spacing, DPI scaling and resizable layouts.
- Added guided QR pairing with expiry and explicit device-code confirmation, complete project paths and live device presence.
- Replaced truncated Yes/No approval prompts with full scrollable context, explicit actions, expiry checks and safe cancel defaults.
- Preserved list selection during refresh, added inline feedback and guarded duplicate submissions.
- Added 12 native layout checks plus Unicode, long approval context, expiry and selection regression checks. See docs/DESKTOP_EXPERIENCE.md.

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

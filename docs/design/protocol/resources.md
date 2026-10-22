# 会话图片资源

[协议总览](../PROTOCOL.md) · 合约正文按功能归档；能力标志不代表完整迁移已验收。

## Saved session image resources (additive)

`sessionImages:true` advertises read-only sessions.image. Required payload: `{sessionId,turnId,itemId,offset}`; optional `contentIndex` (0–255, default 0) and `sha256`. Turn/item identities are native. No caller path or URL is accepted. Continuations at nonzero offset require the first chunk's lowercase SHA-256. The server locates the exact item in up to 100 descending pages of 50 saved items, validates source identity/cwd and supports imageView.path, imageGeneration.savedPath, and userMessage localImage at its original content-array index. Remote URLs, absent input image bytes and files outside the exact authorized project are not fetched.

Files are bounded to 8 MiB. The opened Windows handle's resolved path must remain in the granted root; source mapping, root identity, tombstone and RPC generation are checked before returning. PNG/JPEG/GIF/WebP signatures are allowed, with actual decoding performed separately by Android. Each response contains sessionId, upstreamThreadId, turnId, itemId, contentIndex, sha256, mime, totalBytes, offset, base64 data (up to 48 KiB), and nextOffset or null. Each read resolves the source again and checks the supplied hash, so changed content fails CONTENT_CHANGED. This version does not promise immutable historical file bytes or a persistent resource cache. Requests have a 30-second bound.

Android validates all identities, host/connection epoch, chunk bounds/offsets, total size and final SHA-256; bytes stay in memory. Image decoding rejects invalid dimensions and more than 100 million source pixels, then samples display to at most 2048 pixels per dimension. The viewer supports zoom/pan and double-tap reset; animation is displayed as a decoded still frame. Older servers omit the capability and the client hides resource buttons. No Room/Bridge schema migration or credential changes. This is an implemented resource path, not full media parity or real-desktop/device acceptance.

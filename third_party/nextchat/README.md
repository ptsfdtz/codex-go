# NextChat reference

Source: https://github.com/ChatGPTNextWeb/NextChat
Inspected commit: 1d3dc331512929a4b1d3e82354e72acce33b5c7a
License: MIT (see LICENSE).

The API chat module follows NextChat's separation of per-conversation model selection,
provider configuration and streaming completion lifecycle. The text-delta extraction
and terminal/empty-event handling in server/src/chat/stream.rs are adapted to Rust
from app/client/platforms/openai.ts and app/utils/chat.ts.

The UI uses AgentDeck's existing styles and components. Account-scoped PostgreSQL
storage, encrypted credentials, authenticated event streams, idempotent submissions,
public-endpoint validation and device-free mode switching are local implementations.
No NextChat server, telemetry, plugin/tool execution or bundled provider credentials
are included.

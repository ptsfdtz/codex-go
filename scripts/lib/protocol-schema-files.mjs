// Aggregate bundles duplicate the self-contained per-message schemas.
export const isStandaloneSchema = (name) =>
  name.endsWith('.json') &&
  name !== 'codex_app_server_protocol.schemas.json' &&
  name !== 'codex_app_server_protocol.v2.schemas.json';

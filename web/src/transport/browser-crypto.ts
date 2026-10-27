// @reclaimprotocol/tls/webcrypto imports this named Node-compatible export.
// In the Pages build it is the browser's native Web Crypto API.
export const webcrypto = globalThis.crypto;

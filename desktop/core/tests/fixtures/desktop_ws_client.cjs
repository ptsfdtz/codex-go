// Constructor options mirror the installed desktop local route. No secret output.
const fs = require('node:fs');
const WebSocket = require(process.env.AGENTDECK_DESKTOP_WS_MODULE);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const url = new URL(input.endpoint);
url.username = 'agentdeck';
url.password = input.token;
const ws = new WebSocket(url, {
  handshakeTimeout: 15000,
  headers: {},
  perMessageDeflate: false,
});
const timer = setTimeout(() => finish(false), 18000);
let count = 0;
const original = JSON.stringify({ id: 7, result: { decision: 'accept' }, text: '中文 😀' });
function finish(passed) {
  clearTimeout(timer);
  ws.terminate();
  process.stdout.write(JSON.stringify({ passed }));
  process.exit(passed ? 0 : 1);
}
ws.on('error', () => finish(false));
ws.on('message', (data) => {
  if (count++ === 0) {
    if (data.toString() !== '{"method":"approval","id":7}') return finish(false);
    ws.send(original);
  } else {
    finish(data.toString() === original);
  }
});

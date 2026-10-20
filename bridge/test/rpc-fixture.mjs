import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
let initialized = false;
let outputQueue = Promise.resolve();
rl.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialized') {
    initialized = true;
    return;
  }
  if (request.method === 'initialize') {
    send({
      id: request.id,
      result: {
        userAgent: 'fixture/0.159.2',
        codexHome: process.cwd(),
        platformFamily: 'windows',
        platformOs: 'windows',
      },
    });
    return;
  }
  if (!request.method) {
    send({ method: 'fixture/reply', params: { id: request.id, result: request.result } });
    return;
  }
  if (request.method === 'model/list') {
    if (request.params?.limit === 999) return;
    if (request.params?.limit === 998) {
      process.stdout.write('not-json\n');
      return;
    }
    if (request.params?.limit === 997) {
      process.stdout.write('x'.repeat(65536));
      return;
    }
    const text =
      JSON.stringify({ id: request.id, result: { data: [{ id: '测试😀' }], initialized } }) + '\n';
    const bytes = Buffer.from(text);
    outputQueue = outputQueue.then(async () => {
      const split = bytes.indexOf(Buffer.from('😀')) + 2;
      process.stdout.write(bytes.subarray(0, split));
      await new Promise((resolve) => setTimeout(resolve, 5));
      process.stdout.write(bytes.subarray(split));
    });
    return;
  }
  if (request.method === 'thread/read') {
    send({ id: request.id, error: { code: -32000, message: 'fixture failure' } });
    return;
  }
  if (request.method === 'account/read') {
    send({
      id: 17,
      method: 'item/fileChange/requestApproval',
      params: { threadId: 't', turnId: 'u', itemId: 'i' },
    });
    send({ id: request.id, result: { account: null, requiresOpenaiAuth: true } });
    return;
  }
  send({ id: request.id, result: {} });
});

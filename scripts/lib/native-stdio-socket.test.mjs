import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { nativeStdioSocket } from './native-stdio-socket.mjs';

async function fixture() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.signalCode = 'SIGTERM';
  };
  const socket = await nativeStdioSocket('probe', 'private.sock', {}, () => {
    Promise.resolve().then(() => child.emit('spawn'));
    return child;
  });
  return { child, socket };
}

test('native proxy framing preserves split UTF-8 and coalesced JSONL frames', async () => {
  const { child, socket } = await fixture();
  const first = JSON.stringify({ id: 1, result: '中文 😀' });
  const second = JSON.stringify({ method: 'turn/completed', params: { id: 'original' } });
  const bytes = Buffer.from(first + '\n' + second + '\n');
  const frames = [];
  socket.on('message', (frame) => frames.push(frame.toString()));
  for (let i = 0; i < bytes.length; i += 2) child.stdout.write(bytes.subarray(i, i + 2));
  assert.deepEqual(frames, [first, second]);
  let sent = '';
  child.stdin.on('data', (data) => {
    sent += data.toString();
  });
  socket.send('{"id":1,"result":{}}');
  assert.equal(sent, '{"id":1,"result":{}}\n');
  socket.terminate();
  assert.equal(child.signalCode, 'SIGTERM');
});

test('oversized incomplete frame closes only its proxy and signals loss', async () => {
  const { child, socket } = await fixture();
  let loss = 0;
  let frames = 0;
  socket.on('error', () => loss++);
  socket.on('message', () => frames++);
  child.stdout.write(Buffer.alloc(8 * 1024 * 1024 + 1, 65));
  assert.equal(frames, 0);
  assert.equal(loss, 1);
  assert.equal(child.signalCode, 'SIGTERM');
  assert.throws(() => socket.send('{}'), /unavailable/);
});

test('failed native spawn rejects without exposing executable or local path', async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  await assert.rejects(
    nativeStdioSocket('private-executable', 'private-path', {}, () => {
      Promise.resolve().then(() =>
        child.emit('error', new Error('private-executable private-path')),
      );
      return child;
    }),
    { message: 'Native stdio proxy could not start' },
  );
});

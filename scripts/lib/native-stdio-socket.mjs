// Probe-only JSONL transport through the native app-server proxy command.
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';

const LIMIT = 8 * 1024 * 1024;
export async function nativeStdioSocket(executable, socketPath, env, launch = spawn) {
  const socket = new EventEmitter();
  // Errors after initial connection are handled by the RPC consumer.
  socket.on('error', () => {});
  const child = launch(executable, ['app-server', 'proxy', '--sock', socketPath], {
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let closed = false;
  let buffer = Buffer.alloc(0);
  let stderrBytes = 0;
  let stderrTail = '';
  const fail = () => {
    if (!closed) socket.emit('error', new Error('Native stdio proxy closed'));
    socket.terminate();
  };
  socket.send = (value) => {
    if (closed || Buffer.byteLength(value) > LIMIT || child.stdin.writableLength > LIMIT) {
      fail();
      throw new Error('Native stdio proxy unavailable or frame oversized');
    }
    child.stdin.write(value + '\n');
  };
  socket.terminate = () => {
    if (closed) return;
    closed = true;
    child.stdin.destroy();
    child.kill(); // This kills only the native proxy client, not its shared server.
    socket.emit('close');
  };
  socket.proxyExited = () => child.exitCode != null || child.signalCode != null;
  socket.stderrBytes = () => stderrBytes;
  socket.stderrTail = () => stderrTail;
  child.stderr.on('data', (bytes) => {
    stderrBytes += bytes.length;
    stderrTail = (stderrTail + bytes.toString()).slice(-2000);
  });
  child.stdin.on('error', fail);
  child.stdout.on('error', fail);
  child.stdout.on('data', (bytes) => {
    buffer = Buffer.concat([buffer, bytes]);
    let end;
    while ((end = buffer.indexOf(10)) >= 0) {
      if (end > LIMIT) return fail();
      const frame = buffer.subarray(0, end);
      buffer = buffer.subarray(end + 1);
      socket.emit('message', frame);
    }
    if (buffer.length > LIMIT) fail();
  });
  child.on('exit', fail);
  child.on('error', fail);
  try {
    await once(child, 'spawn');
  } catch {
    socket.terminate();
    throw new Error('Native stdio proxy could not start');
  }
  return socket;
}

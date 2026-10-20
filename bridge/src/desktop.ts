import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { nativeHelper } from './native.js';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { log } from './log.js';

const localMessage = z.discriminatedUnion('action', [
  z.object({ action: z.literal('project.add'), path: z.string().min(1).max(32768) }).strict(),
  z.object({ action: z.literal('project.remove'), projectId: z.string().min(1).max(160) }).strict(),
  z.object({ action: z.literal('pair.create'), address: z.string().max(64) }).strict(),
  z
    .object({
      action: z.literal('pair.confirm'),
      requestId: z.string().max(160),
      approve: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal('device.revoke'), deviceId: z.string().max(160) }).strict(),
  z
    .object({
      action: z.literal('approval.decide'),
      approvalId: z.string().min(1).max(160),
      sessionId: z.string().min(1).max(160),
      turnId: z.string().min(1).max(160),
      decision: z.enum(['approve', 'reject', 'cancel']),
    })
    .strict(),
  z.object({ action: z.literal('stop') }).strict(),
]);
export class Desktop extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  constructor() {
    super();
    this.child = spawn(nativeHelper('HostUi'), [], {
      shell: false,
      windowsHide: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on('line', (line) => {
      if (line.length > 65536) return;
      try {
        this.emit('action', localMessage.parse(JSON.parse(line)));
      } catch {
        log('desktop.invalidMessage');
      }
    });
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => {});
    this.child.on('error', () => this.emit('unavailable'));
    this.child.on('close', () => this.emit('closed'));
  }
  send(type: string, payload: unknown): void {
    if (!this.child.killed && this.child.stdin.writable)
      this.child.stdin.write(JSON.stringify({ type, payload }) + '\n');
  }
  close(): void {
    this.send('exit', {});
    this.child.stdin.end();
  }
}

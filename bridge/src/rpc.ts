import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { DeckError } from './errors.js';
import { log } from './log.js';
import type { ClientRequest } from '../generated/codex/ClientRequest.js';
import type { RequestId } from '../generated/codex/RequestId.js';
import { validateContract } from './contracts.js';

export type RpcMessage = {
  id?: RequestId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};
export class RpcClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<
    RequestId,
    { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private next = 0;
  private buffer = '';
  private decoder = new StringDecoder('utf8');
  private writeBytes = 0;
  constructor(
    private readonly executable: string,
    private args: string[] = ['app-server', '--listen', 'stdio://'],
    private readonly timeout = 30000,
    private readonly maxLine = 8 * 1024 * 1024,
    private readonly environment?: NodeJS.ProcessEnv,
  ) {
    super();
  }
  configure(args: string[]): void {
    if (this.alive)
      throw new DeckError('CONFLICT', 'Stop the app server before changing process arguments');
    this.args = args;
  }
  get alive(): boolean {
    return this.child !== null && this.child.exitCode === null && !this.child.killed;
  }
  start(cwd?: string): void {
    if (this.alive) throw new DeckError('CONFLICT', 'App server already running');
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    this.writeBytes = 0;
    const child = spawn(this.executable, this.args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.environment,
    });
    this.child = child;
    child.stdout.on('data', (chunk: Buffer) => this.consume(chunk));
    // stderr is diagnostics, never execution events; never log raw content or credentials.
    child.stderr.on('data', (chunk: Buffer) => this.emit('diagnostic', { bytes: chunk.length }));
    child.on('error', () =>
      this.fail(new DeckError('UPSTREAM_UNAVAILABLE', 'Unable to start Codex App Server', true)),
    );
    child.on('close', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.fail(new DeckError('UPSTREAM_UNAVAILABLE', 'Codex App Server exited', true));
      this.emit('exit', { code, signal });
    });
  }
  private consume(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);
    for (;;) {
      const index = this.buffer.indexOf('\n');
      if (index < 0) break;
      if (Buffer.byteLength(this.buffer.slice(0, index)) > this.maxLine) {
        this.protocolFailure();
        return;
      }
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      let message: RpcMessage;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('object required');
        message = parsed as RpcMessage;
        if (
          message.id !== undefined &&
          typeof message.id !== 'string' &&
          (typeof message.id !== 'number' || !Number.isSafeInteger(message.id))
        )
          throw new Error('invalid id');
        if (message.method !== undefined && typeof message.method !== 'string')
          throw new Error('invalid method');
      } catch {
        this.protocolFailure();
        return;
      }
      if (message.method) {
        this.emit(message.id === undefined ? 'notification' : 'request', message);
        continue;
      }
      if (message.id === undefined || 'result' in message === 'error' in message) {
        this.protocolFailure();
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue; // a late timed-out response cannot complete a different request
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new DeckError('UPSTREAM_ERROR', message.error.message));
      else pending.resolve(message.result);
    }
    if (Buffer.byteLength(this.buffer) > this.maxLine) this.protocolFailure();
  }
  private protocolFailure(): void {
    this.fail(new DeckError('UPSTREAM_PROTOCOL_ERROR', 'Malformed or oversized upstream frame'));
    this.stop();
  }
  private fail(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    this.emit('fault', error);
  }
  private send(message: object): void {
    if (!this.alive || !this.child)
      throw new DeckError('UPSTREAM_UNAVAILABLE', 'App server disconnected', true);
    const line = JSON.stringify(message) + '\n';
    if (
      Buffer.byteLength(line) > this.maxLine ||
      this.writeBytes + Buffer.byteLength(line) > this.maxLine * 2
    )
      throw new DeckError('RATE_LIMITED', 'Upstream write buffer full', true);
    this.writeBytes += Buffer.byteLength(line);
    this.child.stdin.write(line, (error) => {
      this.writeBytes -= Buffer.byteLength(line);
      if (error) this.fail(new DeckError('UPSTREAM_UNAVAILABLE', 'Upstream write failed', true));
    });
  }
  request<M extends ClientRequest['method']>(
    method: M,
    params: Extract<ClientRequest, { method: M }>['params'],
    timeout = this.timeout,
  ): Promise<unknown> {
    if (this.pending.size >= 128)
      return Promise.reject(new DeckError('RATE_LIMITED', 'Too many upstream requests', true));
    const id = `ad_${++this.next}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new DeckError(
            'UPSTREAM_TIMEOUT',
            `Upstream ${method} timed out; outcome may be unknown`,
            true,
          ),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  notify(method: 'initialized', params = {}): void {
    this.send({ method, params });
  }
  respond(id: RequestId, result: object): void {
    this.send({ id, result });
  }
  reject(id: RequestId, code = -32601): void {
    this.send({ id, error: { code, message: 'Request unsupported or no longer authorized' } });
  }
  stop(): void {
    if (this.child) {
      this.child.stdin.end();
      const child = this.child;
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill();
      }, 1500);
      timer.unref();
    }
  }
}

export async function initializeRpc(rpc: RpcClient): Promise<void> {
  const response = await rpc.request('initialize', {
    clientInfo: { name: 'agentdeck', title: 'AgentDeck', version: '0.1.0' },
    capabilities: { experimentalApi: false, requestAttestation: false },
  });
  validateContract('v1/InitializeResponse', response);
  rpc.notify('initialized');
  log('codex.initialized');
}

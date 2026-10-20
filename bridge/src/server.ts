import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse, RequestListener } from 'node:http';
import { createHash } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { ZodError, z } from 'zod';
import { parseRequest, type Request, type Snapshot, VERSION } from '@agentdeck/protocol';
import { Store, now } from './store.js';
import { Tasks } from './tasks.js';
import { Approvals } from './approvals.js';
import { Pairing } from './pairing.js';
import { GitService } from './git.js';
import { DeckError, invariant } from './errors.js';
import { log } from './log.js';
import { CODEX_VERSION } from './codex.js';

class Buckets {
  private buckets = new Map<string, { tokens: number; ts: number }>();
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}
  take(key: string): boolean {
    const at = Date.now();
    const value = this.buckets.get(key) ?? { tokens: this.capacity, ts: at };
    value.tokens = Math.min(
      this.capacity,
      value.tokens + ((at - value.ts) / 1000) * this.refillPerSecond,
    );
    value.ts = at;
    const allowed = value.tokens >= 1;
    if (allowed) value.tokens--;
    this.buckets.delete(key);
    this.buckets.set(key, value);
    while (this.buckets.size > 1000) this.buckets.delete(this.buckets.keys().next().value!);
    return allowed;
  }
}
export interface LocalActions {
  requestProjectAdd(): void;
  requestProjectRemove(projectId: string): void;
}
export class BridgeServer {
  private readonly https: Server;
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    perMessageDeflate: false,
  });
  private readonly sockets = new Map<
    WebSocket,
    { deviceId: string; credential: string; hello: boolean; alive: boolean }
  >();
  private readonly rpcRate = new Buckets(60, 20);
  private readonly pairRate = new Buckets(10, 0.1);
  private readonly claimRate = new Buckets(30, 2);
  private readonly heartbeat: NodeJS.Timeout;
  private gitHashes = new Map<string, string>();
  private gitTimer: NodeJS.Timeout;
  private polling = false;
  private readonly inFlight = new Map<string, number>();
  private readonly onEvent = (event: unknown) => {
    for (const [socket, connection] of this.sockets) if (connection.hello) this.send(socket, event);
  };
  private readonly onDevicesChanged = () => {
    for (const [socket, connection] of this.sockets)
      if (!this.pairing.authenticate(connection.credential)) socket.close(1008, 'Device revoked');
    this.approvals.invalidate('expired');
  };
  constructor(
    private readonly store: Store,
    private readonly tasks: Tasks,
    private readonly approvals: Approvals,
    private readonly pairing: Pairing,
    private readonly git: GitService,
    tls: { cert: string; key: string },
    private readonly local: LocalActions,
  ) {
    this.https = createServer(
      {
        cert: tls.cert,
        key: tls.key,
        minVersion: 'TLSv1.2',
        requestTimeout: 10000,
        headersTimeout: 10000,
      },
      ((req, res) => void this.http(req, res)) as RequestListener,
    );
    this.https.maxConnections = 64;
    this.https.on('upgrade', (request, socket, head) => {
      const authorization = request.headers.authorization;
      const credential = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
      const device = pairing.authenticate(credential);
      if (
        request.url !== '/api/v1/ws' ||
        request.headers.origin ||
        !device ||
        !this.rpcRate.take(device.deviceId) ||
        this.sockets.size >= 8
      ) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.sockets.set(ws, { deviceId: device.deviceId, credential, hello: false, alive: true });
        ws.on('pong', () => {
          const connection = this.sockets.get(ws);
          if (connection) connection.alive = true;
        });
        ws.on('message', (data, binary) => {
          if (binary) {
            ws.close(1003, 'Text JSON required');
            return;
          }
          void this.message(ws, data.toString());
        });
        ws.on('error', () => {});
        ws.on('close', () => {
          this.sockets.delete(ws);
          if (this.sockets.size === 0) this.approvals.invalidate('expired');
        });
      });
    });
    store.on('event', this.onEvent);
    pairing.on('devicesChanged', this.onDevicesChanged);
    this.heartbeat = setInterval(() => {
      for (const [socket, connection] of this.sockets) {
        if (!connection.alive) {
          socket.terminate();
          continue;
        }
        connection.alive = false;
        socket.ping();
      }
    }, 15000);
    this.heartbeat.unref();
    this.gitTimer = setInterval(() => void this.pollGit(), 5000);
    this.gitTimer.unref();
  }
  async listen(address = '127.0.0.1', port = 49321): Promise<number> {
    return new Promise((resolve, reject) => {
      this.https.once('error', reject);
      this.https.listen(port, address, () => {
        this.https.off('error', reject);
        resolve((this.https.address() as { port: number }).port);
      });
    });
  }
  private async http(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json');
    try {
      invariant(
        req.method === 'POST' &&
          (req.url === '/api/v1/pair/request' || req.url === '/api/v1/pair/claim') &&
          !req.headers.origin,
        'UNAUTHORIZED',
        'Endpoint unavailable',
      );
      invariant(
        (req.url === '/api/v1/pair/claim' ? this.claimRate : this.pairRate).take(
          req.socket.remoteAddress ?? 'unknown',
        ),
        'RATE_LIMITED',
        'Pairing rate limit reached',
      );
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += (chunk as Buffer).length;
        invariant(length <= 4096, 'INVALID_REQUEST', 'Pairing payload too large');
        chunks.push(chunk as Buffer);
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString());
      let result: unknown;
      if (req.url === '/api/v1/pair/request') result = this.pairing.request(value);
      else {
        const input = z
          .object({
            requestId: z.string().min(1).max(160),
            claimToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          })
          .strict()
          .parse(value);
        result = await this.pairing.claim(input.requestId, input.claimToken);
      }
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(error instanceof DeckError && error.code === 'RATE_LIMITED' ? 429 : 400);
      res.end(
        JSON.stringify({
          code: error instanceof DeckError ? error.code : 'INVALID_REQUEST',
          message: error instanceof DeckError ? error.message : 'Invalid pairing request',
        }),
      );
    }
  }
  private send(ws: WebSocket, packet: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 2 * 1024 * 1024) {
      ws.close(1013, 'Slow consumer; replay required');
      return;
    }
    const text = JSON.stringify(packet);
    if (Buffer.byteLength(text) > 1024 * 1024) {
      const id = (packet as { id?: string }).id;
      if (id)
        ws.send(
          JSON.stringify({
            v: VERSION,
            type: 'error',
            id,
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Result exceeds transport limit; reduce history or review locally',
            retryable: false,
          }),
        );
      else ws.close(1013, 'Packet too large; replay required');
      return;
    }
    ws.send(text);
  }
  private async message(ws: WebSocket, text: string): Promise<void> {
    let request: Request | undefined;
    let release: (() => void) | undefined;
    try {
      const connection = this.sockets.get(ws);
      invariant(
        connection && this.pairing.authenticate(connection.credential),
        'UNAUTHORIZED',
        'Device credential revoked',
      );
      invariant(
        this.rpcRate.take(connection.deviceId),
        'RATE_LIMITED',
        'Request rate limit reached',
      );
      const count = this.inFlight.get(connection.deviceId) ?? 0;
      invariant(count < 8, 'RATE_LIMITED', 'Too many concurrent requests');
      this.inFlight.set(connection.deviceId, count + 1);
      release = () => {
        const remaining = (this.inFlight.get(connection.deviceId) ?? 1) - 1;
        if (remaining > 0) this.inFlight.set(connection.deviceId, remaining);
        else this.inFlight.delete(connection.deviceId);
      };
      const parsed: unknown = JSON.parse(text);
      request = parseRequest(parsed);
      invariant(
        connection.hello || request.action === 'system.hello',
        'VERSION_REQUIRED',
        'Send system.hello first',
      );
      if (request.action === 'system.hello') connection.hello = true;
      const mutating = new Set([
        'sessions.create',
        'turn.start',
        'turn.interrupt',
        'approvals.decide',
        'projects.add',
        'projects.remove',
        'devices.revokeSelf',
        'settings.update',
      ]).has(request.action);
      let hash = '';
      if (mutating) {
        hash = createHash('sha256')
          .update(JSON.stringify({ action: request.action, payload: request.payload }))
          .digest('hex');
        const previous = this.store.db
          .prepare('SELECT * FROM requests WHERE deviceId=? AND requestId=?')
          .get(connection.deviceId, request.id) as
          | { requestHash: string; status: string; responseJson: string | null }
          | undefined;
        if (previous) {
          invariant(
            previous.requestHash === hash,
            'CONFLICT',
            'Request id reused with different content',
          );
          if (previous.responseJson) {
            this.send(ws, JSON.parse(previous.responseJson));
            return;
          }
          throw new DeckError(
            'OUTCOME_UNKNOWN',
            `Request is ${previous.status}; reconcile snapshot before retrying`,
          );
        }
        this.store.db
          .prepare("INSERT INTO requests VALUES(?,?,?,'pending',NULL,?)")
          .run(connection.deviceId, request.id, hash, now());
      }
      try {
        const payload = await this.dispatch(request, connection.deviceId);
        const response = {
          v: VERSION,
          type: 'response',
          id: request.id,
          action: request.action,
          payload,
          ts: now(),
        };
        if (mutating)
          this.store.db
            .prepare(
              "UPDATE requests SET status='done',responseJson=? WHERE deviceId=? AND requestId=?",
            )
            .run(JSON.stringify(response), connection.deviceId, request.id);
        this.send(ws, response);
      } catch (error) {
        if (mutating)
          this.store.db
            .prepare("UPDATE requests SET status='unknown' WHERE deviceId=? AND requestId=?")
            .run(connection.deviceId, request.id);
        throw error;
      }
    } catch (error) {
      this.send(ws, {
        v: VERSION,
        type: 'error',
        ...(request ? { id: request.id } : {}),
        code: error instanceof DeckError ? error.code : 'INVALID_REQUEST',
        message:
          error instanceof DeckError
            ? error.message
            : error instanceof ZodError
              ? 'Message does not match protocol schema'
              : 'Invalid request',
        retryable: error instanceof DeckError && error.retryable,
      });
      log('rpc.rejected', { code: error instanceof DeckError ? error.code : 'INVALID_REQUEST' });
    } finally {
      release?.();
    }
  }
  connectedDeviceIds(): string[] {
    return [
      ...new Set(
        [...this.sockets.values()]
          .filter((connection) => connection.hello)
          .map((connection) => connection.deviceId),
      ),
    ];
  }
  snapshot(): Snapshot {
    return this.store.db.transaction(() => ({
      cursor: this.store.cursor(),
      host: {
        hostId: this.store.meta('hostId')!,
        status: this.tasks.upstream.ready ? 'connected' : 'disconnected',
        codexVersion: CODEX_VERSION,
      },
      projects: this.store.projects(),
      sessions: this.store
        .sessions()
        .filter((s) => this.store.projects().some((p) => p.projectId === s.projectId)),
      turns: this.store.turns(),
      approvals: this.store.approvals(),
    }))();
  }
  private async dispatch(request: Request, deviceId: string): Promise<unknown> {
    const p = request.payload as Record<string, unknown>;
    switch (request.action) {
      case 'system.hello':
        return {
          v: VERSION,
          hostId: this.store.meta('hostId'),
          serverVersion: '0.1.0',
          heartbeatSeconds: 15,
        };
      case 'system.capabilities':
        return {
          protocolVersion: VERSION,
          codexVersion: CODEX_VERSION,
          concurrency: 2,
          approvals: ['command', 'fileChange', 'permissions'],
          sandboxVerified: this.store.meta('sandboxVerifiedVersion') === CODEX_VERSION,
        };
      case 'system.diagnostics':
        return {
          at: now(),
          bridgeVersion: '0.1.0',
          protocolVersion: VERSION,
          codexVersion: CODEX_VERSION,
          nodeVersion: process.version,
          platform: process.platform,
          upstreamReady: this.tasks.upstream.ready,
          sandboxVerified: this.store.meta('sandboxVerifiedVersion') === CODEX_VERSION,
          cursor: this.store.cursor(),
          retention: this.store.retention(),
          counts: this.store.diagnosticCounts(),
        };
      case 'settings.get':
        return { retention: this.store.retention() };
      case 'settings.update':
        return { retention: this.store.setRetention(p) };
      case 'snapshot.get':
        return this.snapshot();
      case 'projects.list':
        return { projects: this.store.projects() };
      case 'projects.add':
        this.local.requestProjectAdd();
        return { status: 'awaitingLocalConfirmation' };
      case 'projects.remove':
        this.store.project(String(p.projectId));
        this.local.requestProjectRemove(String(p.projectId));
        return { status: 'awaitingLocalConfirmation' };
      case 'sessions.list':
        if (p.projectId) this.store.project(String(p.projectId));
        return { sessions: this.store.sessions(p.projectId as string | undefined) };
      case 'sessions.create':
        return { session: await this.tasks.create(String(p.projectId), String(p.title)) };
      case 'sessions.detail': {
        const session = this.store.session(String(p.sessionId));
        return {
          session,
          turns: this.store.turns(session.sessionId),
          events: this.store.history(
            session.sessionId,
            p.before as string | undefined,
            Number(p.limit),
          ),
        };
      }
      case 'turn.start':
        return { turn: await this.tasks.start(String(p.sessionId), String(p.text)) };
      case 'turn.interrupt':
        return this.tasks.interrupt(String(p.sessionId), String(p.turnId));
      case 'approvals.list':
        if (p.sessionId) this.store.session(String(p.sessionId));
        return { approvals: this.store.approvals(p.sessionId as string | undefined) };
      case 'approvals.decide':
        return this.approvals.decide(
          String(p.sessionId),
          String(p.turnId),
          String(p.approvalId),
          p.decision as 'approve' | 'reject' | 'cancel',
        );
      case 'git.status':
        return this.git.status(String(p.projectId));
      case 'git.diff':
        return this.git.diff(String(p.projectId), String(p.fileId));
      case 'events.replay':
        return this.store.replay(p.cursor as string | undefined, Number(p.limit));
      case 'devices.revokeSelf':
        this.pairing.revokeLocal(deviceId);
        return { revoked: true };
    }
  }
  private async pollGit(): Promise<void> {
    if (this.polling || !this.sockets.size) return;
    this.polling = true;
    try {
      for (const project of this.store.projects()) {
        try {
          const status = await this.git.status(project.projectId);
          const hash = createHash('sha256')
            .update(JSON.stringify(status))
            .update(await this.git.changeToken(project.projectId, status.files))
            .digest('hex');
          if (
            this.gitHashes.has(project.projectId) &&
            this.gitHashes.get(project.projectId) !== hash
          )
            this.store.append('git.changed', {
              projectId: project.projectId,
              attribution: 'working-tree',
            });
          this.gitHashes.set(project.projectId, hash);
        } catch {
          /* errors are reported by explicit review requests */
        }
      }
    } finally {
      this.polling = false;
    }
  }
  async close(): Promise<void> {
    this.store.off('event', this.onEvent);
    this.pairing.off('devicesChanged', this.onDevicesChanged);
    clearInterval(this.heartbeat);
    clearInterval(this.gitTimer);
    for (const socket of this.sockets.keys()) socket.terminate();
    this.sockets.clear();
    this.wss.close();
    if (this.https.listening)
      await new Promise<void>((resolve) => this.https.close(() => resolve()));
  }
}

import { t } from '../i18n';
export type ConnectionState =
  | 'connecting'
  | 'syncing'
  | 'connected'
  | 'retrying'
  | 'blocked'
  | 'stopped';

export const connectionLabels: Record<ConnectionState, string> = {
  get connected() {
    return t('已连接');
  },
  get syncing() {
    return t('已连接，正在同步');
  },
  get connecting() {
    return t('正在连接');
  },
  get retrying() {
    return t('正在重新连接');
  },
  get blocked() {
    return t('连接需要处理');
  },
  get stopped() {
    return t('未连接');
  },
};

export function connectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/TimeoutError|timed out|timeout/i.test(message))
    return t('连接请求超时，正在自动重试；电脑在线不代表浏览器连接已完成。');
  if (/Cloud tunnel|relay|Failed to fetch|NetworkError|network|LAN unavailable/i.test(message))
    return t('浏览器到电脑的连接暂时不可用，正在自动重试。');
  return message;
}

// Authentication, storage and identity failures require user action. Network
// failures may retry; mutations are never part of this loop.
export function retryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return !/certificate|pin\b|identity|authorization|credential|UNAUTHORIZED|FORBIDDEN|REVOKED|AUTH_|DEVICE_|ACCOUNT_|storage|stored|grant|pairing|receipt|identity|authorization|account|browser does not support|SecurityError|QuotaExceeded|OperationError|配对|回执|存储|身份|授权|账户|浏览器不支持/i.test(
    message,
  );
}

export class ReconnectLoop {
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private dispose?: () => void;
  private attempt = 0;
  private stopped = true;
  private blocked = false;
  private running = false;

  constructor(
    private readonly open: (context: {
      current: () => boolean;
      closed: (error: Error) => void;
      own: (dispose: () => void) => void;
      linked: () => void;
    }) => Promise<void>,
    private readonly state: (state: ConnectionState, error?: unknown) => void,
  ) {}

  start() {
    this.stop();
    this.stopped = false;
    this.blocked = false;
    this.attempt = 0;
    void this.run();
  }

  wake() {
    if (this.stopped || this.blocked || this.running) return;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
      void this.run();
    } else if (this.dispose) {
      // A read-only hello detects sockets which survived browser suspension
      // without delivering a close event. The owner performs that probe.
      return;
    } else void this.run();
  }

  private async run() {
    if (this.stopped || this.running) return;
    this.running = true;
    const generation = ++this.generation;
    const current = () => !this.stopped && generation === this.generation;
    this.state(this.attempt ? 'retrying' : 'connecting');
    try {
      await this.open({
        current,
        linked: () => {
          if (current()) this.state('syncing');
        },
        own: (dispose) => {
          if (current()) this.dispose = dispose;
          else dispose();
        },
        closed: (error) => {
          if (current()) this.failed(error);
        },
      });
      if (current()) {
        this.attempt = 0;
        this.state('connected');
      }
    } catch (error) {
      if (current()) this.failed(error);
    } finally {
      if (generation === this.generation) this.running = false;
    }
  }

  private failed(error: unknown) {
    this.generation++;
    this.running = false;
    const dispose = this.dispose;
    this.dispose = undefined;
    dispose?.();
    this.blocked = !retryable(error);
    this.state(this.blocked ? 'blocked' : 'retrying', error);
    if (this.blocked || this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt++, 5));
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.run();
      },
      delay + Math.floor(Math.random() * delay * 0.2),
    );
  }

  stop() {
    this.stopped = true;
    this.generation++;
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const dispose = this.dispose;
    this.dispose = undefined;
    dispose?.();
  }
}

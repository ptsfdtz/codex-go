import { errorText, t, useLocale } from '../i18n';
import { Select } from '../components/Select';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Request } from '../workspace';
import { IconButton, Modal } from '../ui';
import { MotionPresence } from '../motion';
import { usePreference } from './preferences';

export type HostRelease = {
  notes?: string | null;
  channel?: 'stable' | 'candidate';
  current: string | null;
  latest: string;
  platform: string;
  installation: 'release' | 'development';
  updateAvailable: boolean;
};
type UpdateJob = {
  id: string;
  version: string;
  previousVersion: string;
  phase:
    | 'installing'
    | 'installed'
    | 'waitingIdle'
    | 'restarting'
    | 'preparingRuntime'
    | 'complete'
    | 'failed';
  installed: boolean;
  error: string | null;
};
type UpdateStatus = {
  job: UpdateJob | null;
  host?: {
    version: string | null;
    cloudOnline: boolean;
    codexReady: boolean;
    runtimeError: unknown;
  };
};
const phases: Record<UpdateJob['phase'], string> = {
  get installing() {
    return t('正在下载、校验并安装，当前任务继续运行');
  },
  get installed() {
    return t('已安装，等待你确认空闲重启');
  },
  get waitingIdle() {
    return t('等待全部任务、审批及未知结果核对完成；空闲后重启');
  },
  get restarting() {
    return t('正在重启，连接将短暂中断');
  },
  get preparingRuntime() {
    return t('正在连接并准备 Codex 运行环境');
  },
  get complete() {
    return t('更新完成');
  },
  get failed() {
    return t('更新未完成');
  },
};
function validVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value) &&
    !value.includes('..')
  );
}
export function HostUpdates({
  request,
  supported,
  managed,
  disabled,
  name,
  hostId,
}: {
  request: Request;
  supported: boolean;
  managed: boolean;
  disabled: boolean;
  name: string;
  hostId: string;
}) {
  useLocale();
  const [dismissedJobId, setDismissedJobId] = usePreference<string>(
    `agentdeck.web.host-update-dismissed.${hostId}`,
    '',
    (value): value is string => typeof value === 'string',
  );
  const [release, setRelease] = useState<HostRelease>();
  const [status, setStatus] = useState<UpdateStatus>();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [legacyPlatform, setLegacyPlatform] = useState('windows');
  const mounted = useRef(false);
  const job = status?.job;
  const active =
    !!job && ['installing', 'waitingIdle', 'restarting', 'preparingRuntime'].includes(job.phase);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let inFlight = false;
    let lastReleaseCheck = 0;
    let lastRunningVersion: string | null | undefined;
    async function check() {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      setChecking(true);
      try {
        if (managed) {
          const value = await request<UpdateStatus>('system.updateStatus');
          if (
            value.job &&
            (!validVersion(value.job.version) ||
              !phases[value.job.phase] ||
              typeof value.job.id !== 'string')
          )
            throw new Error(t('Invalid update status'));
          if (!cancelled) setStatus(value);
          if (value.host?.version !== lastRunningVersion) {
            lastReleaseCheck = 0;
            lastRunningVersion = value.host?.version;
          }
        }
        if (supported && Date.now() - lastReleaseCheck > 30 * 60 * 1000) {
          const value = await request<HostRelease>('system.updateCheck');
          if (
            !value ||
            !validVersion(value.latest) ||
            (value.current !== null && !validVersion(value.current)) ||
            !['release', 'development'].includes(value.installation) ||
            typeof value.updateAvailable !== 'boolean'
          )
            throw new Error(t('Invalid release'));
          lastReleaseCheck = Date.now();
          if (!cancelled) setRelease(value);
        }
        if (!cancelled) setError('');
      } catch {
        if (!cancelled) setError(t('更新状态暂时无法读取，请重连后核对；不要重复安装'));
      } finally {
        inFlight = false;
        if (!cancelled) setChecking(false);
      }
    }
    void check();
    const timer = setInterval(() => void check(), managed ? 3000 : 30 * 60 * 1000);
    const visible = () => void check();
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelled = true;
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [request, supported, managed, attempt]);
  async function act(action: string, payload: Record<string, string>) {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      const value = await request<UpdateStatus>(action, payload);
      if (mounted.current) setStatus(value);
    } catch (cause) {
      if (mounted.current)
        setError(t('操作未确认，请先刷新状态核对。{{p0}}', { p0: String(cause) }));
    } finally {
      if (mounted.current) setWorking(false);
    }
  }
  const outdated = release?.updateAvailable === true;
  const unknown = !supported || (release?.installation === 'release' && !release.current);
  const confirmedComplete =
    job?.phase === 'complete' &&
    status?.host?.version === job.version &&
    status.host.cloudOnline &&
    status.host.codexReady &&
    !status.host.runtimeError;
  function closeNotice() {
    setOpen(false);
    if (!confirmedComplete || !job) return;
    setDismissedJobId(job.id);
  }
  if (!outdated && !unknown && !error && (!job || (confirmedComplete && dismissedJobId === job.id)))
    return null;
  const legacyCommand =
    (release?.platform || legacyPlatform) === 'linux'
      ? 'curl -fsSL https://agent.ptsfdtz.top/install.sh | sh'
      : 'irm https://agent.ptsfdtz.top/install.ps1 | iex';
  return (
    <aside className="host-update-notice" aria-label={t('电脑更新')}>
      <span role="status">
        {`${name}：`}
        {error ||
          (outdated && (!job || confirmedComplete)
            ? t('发现新版 {{p0}}', { p0: release.latest })
            : job
              ? confirmedComplete
                ? t('更新完成')
                : job.phase === 'complete'
                  ? t('已更新，当前连接或 Codex 尚未就绪')
                  : phases[job.phase]
              : t('旧版 Host 需要在电脑上升级一次'))}
      </span>
      <div className="host-update-actions">
        <button onClick={() => setOpen(true)}>{t('查看更新')}</button>
        {confirmedComplete && !outdated && !unknown && !error && (
          <IconButton icon={X} label={t('关闭更新完成提示')} onClick={closeNotice} />
        )}
      </div>
      <MotionPresence>
        {open && (
          <Modal title={t('更新 {{p0}}', { p0: name })} onClose={closeNotice}>
            <div className="panel-stack">
              <p>{t('这是当前选中的被控制电脑。更新保留账户、电脑身份、项目与会话。')}</p>
              {release && (
                <p>
                  {t('运行版本：')}
                  {status?.host?.version || release.current || t('未知')}
                  <br />
                  {release.channel === 'candidate' ? t('候选测试版本') : t('稳定版本')}：
                  {release.latest}
                </p>
              )}
              {job && (
                <p role="status">
                  {t('目标版本：')}
                  {job.version}
                  <br />
                  {confirmedComplete
                    ? t('更新完成，云端连接与 Codex 已就绪')
                    : job.phase === 'complete'
                      ? t('已更新，当前连接或 Codex 尚未就绪')
                      : phases[job.phase]}
                </p>
              )}
              {release?.notes && <pre className="host-update-prompt">{release.notes}</pre>}
              {job?.error && <p role="alert">{errorText(job.error)}</p>}
              {error && <p role="alert">{errorText(error)}</p>}
              {managed ? (
                <>
                  {outdated && !active && !(job?.installed && job.version === release.latest) && (
                    <button
                      disabled={working || disabled}
                      onClick={() => void act('system.updateInstall', { version: release.latest })}
                    >
                      {t('下载并安装更新')}
                    </button>
                  )}
                  {job?.installed && ['installed', 'failed'].includes(job.phase) && (
                    <>
                      <p>
                        {t(
                          '确认后，Host 会等待所有任务结束并核对审批与未知结果，再重启切换版本。请先保存其他客户端的工作。',
                        )}
                      </p>
                      <button
                        disabled={working || disabled}
                        onClick={() => void act('system.updateApply', { jobId: job.id })}
                      >
                        {t('空闲后重启并完成更新')}
                      </button>
                    </>
                  )}
                  {job?.phase === 'waitingIdle' && (
                    <button
                      disabled={working || disabled}
                      onClick={() => void act('system.updateCancel', { jobId: job.id })}
                    >
                      {t('取消待重启')}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p>
                    {t(
                      '此 Host 尚不支持网页直接更新。请在这台电脑的终端执行安装命令，任务空闲后再执行 agentdeck restart。以后可直接在网页更新，无需 AI 会话。',
                    )}
                  </p>
                  {!release && (
                    <label>
                      {t('被控制电脑的系统')}
                      <Select
                        aria-label={t('被控制电脑的系统')}
                        value={legacyPlatform}
                        onValueChange={(value) => setLegacyPlatform(value)}
                      >
                        <option value="windows">Windows</option>
                        <option value="linux">Linux</option>
                      </Select>
                    </label>
                  )}
                  <pre className="host-update-prompt">
                    {legacyCommand}
                    {'\n'}agentdeck restart{'\n'}agentdeck status --json
                  </pre>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `${legacyCommand}\nagentdeck restart\nagentdeck status --json`,
                        );
                      } catch {
                        setError(t('复制失败，请手动选择命令复制'));
                      }
                    }}
                  >
                    {t('复制命令')}
                  </button>
                </>
              )}
              <button
                disabled={checking || working}
                onClick={() => setAttempt((value) => value + 1)}
              >
                {t('刷新状态')}
              </button>
            </div>
          </Modal>
        )}
      </MotionPresence>
    </aside>
  );
}

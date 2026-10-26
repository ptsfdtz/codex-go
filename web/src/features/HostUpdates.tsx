import { useEffect, useRef, useState } from 'react';
import type { Project, Request } from '../workspace';
import { Modal } from '../ui';
import { MotionPresence } from '../motion';

export type HostRelease = {
  current: string | null;
  latest: string;
  platform: string;
  installation: 'release' | 'development';
  updateAvailable: boolean;
};
export function updatePrompt(release?: HostRelease): string {
  return [
    '请更新当前这台电脑上的 AgentDeck Host。',
    release
      ? `检查时运行版本：${release.current || '未知'}，官方稳定版本：${release.latest}。请重新核对实际版本，不要仅凭此消息认定更新完成。`
      : '当前 Host 较旧，网页无法识别发布版本。请先检查实际安装位置和官方最新稳定版本。',
    '仅使用官方 HTTPS 更新源 https://agent.ptsfdtz.top 。先定位当前运行服务对应的安装目录与数据目录，确认不是开发版或另一份安装；不能确定时停止并向我说明。',
    '优先使用当前安装对应的 agentdeck update --check 和 agentdeck update。若旧版没有 update 命令，下载官方 install.ps1（Windows）或 install.sh（Linux）到临时文件，检查脚本后指定原安装目录运行；不要盲目向默认目录安装第二份 Host。校验 HTTPS 和 SHA-256，不关闭证书校验。',
    '保留账户、电脑身份和证书、项目授权、自启动设置、会话与审批记录。不要修改 Codex 运行时、项目代码、应用身份或数据库，不卸载、不清除数据、不自动提权；权限不足时使用正常审批或向我说明。',
    '只下载并安装更新，不执行 stop、restart、结束进程或重启电脑，因为这会中断本会话和其他任务。完成后报告下载版本、校验结果、安装位置，以及当前运行版本是否仍为旧版；提醒我在所有任务空闲后手动重启生效。失败或结果未知先核对，不自动重复安装，不宣称已生效。',
  ].join('\n\n');
}

export function HostUpdates({
  request,
  supported,
  disabled,
  name,
  projects,
  selectedProject,
  onUpdate,
}: {
  request: Request;
  supported: boolean;
  disabled: boolean;
  name: string;
  projects: Project[];
  selectedProject?: string;
  onUpdate: (text: string, projectId: string) => Promise<void>;
}) {
  const [release, setRelease] = useState<HostRelease>();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState(selectedProject || projects[0]?.projectId || '');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let inFlight = false;
    async function check() {
      if (!supported || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      setChecking(true);
      try {
        const value = await request<HostRelease>('system.updateCheck');
        if (
          !value ||
          !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value.latest) ||
          value.latest.includes('..') ||
          (value.current !== null &&
            (typeof value.current !== 'string' ||
              !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value.current) ||
              value.current.includes('..'))) ||
          !['release', 'development'].includes(value.installation) ||
          typeof value.updateAvailable !== 'boolean'
        )
          throw new Error('Invalid release');
        if (!cancelled) {
          setRelease(value);
          setError('');
        }
      } catch {
        if (!cancelled) {
          setRelease(undefined);
          setError('设备更新检查失败，请稍后重试');
        }
      } finally {
        inFlight = false;
        if (!cancelled) setChecking(false);
      }
    }
    void check();
    const timer = setInterval(() => void check(), 30 * 60 * 1000);
    const visible = () => void check();
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelled = true;
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [request, supported, attempt]);
  const outdated =
    release?.installation === 'release' && !!release.current && release.current !== release.latest;
  const unknown = !supported || (release?.installation === 'release' && !release.current);
  if (!outdated && !unknown && !error) return null;
  return (
    <aside className="host-update-notice" aria-label="设备更新">
      <span role="status">
        {error ||
          (outdated
            ? `${name} 需要更新：${release.current} → ${release.latest}`
            : `${name} 的版本待确认，旧版 Host 不支持自动检查`)}
      </span>
      {error ? (
        <button disabled={checking} onClick={() => setAttempt((value) => value + 1)}>
          重新检查
        </button>
      ) : (
        <button
          disabled={disabled || !projects.length}
          onClick={() => {
            setProject(
              projects.some((p) => p.projectId === selectedProject)
                ? selectedProject!
                : projects[0]?.projectId || '',
            );
            setOpen(true);
          }}
        >
          {outdated ? '让本地 AI 更新' : '让本地 AI 检查并更新'}
        </button>
      )}
      {!projects.length && <small>先在电脑端授权项目，或连接支持普通聊天的 Host。</small>}
      <MotionPresence>
        {open && (
          <Modal title={`更新 ${name}`} onClose={() => setOpen(false)}>
            <div className="panel-stack">
              <p>
                将在这台电脑新建更新会话并发送以下提示词。沿用工作区权限和正常审批，不自动重启。
              </p>
              <label>
                更新会话所在工作区
                <select
                  aria-label="更新工作区"
                  value={project}
                  onChange={(event) => setProject(event.target.value)}
                >
                  {projects.map((item) => (
                    <option key={item.projectId} value={item.projectId}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <pre className="host-update-prompt">{updatePrompt(release)}</pre>
              <button
                disabled={disabled || !projects.some((p) => p.projectId === project)}
                onClick={async () => {
                  await onUpdate(updatePrompt(release), project);
                  if (alive.current) setOpen(false);
                }}
              >
                发送更新提示词
              </button>
            </div>
          </Modal>
        )}
      </MotionPresence>
    </aside>
  );
}

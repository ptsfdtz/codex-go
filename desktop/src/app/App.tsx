import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  errorText,
  informationNotice,
  presentDesktopError,
  presentThrownError,
  type ErrorPresentation,
} from '../bridge/errors';
import {
  ArrowRight,
  CircleCheck,
  Download,
  Ellipsis,
  Folder,
  LoaderCircle,
  Minus,
  Plus,
  QrCode,
  RotateCw,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Unplug,
  Wifi,
  X,
} from 'lucide-react';
import {
  emptyView,
  host,
  type Action,
  type Approval,
  type LocalRequest,
  type View,
} from '../bridge/host';

type Panel = 'projects' | 'devices' | 'network' | 'approvals' | 'quit' | null;
type Confirmation = { title: string; text: string; label: string; action: Action };
const kind = (method: string) =>
  method.includes('commandExecution')
    ? '执行命令'
    : method.includes('fileChange')
      ? '修改文件'
      : '额外权限';
export const remaining = (expiresAt: string | undefined, now: number) =>
  expiresAt ? Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000)) : 0;
export function newest(current: View, incoming: View): View {
  return incoming.revision > current.revision ? incoming : current;
}
const time = (raw: string | undefined) =>
  raw && !Number.isNaN(Date.parse(raw))
    ? new Date(raw).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '';

function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
  error,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  error?: string | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2 id="modal-title">{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button className="icon-button" aria-label="关闭面板" onClick={onClose} autoFocus>
          <X size={18} />
        </button>
      </div>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {children}
    </dialog>
  );
}

export function App() {
  const [view, setView] = useState(emptyView);
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<ErrorPresentation | null>(null);
  const [installingCodex, setInstallingCodex] = useState(false);
  const [checkingCodex, setCheckingCodex] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [localRequest, setLocalRequest] = useState<LocalRequest | null>(null);
  const [selectedApproval, setSelectedApproval] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [showPair, setShowPair] = useState(false);
  const [dismissedPair, setDismissedPair] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    let disposed = false;
    const releases: (() => void)[] = [];
    const keep = (fn: () => void) => {
      if (disposed) fn();
      else releases.push(fn);
    };
    const accept = (v: View) => {
      if (!disposed) setView((old) => newest(old, v));
    };
    void (async () => {
      try {
        keep(await host.subscribe(accept));
        keep(await host.localRequests((r) => setLocalRequest(r)));
        accept(await host.snapshot());
      } catch {
        if (!disposed)
          setNotice(
            informationNotice(
              '本机服务不可用',
              '请从 Windows 的 AgentDeck 桌面应用打开。浏览器预览未连接本机服务。',
            ),
          );
      }
    })();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
      releases.forEach((fn) => fn());
    };
  }, []);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  const state = view.state;
  const online = view.running ? state.devices.find((d) => d.connected) : undefined;
  const knownDevice = online ?? state.devices[0];
  const ready = view.running && state.codexReady && state.sandboxVerified;
  const seconds = remaining(view.qr?.expiresAt, now);
  const pairingValid = remaining(view.pairing?.expiresAt, now) > 0;
  const activeQr = view.qr && seconds > 0 && view.running ? view.qr : null;
  const approvals = state.approvals.filter(
    (a) => a.status === 'pending' && remaining(a.expiresAt, now) > 0,
  );
  const approval = approvals.find((a) => a.approvalId === selectedApproval) ?? approvals[0];
  const visibleHelp =
    notice ?? (view.error ? presentDesktopError(view.errorCode, view.error) : null);
  const visibleError = visibleHelp ? errorText(visibleHelp) : null;
  const startupHelp = view.error && !notice ? visibleHelp : null;
  const effectiveAddress = state.addresses.includes(address)
    ? address
    : (state.addresses.find((a) => a === state.listenAddress && a !== '127.0.0.1') ??
      state.addresses.find((a) => a !== '127.0.0.1') ??
      '');
  const choose = (p: Panel) => {
    setMenu(false);
    setSearch('');
    setPanel(p);
  };
  const run = async (label: string, fn: () => Promise<unknown>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(label);
    setNotice(null);
    try {
      await fn();
      return true;
    } catch (error) {
      setNotice(presentThrownError(error));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };
  const recheckCodex = async () => {
    setCheckingCodex(true);
    setNotice(null);
    try {
      await host.restart();
    } catch (error) {
      setNotice(presentThrownError(error));
    } finally {
      setCheckingCodex(false);
    }
  };
  const installSupportedCodex = async () => {
    setInstallingCodex(true);
    setNotice(
      informationNotice('正在安装兼容版', '正在从 npm 官方仓库下载并校验 Codex CLI 0.159.2。'),
    );
    try {
      await host.installSupportedCodex();
      setNotice(null);
    } catch (error) {
      setNotice(presentThrownError(error));
    } finally {
      setInstallingCodex(false);
    }
  };
  const send = (label: string, action: Action) => run(label, () => host.action(action));
  const pair = async () => {
    if (!effectiveAddress) {
      setNotice(informationNotice('未找到局域网地址', '请将电脑和平板连接同一 Wi-Fi 后重试。'));
      return;
    }
    if (await send('pair', { action: 'pair.create', address: effectiveAddress })) setShowPair(true);
  };
  const confirmApproval = (a: Approval, decision: 'approve' | 'reject') =>
    setConfirmation({
      title: decision === 'approve' ? '允许这一次操作？' : '拒绝这次请求？',
      text: JSON.stringify(a.context, null, 2),
      label: decision === 'approve' ? '确认允许一次' : '确认拒绝',
      action: {
        action: 'approval.decide',
        approvalId: a.approvalId,
        sessionId: a.sessionId,
        turnId: a.turnId,
        decision,
      },
    });
  const nativeWindow = (action: 'minimize' | 'hide') => {
    try {
      const window = getCurrentWindow();
      void window[action]().catch(() =>
        setNotice(informationNotice('无法执行此操作', '此操作仅适用于 Windows 桌面窗口。')),
      );
    } catch {
      setNotice(informationNotice('无法执行此操作', '此操作仅适用于 Windows 桌面窗口。'));
    }
  };
  const drag = (event: React.PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    try {
      void getCurrentWindow()
        .startDragging()
        .catch(() => {});
    } catch {
      /* Browser preview has no window. */
    }
  };
  const title = ready
    ? 'Codex 已就绪'
    : view.errorCode === 'UPSTREAM_VERSION_UNSUPPORTED'
      ? 'Codex 版本需处理'
      : view.running
        ? state.sandboxVerified
          ? '正在连接 Codex'
          : '正在检查安全环境'
        : '服务未连接';
  return (
    <div className="app-shell">
      <header className="topbar" onPointerDown={drag}>
        <div className="brand">
          <span>AgentDeck</span>
        </div>
        <div className="window-actions">
          <span className={`status ${ready ? 'ready' : ''}`}>
            <i />
            {title}
          </span>
          <div className="menu-anchor" ref={menuRef}>
            <button
              className="icon-button"
              aria-label="更多"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Ellipsis size={20} />
            </button>
            {menu && (
              <div className="more-menu" aria-label="更多操作">
                <button onClick={() => choose('projects')}>
                  <Folder size={16} />
                  工作区<span>{state.projects.length}</span>
                </button>
                <button onClick={() => choose('devices')}>
                  <Smartphone size={16} />
                  已配对设备<span>{state.devices.length}</span>
                </button>
                <button onClick={() => choose('approvals')}>
                  <ShieldCheck size={16} />
                  待审批<span>{approvals.length}</span>
                </button>
                <button onClick={() => choose('network')}>
                  <Wifi size={16} />
                  连接详情
                </button>
                <hr />
                <button className="danger-text" onClick={() => choose('quit')}>
                  <Unplug size={16} />
                  停止并退出
                </button>
              </div>
            )}
          </div>
          <span className="chrome-divider" />
          <button
            className="icon-button chrome"
            aria-label="最小化"
            onClick={() => nativeWindow('minimize')}
          >
            <Minus size={17} />
          </button>
          <button
            className="icon-button chrome"
            aria-label="收起到托盘"
            title="收起到托盘，连接会继续保持"
            onClick={() => nativeWindow('hide')}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <main>
        <div className="connection-content">
          <div className="page-heading">
            <h1>连接平板</h1>
            <p>同步工作区后，在平板扫码即可。</p>
          </div>
          {visibleError && (
            <div className="notice" role="alert">
              <div className="notice-copy">
                {visibleHelp && <strong>{visibleHelp.title}</strong>}
                {visibleHelp && <span>{visibleHelp.detail}</span>}
                {visibleHelp?.solution && <p>{visibleHelp.solution}</p>}
                {startupHelp && (
                  <div className="notice-actions">
                    {startupHelp.install && (
                      <button
                        className="button secondary compact"
                        disabled={installingCodex || checkingCodex}
                        onClick={() => void installSupportedCodex()}
                      >
                        {installingCodex ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <Download size={15} />
                        )}
                        {installingCodex ? '正在安装兼容版…' : '安装 Codex CLI 0.159.2'}
                      </button>
                    )}
                    <button
                      className="button secondary compact"
                      disabled={installingCodex || checkingCodex}
                      onClick={() => void recheckCodex()}
                    >
                      {checkingCodex ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <RotateCw size={15} />
                      )}
                      {checkingCodex ? '正在检测…' : '重新检测'}
                    </button>
                  </div>
                )}
              </div>
              {notice && (
                <button
                  className="icon-button"
                  aria-label="关闭提示"
                  onClick={() => setNotice(null)}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          )}
          <section className="connection-settings" aria-label="工作区与配对">
            <div className="setting-row">
              <Folder size={20} />
              <div className="setting-copy">
                <h2>工作区</h2>
                <button className="text-button workspace-count" onClick={() => choose('projects')}>
                  {state.projects.length ? state.projects.length + ' 个工作区' : '尚未同步工作区'}
                </button>
                {state.lastWorkspaceSync && (
                  <span className="sync-time"> · {time(state.lastWorkspaceSync)} 同步</span>
                )}
              </div>
              <button
                className="button secondary"
                disabled={!ready || busy !== null}
                onClick={() => void send('sync', { action: 'workspaces.sync' })}
              >
                {busy === 'sync' ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <RefreshCw size={16} />
                )}
                {busy === 'sync' ? '正在同步…' : '同步工作区'}
              </button>
            </div>
            <div className="setting-row">
              <Smartphone size={20} />
              <div className="setting-copy">
                <h2>{knownDevice ? knownDevice.displayName : '平板'}</h2>
                <p>
                  {online
                    ? '已连接'
                    : knownDevice
                      ? view.running
                        ? '已配对 · 等待连接'
                        : '服务未连接'
                      : '尚未配对'}
                </p>
              </div>
              {knownDevice && (
                <button
                  className="button secondary"
                  disabled={!ready || busy !== null}
                  onClick={() => void pair()}
                >
                  {busy === 'pair' ? '正在生成…' : '重新配对'}
                </button>
              )}
            </div>
          </section>
          {(!knownDevice || showPair) && (
            <section className="pair-area" aria-label="扫码配对">
              {activeQr ? (
                <>
                  <div className="qr-frame">
                    <img
                      src={'data:image/png;base64,' + activeQr.image}
                      alt="使用 AgentDeck 平板端扫描此配对码"
                    />
                  </div>
                  <p>用平板上的 AgentDeck 扫码</p>
                  <div className="qr-footer">
                    <span>{seconds} 秒后失效</span>
                    <button
                      className="text-button"
                      disabled={busy !== null}
                      onClick={() => void pair()}
                    >
                      刷新
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>{view.qr && seconds === 0 ? '配对码已过期' : '电脑和平板需连接同一 Wi-Fi'}</p>
                  <button
                    className="button primary"
                    disabled={!ready || busy !== null || !effectiveAddress}
                    onClick={() => void pair()}
                  >
                    {busy === 'pair' ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <QrCode size={17} />
                    )}
                    {busy === 'pair' ? '正在生成…' : view.qr ? '重新生成配对码' : '显示配对码'}
                  </button>
                </>
              )}
              {knownDevice && (
                <button className="text-button" onClick={() => setShowPair(false)}>
                  返回已配对设备
                </button>
              )}
            </section>
          )}
          {online && !showPair && <p className="connected-hint">可以在平板上继续工作了。</p>}
          {!view.running && <p className="stale-hint">服务未连接，以上信息可能已过期。</p>}
          {approvals.length > 0 && (
            <button className="approval-banner" onClick={() => choose('approvals')}>
              <ShieldCheck size={18} />
              <span>{approvals.length} 个操作等待你确认</span>
              <ArrowRight size={16} />
            </button>
          )}
          <button className="text-button network-link" onClick={() => choose('network')}>
            连接详情
          </button>
        </div>
      </main>
      {view.pairing && view.pairing.requestId !== dismissedPair ? (
        <Modal
          error={visibleError}
          title={pairingValid ? '确认是你的平板' : '配对请求已过期'}
          description="核对两台设备上的六位码完全一致。"
          onClose={() => {
            if (!pairingValid) {
              setDismissedPair(view.pairing!.requestId);
              return;
            }
            if (!busy)
              void send('pairConfirm', {
                action: 'pair.confirm',
                requestId: view.pairing!.requestId,
                approve: false,
              });
          }}
        >
          <div className="pair-confirm-device">
            <Smartphone size={22} />
            {view.pairing.displayName}
          </div>
          <div className="match-code">{view.pairing.code}</div>
          <p className="modal-hint">仅当设备属于你且配对码一致时确认。新的配对会替换此前设备。</p>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => {
                if (!pairingValid) setDismissedPair(view.pairing!.requestId);
                else
                  void send('pairConfirm', {
                    action: 'pair.confirm',
                    requestId: view.pairing!.requestId,
                    approve: false,
                  });
              }}
            >
              拒绝
            </button>
            <button
              className="button primary"
              disabled={!!busy || !pairingValid}
              onClick={() =>
                void send('pairConfirm', {
                  action: 'pair.confirm',
                  requestId: view.pairing!.requestId,
                  approve: true,
                })
              }
            >
              配对码一致，确认
            </button>
          </div>
        </Modal>
      ) : confirmation ? (
        <Modal
          error={visibleError}
          title={confirmation.title}
          description="请核对完整内容。决定提交后不可撤回。"
          onClose={() => {
            if (!busy) setConfirmation(null);
          }}
          wide
        >
          <pre className="review-context">{confirmation.text}</pre>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => setConfirmation(null)}
            >
              取消
            </button>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() =>
                void (async () => {
                  if (await send('confirm', confirmation.action)) setConfirmation(null);
                })()
              }
            >
              {busy === 'confirm' ? '正在提交…' : confirmation.label}
            </button>
          </div>
        </Modal>
      ) : localRequest ? (
        <Modal
          error={visibleError}
          title="平板请求修改工作区授权"
          description="只有你在这台电脑上确认，才能改变可访问范围。"
          onClose={() => setLocalRequest(null)}
        >
          <p className="modal-hint">
            {localRequest.type === 'project.addRequest'
              ? '在本机选择要授权的项目目录。'
              : (state.projects.find((p) => p.projectId === localRequest.payload.projectId)
                  ?.canonicalPath ?? '项目已不存在')}
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setLocalRequest(null)}>
              暂不处理
            </button>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() => {
                if (localRequest.type === 'project.addRequest')
                  void run('add', host.pickProject).then((ok) => {
                    if (ok) setLocalRequest(null);
                  });
                else {
                  setConfirmation({
                    title: '移除项目授权？',
                    text:
                      state.projects.find((p) => p.projectId === localRequest.payload.projectId)
                        ?.canonicalPath ?? '',
                    label: '移除授权',
                    action: {
                      action: 'project.remove',
                      projectId: localRequest.payload.projectId ?? '',
                    },
                  });
                  setLocalRequest(null);
                }
              }}
            >
              {localRequest.type === 'project.addRequest' ? '在本机选择目录' : '查看并移除授权'}
            </button>
          </div>
        </Modal>
      ) : panel === 'projects' ? (
        <Modal
          error={visibleError}
          title="你的工作区"
          description="同步包含可信配置与 Codex 历史中仍然存在的项目目录。"
          onClose={() => setPanel(null)}
          wide
        >
          <div className="panel-toolbar">
            <input
              aria-label="搜索工作区"
              placeholder="搜索名称或路径"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className="button secondary compact"
              disabled={!!busy}
              onClick={() => void run('add', host.pickProject)}
            >
              <Plus size={15} />
              添加目录
            </button>
          </div>
          <div className="detail-list">
            {state.projects
              .filter((p) =>
                `${p.name} ${p.canonicalPath}`.toLowerCase().includes(search.toLowerCase()),
              )
              .map((p) => (
                <div className="detail-row" key={p.projectId}>
                  <span className="project-glyph">
                    <Folder size={18} />
                  </span>
                  <div>
                    <strong>{p.name}</strong>
                    <p>{p.canonicalPath}</p>
                  </div>
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() =>
                      setConfirmation({
                        title: '移除项目授权？',
                        text: `${p.canonicalPath}\n\n文件会保留在磁盘上。进行中的任务会阻止移除。`,
                        label: '移除授权',
                        action: { action: 'project.remove', projectId: p.projectId },
                      })
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
            {state.projects.length === 0 && (
              <p className="empty-message">尚无已授权工作区。返回首页同步，或添加目录。</p>
            )}
          </div>
          <p className="modal-hint">
            同步不会复制文件或接管桌面会话；平板可在这些目录中新建和继续 AgentDeck 任务。
          </p>
        </Modal>
      ) : panel === 'devices' ? (
        <Modal
          error={visibleError}
          title="已配对设备"
          description="撤销后，设备会立即断开；再次使用需要重新扫码。"
          onClose={() => setPanel(null)}
        >
          <div className="detail-list">
            {state.devices.length ? (
              state.devices.map((d) => (
                <div className="detail-row" key={d.deviceId}>
                  <span className="project-glyph">
                    <Smartphone size={20} />
                  </span>
                  <div>
                    <strong>{d.displayName}</strong>
                    <p>{d.connected ? '当前在线' : '已配对 · 当前离线'}</p>
                  </div>
                  <button
                    className="text-button danger-text"
                    disabled={!!busy}
                    onClick={() =>
                      setConfirmation({
                        title: '撤销此设备？',
                        text: `${d.displayName}\n\n设备将失去访问权限，正在等待的审批不会被自动允许。`,
                        label: '撤销配对',
                        action: { action: 'device.revoke', deviceId: d.deviceId },
                      })
                    }
                  >
                    撤销
                  </button>
                </div>
              ))
            ) : (
              <p className="empty-message">还没有配对设备。扫码后会显示在这里。</p>
            )}
          </div>
        </Modal>
      ) : panel === 'network' ? (
        <Modal
          error={visibleError}
          title="连接详情"
          description="使用可信局域网。配对证书会在平板端固定验证。"
          onClose={() => setPanel(null)}
        >
          <dl className="network-details">
            <dt>服务状态</dt>
            <dd>{title}</dd>
            <dt>当前地址</dt>
            <dd>{state.endpoint ?? '尚未就绪'}</dd>
            <dt>工作区隔离</dt>
            <dd>{state.sandboxVerified ? '已通过实际边界检查' : '尚未通过'}</dd>
            <dt>配对地址</dt>
            <dd>
              <select
                aria-label="配对网络地址"
                value={effectiveAddress}
                onChange={(e) => setAddress(e.target.value)}
              >
                {!effectiveAddress && <option value="">未找到局域网</option>}
                {state.addresses
                  .filter((a) => a !== '127.0.0.1')
                  .map((a) => (
                    <option key={a}>{a}</option>
                  ))}
              </select>
            </dd>
          </dl>
          {view.qr && (
            <div className="fingerprint">
              <span>证书 SHA-256 指纹</span>
              <code>{view.qr.fingerprint}</code>
            </div>
          )}
          <div className="modal-actions">
            <button
              className="button primary"
              disabled={!ready || !!busy || !effectiveAddress}
              onClick={() => void pair().then(() => setPanel(null))}
            >
              <QrCode size={16} />
              更新配对码
            </button>
          </div>
        </Modal>
      ) : panel === 'approvals' ? (
        <Modal
          error={visibleError}
          title="待审批"
          description="请求可能在平板上同时显示；每个请求只接受一次有效决定。"
          onClose={() => setPanel(null)}
          wide
        >
          {approval ? (
            <>
              <div className="approval-tabs">
                {approvals.map((a) => (
                  <button
                    className={a.approvalId === approval.approvalId ? 'selected' : ''}
                    key={a.approvalId}
                    onClick={() => setSelectedApproval(a.approvalId)}
                  >
                    {kind(a.method)}
                    <span>{a.sessionTitle ?? a.sessionId}</span>
                  </button>
                ))}
              </div>
              <div className="approval-meta">
                <strong>{kind(approval.method)}</strong>
                <span>{remaining(approval.expiresAt, now)} 秒后过期</span>
              </div>
              <p className="approval-session">
                会话 {approval.sessionId} / 回合 {approval.turnId}
              </p>
              <pre className="review-context">{JSON.stringify(approval.context, null, 2)}</pre>
              <div className="modal-actions">
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => confirmApproval(approval, 'reject')}
                >
                  拒绝请求
                </button>
                <button
                  className="button primary"
                  disabled={!!busy || !approval.allowedDecisions.includes('approve')}
                  onClick={() => confirmApproval(approval, 'approve')}
                >
                  检查并允许一次
                  <ArrowRight size={15} />
                </button>
              </div>
            </>
          ) : (
            <div className="approval-empty">
              <CircleCheck size={34} strokeWidth={1.4} />
              <h3>没有需要处理的审批</h3>
              <p>新的命令、文件或权限请求会在这里显示。</p>
            </div>
          )}
        </Modal>
      ) : panel === 'quit' ? (
        <Modal
          error={visibleError}
          title="停止 AgentDeck？"
          description="平板会断开连接。正在运行的任务会在下次启动时重新核实状态。"
          onClose={() => setPanel(null)}
        >
          <div className="modal-actions">
            <button className="button secondary" disabled={!!busy} onClick={() => setPanel(null)}>
              继续运行
            </button>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() => void run('quit', host.quit)}
            >
              {busy === 'quit' ? '正在安全退出…' : '停止并退出'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { Computer, Trash2, RefreshCw } from 'lucide-react';
import { IconButton } from '../ui';
import { MotionList, usePopoverMotion } from '../motion';
import { api } from '../cloud';
import type { Device } from '../workspace';

function DeleteAction({
  label,
  warning,
  path,
  onDeleted,
}: {
  label: string;
  warning: string;
  path: string;
  onDeleted?: () => void;
}) {
  const id = useId();
  const popup = usePopoverMotion();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      await api(path, { method: 'DELETE' });
      popup.current?.hidePopover();
      onDeleted?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }
  return (
    <div className="device-delete">
      <button
        className="icon-button danger"
        aria-label={label}
        title={label}
        disabled={pending}
        popoverTarget={id}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const node = popup.current;
          if (!node) return;
          setError('');
          const width = Math.min(280, window.innerWidth - 24);
          node.style.left = `${Math.max(12, Math.min(box.right - width, window.innerWidth - width - 12))}px`;
          const above = box.top - 18;
          const below = window.innerHeight - box.bottom - 18;
          const opensBelow = above < 180 && below > above;
          node.style.top = opensBelow ? `${box.bottom + 6}px` : 'auto';
          node.style.bottom = opensBelow
            ? 'auto'
            : `${Math.max(12, window.innerHeight - box.top + 6)}px`;
          node.style.maxHeight = `${Math.max(0, opensBelow ? below : above)}px`;
          node.style.transformOrigin = opensBelow ? 'top right' : 'bottom right';
        }}
      >
        <Trash2 size={16} />
      </button>
      <div
        id={id}
        ref={popup}
        popover="auto"
        className="device-delete-confirmation"
        role="dialog"
        aria-label={`确认${label}`}
      >
        <p>{warning}</p>
        <div className="compact-actions">
          <button disabled={pending} onClick={() => popup.current?.hidePopover()}>
            取消
          </button>
          <button className="danger" disabled={pending} onClick={() => void remove()}>
            {pending ? '正在删除…' : `确认${label}`}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export function DeleteDevice({ device, onDeleted }: { device: Device; onDeleted?: () => void }) {
  return (
    <DeleteAction
      label="删除设备"
      onDeleted={onDeleted}
      path={`/api/v1/devices/${encodeURIComponent(device.deviceId)}/registration`}
      warning={`删除“${device.displayName}”将关闭其连接、清除云端登记和登录凭据，需要重新登录才能再次使用。电脑本地文件和 Codex 会话会保留。`}
    />
  );
}

export function AccountDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await api<{ devices: Device[] }>('/api/v1/devices');
      setDevices(result.devices.filter((device) => device.kind === 'desktop'));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="settings-section panel-stack">
      <div className="setting-row">
        <div>
          <h3>已登记电脑</h3>
        </div>
        <IconButton
          icon={RefreshCw}
          label="刷新 Host 设备"
          pending={loading}
          onClick={() => void load()}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && !devices.length && <p className="muted">暂无 Host 设备。</p>}
      <MotionList>
        {devices.map((device) => (
          <div className="host-device-card" data-motion-item key={device.deviceId}>
            <span className="host-device-icon" aria-hidden="true">
              <Computer size={18} />
            </span>
            <div className="host-device-info">
              <strong>{device.displayName}</strong>
              <small className="muted">{device.revoked ? '已撤销' : '已登记'}</small>
            </div>
            <DeleteDevice
              device={device}
              onDeleted={() =>
                setDevices((current) => current.filter((item) => item.deviceId !== device.deviceId))
              }
            />
          </div>
        ))}
      </MotionList>
    </section>
  );
}

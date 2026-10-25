import { useState } from 'react';
import { Shield, ShieldAlert } from 'lucide-react';
import { Modal } from '../ui';

export function PermissionPicker({
  permission,
  onConfirm,
  onClose,
}: {
  permission: string;
  onConfirm: (permission: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(permission);
  return (
    <Modal title="执行权限" className="permission-modal" onClose={onClose}>
      <p className="permission-intro">选择接下来启动任务时使用的权限。</p>
      <div className="permission-options">
        {[
          {
            value: 'workspace',
            title: '工作区权限',
            description: '限制在授权工作区内修改文件，需要额外权限时请求审批。',
            icon: Shield,
          },
          {
            value: 'full',
            title: '完整访问',
            description:
              '可访问工作区外的文件和网络，执行操作时不再逐项请求审批。仅用于你信任的任务。',
            icon: ShieldAlert,
          },
        ].map(({ value, title, description, icon: Icon }) => (
          <label key={value} className="permission-option" data-selected={selected === value}>
            <Icon size={21} aria-hidden="true" />
            <span>
              <strong>{title}</strong>
              <span>{description}</span>
            </span>
            <input
              type="radio"
              name="execution-permission"
              value={value}
              checked={selected === value}
              onChange={() => setSelected(value)}
            />
          </label>
        ))}
      </div>
      <p className="permission-note">不改变正在运行的任务，实际访问范围仍受电脑端授权限制。</p>
      <div className="permission-actions">
        <button onClick={onClose}>取消</button>
        <button className="permission-confirm" onClick={() => onConfirm(selected)}>
          {selected === 'full' ? '确认使用完整访问' : '使用工作区权限'}
        </button>
      </div>
    </Modal>
  );
}

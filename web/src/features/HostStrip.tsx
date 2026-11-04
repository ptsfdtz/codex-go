import { Computer, Plus } from 'lucide-react';
import { t, useLocale } from '../i18n';
import type { Host } from '../workspace';

export function HostStrip({
  hosts,
  selected,
  onSelect,
  onManage,
}: {
  hosts: Host[];
  selected?: string;
  onSelect: (host: Host) => void;
  onManage: () => void;
}) {
  useLocale();
  return (
    <nav className="host-strip" aria-label={t('电脑')}>
      {hosts.map((host) => (
        <button
          type="button"
          key={host.hostId}
          className={`host-chip${host.hostId === selected ? ' selected' : ''}`}
          aria-current={host.hostId === selected ? 'true' : undefined}
          onClick={() => onSelect(host)}
          title={host.displayName}
        >
          <span
            className={`dot${host.online ? ' online' : ' offline'}`}
            aria-label={host.online ? t('在线') : t('离线')}
          />
          <Computer size={18} aria-hidden="true" />
          <span>{host.displayName}</span>
        </button>
      ))}
      <button type="button" className="host-chip host-manage" onClick={onManage}>
        <Plus size={18} aria-hidden="true" />
        {t('管理电脑')}
      </button>
    </nav>
  );
}

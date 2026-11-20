import { useState } from 'react';
import { t } from '../i18n';
import { cloudOrigin } from '../cloud';
import type { Host } from '../workspace';

export function HostSetup({
  host,
  connected,
  ready,
  projectCount,
}: {
  host?: Host;
  connected: boolean;
  ready?: boolean;
  projectCount: number;
}) {
  const [platform, setPlatform] = useState('windows');
  const windows = platform === 'windows';
  const operatingSystems = { windows: 'Windows x64', unix: 'macOS ARM64 / Linux x64, ARM64' };
  return (
    <section className="settings-section panel-stack">
      <h3>{t('hostSetup.title')}</h3>
      <ol className="host-setup-status">
        <li>
          {host?.online || connected
            ? t('hostSetup.online')
            : host
              ? t('hostSetup.startHost')
              : t('hostSetup.awaitSignIn')}
        </li>
        <li>
          {connected && ready === true
            ? t('hostSetup.codexReady')
            : connected && ready === false
              ? t('hostSetup.codexNotReady')
              : t('hostSetup.connectFirst')}
        </li>
        <li>
          {connected && projectCount
            ? t('hostSetup.projectsAvailable', { count: projectCount })
            : t('hostSetup.authorizeProject')}
        </li>
      </ol>
      <details open={!host}>
        <summary>{t('hostSetup.install')}</summary>
        <label>
          {t('hostSetup.platform')}{' '}
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {Object.entries(operatingSystems).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p>{t('hostSetup.terminalInstructions')}</p>
        <pre dir="ltr" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {[
            windows
              ? 'irm ' + cloudOrigin + '/install.ps1 | iex'
              : 'curl -fsSL ' + cloudOrigin + '/install.sh | sh',
            ...(windows ? [] : ['export PATH="$HOME/.local/bin:$PATH"']),
            'agentdeck login --username NAME',
            'agentdeck projects add "$PWD"',
            'agentdeck start',
            'agentdeck status --json',
          ].join('\n')}
        </pre>
        <p>{t('hostSetup.codexSignIn')}</p>
      </details>
    </section>
  );
}

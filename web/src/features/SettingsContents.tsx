import type React from 'react';
import { t, useLocale } from '../i18n';
import { Select } from '../components/Select';
import { api } from '../cloud';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { IconButton } from '../ui';
import { MotionList } from '../motion';
import { LogOut, RefreshCw } from 'lucide-react';
import { deferred } from '../deferred';
import type { Host, Project, Request } from '../workspace';
import type { HostName } from './host-names';
const DeleteDevice = deferred<React.ComponentProps<typeof import('./AccountDevices').DeleteDevice>>(
  () => import('./AccountDevices').then((module) => ({ default: module.DeleteDevice })),
);
const HostNameEditor = deferred<
  React.ComponentProps<typeof import('./HostNameEditor').HostNameEditor>
>(() => import('./HostNameEditor').then((module) => ({ default: module.HostNameEditor })));
const ProjectSettings = deferred<
  React.ComponentProps<typeof import('./project-settings/ProjectSettings').ProjectSettings>
>(() =>
  import('./project-settings/ProjectSettings').then((module) => ({
    default: module.ProjectSettings,
  })),
);
const SettingsLayout = deferred<
  React.ComponentProps<typeof import('./SettingsLayout').SettingsLayout>
>(() => import('./SettingsLayout').then((module) => ({ default: module.SettingsLayout })));
type Props = {
  settingsTab: string;
  setSettingsTab: (value: string) => void;
  theme: string;
  setTheme: (value: string) => void;
  bubbleColor: string;
  setBubbleColor: (value: string) => void;
  notification: boolean;
  setNotification: (value: boolean) => void;
  setError: (value: string) => void;
  connected: boolean;
  request: Request;
  supports: (feature: string) => boolean;
  setPanel: (value: string) => void;
  host?: Host;
  projects: Project[];
  hostName: (host: Host) => string;
  selectedProject: string;
  refresh: () => Promise<void>;
  setSelectedProject: (id: string) => void;
  selectSession: (id: string | undefined) => void;
  directoryFailure: string;
  connectionFailure: string;
  hosts: Host[];
  connect: (host: Host) => Promise<void>;
  setHosts: React.Dispatch<React.SetStateAction<Host[]>>;
  busy: boolean;
  scope: string;
  hostNameSaved: (name: HostName) => void;
};
export function SettingsContents({
  settingsTab,
  setSettingsTab,
  theme,
  setTheme,
  bubbleColor,
  setBubbleColor,
  notification,
  setNotification,
  setError,
  connected,
  request,
  supports,
  setPanel,
  host,
  projects,
  hostName,
  selectedProject,
  refresh,
  setSelectedProject,
  selectSession,
  directoryFailure,
  connectionFailure,
  hosts,
  connect,
  setHosts,
  busy,
  scope,
  hostNameSaved,
}: Props) {
  useLocale();
  return (
    <SettingsLayout active={settingsTab} onChange={setSettingsTab}>
      {settingsTab === 'general' && (
        <div className="settings-general">
          <section className="settings-section panel-stack">
            <LanguageSelect />
            <label className="setting-row">
              <span>{t('外观')}</span>
              <Select
                aria-label={t('外观')}
                value={theme}
                onValueChange={(value) => setTheme(value)}
              >
                <option value="system">{t('跟随系统')}</option>
                <option value="light">{t('浅色')}</option>
                <option value="dark">{t('深色')}</option>
              </Select>
            </label>
            <label className="setting-row">
              <span>{t('发送气泡颜色')}</span>
              <Select
                aria-label={t('发送气泡颜色')}
                value={bubbleColor}
                onValueChange={setBubbleColor}
              >
                <option value="default">{t('默认')}</option>
                <option value="blue">{t('蓝色')}</option>
                <option value="green">{t('绿色')}</option>
                <option value="purple">{t('紫色')}</option>
                <option value="gray">{t('灰色')}</option>
              </Select>
            </label>
            <label className="setting-row">
              <span>{t('系统通知')}</span>
              <input
                type="checkbox"
                checked={notification}
                disabled={!('Notification' in window)}
                onChange={async (e) => {
                  if (e.target.checked) {
                    try {
                      const result = await Notification.requestPermission();
                      setNotification(result === 'granted');
                      if (result !== 'granted')
                        setError(t('浏览器尚未允许通知，请在系统或网站设置中开启。'));
                    } catch (error) {
                      setError(String(error));
                    }
                  } else setNotification(false);
                }}
              />
            </label>
            {notification &&
              (!('Notification' in window) || Notification.permission !== 'granted') && (
                <p className="muted" role="status">
                  {t('通知偏好已保存，当前浏览器尚未允许通知；请在系统或网站设置中开启。')}
                </p>
              )}
          </section>
          <section className="settings-section setting-row">
            <div>
              <h3>{t('AgentDeck 账户')}</h3>
            </div>
            <button
              className="settings-logout"
              onClick={() =>
                void api('/api/v1/web/logout', { method: 'POST' })
                  .then(() => location.reload())
                  .catch((e) => setError(String(e)))
              }
            >
              <LogOut size={17} />
              {t('退出账户')}
            </button>
          </section>
        </div>
      )}
      {settingsTab === 'conversations' && (
        <div className="panel-stack">
          <ProjectSettings
            key={host?.hostId || 'disconnected'}
            request={request}
            projects={projects}
            connected={connected}
            hostName={host ? hostName(host) : undefined}
            currentProject={selectedProject}
            canSync={supports('codexWorkspaceDiscovery')}
            onChanged={() => refresh()}
            onProject={(id) => {
              setSelectedProject(id);
              selectSession(undefined);
              setPanel('');
            }}
          />
        </div>
      )}
      {settingsTab === 'computers' && (
        <div className="panel-stack">
          {directoryFailure && (
            <p className="error" role="status">
              {directoryFailure}
            </p>
          )}
          {connectionFailure && (
            <p className="error" role="status">
              {connectionFailure}
            </p>
          )}
          <MotionList className="computer-list">
            {hosts.map((item) => (
              <div className="computer-entry" data-motion-item key={item.hostId}>
                <button
                  className="host"
                  aria-current={item.hostId === host?.hostId ? 'true' : undefined}
                  onClick={() => {
                    void connect(item);
                  }}
                >
                  <span className={`dot ${item.online ? 'online' : ''}`} />
                  <span className="computer-name">
                    <span>{hostName(item)}</span>
                  </span>
                  <small>
                    {directoryFailure ? t('状态待刷新') : item.online ? t('在线') : t('离线')}
                  </small>
                </button>
                <div className="computer-actions">
                  {item.cloudDeviceId && (
                    <DeleteDevice
                      onDeleted={() =>
                        setHosts((current) =>
                          current.filter((entry) => entry.hostId !== item.hostId),
                        )
                      }
                      device={{
                        deviceId: item.cloudDeviceId,
                        displayName: hostName(item),
                        kind: 'desktop',
                      }}
                    />
                  )}
                  {item.hostId === host?.hostId && (
                    <IconButton
                      icon={RefreshCw}
                      label={t('重新连接')}
                      disabled={busy}
                      onClick={() => void connect(item)}
                    />
                  )}
                </div>
              </div>
            ))}
          </MotionList>
          {!hosts.length && <p>{t('尚未绑定电脑。请先在电脑端登录同一账户。')}</p>}
          {host && (
            <HostNameEditor
              key={JSON.stringify([scope, host.hostId])}
              host={hosts.find((item) => item.hostId === host.hostId) || host}
              onSaved={hostNameSaved}
            />
          )}
        </div>
      )}
    </SettingsLayout>
  );
}

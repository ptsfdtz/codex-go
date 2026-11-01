import type React from 'react';
import { t, useLocale } from '../i18n';
import { Select } from '../components/Select';
import { api } from '../cloud';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { InstallApp } from './InstallApp';
import { IconButton, DataFields } from '../ui';
import { MotionList } from '../motion';
import { LogOut, RefreshCw } from 'lucide-react';
import { deferred } from '../deferred';
import type { Host, Project, Model, Request } from '../workspace';
import type { HostName } from './host-names';
import { connectionLabels, type ConnectionState } from '../transport/reconnect';
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
const ConfigurationPanel = deferred<
  React.ComponentProps<typeof import('./Panels').ConfigurationPanel>
>(() => import('./Panels').then((module) => ({ default: module.ConfigurationPanel })));
const RetentionPanel = deferred<React.ComponentProps<typeof import('./Panels').RetentionPanel>>(
  () => import('./Panels').then((module) => ({ default: module.RetentionPanel })),
);
const DiagnosticsPanel = deferred<React.ComponentProps<typeof import('./Panels').DiagnosticsPanel>>(
  () => import('./Panels').then((module) => ({ default: module.DiagnosticsPanel })),
);
const AccountPanel = deferred<React.ComponentProps<typeof import('./Panels').AccountPanel>>(() =>
  import('./Panels').then((module) => ({ default: module.AccountPanel })),
);
const AppUpdates = deferred<Record<string, never>>(() =>
  import('./AppUpdates').then((module) => ({ default: module.AppUpdates })),
);
const SettingsLayout = deferred<
  React.ComponentProps<typeof import('./SettingsLayout').SettingsLayout>
>(() => import('./SettingsLayout').then((module) => ({ default: module.SettingsLayout })));
type Props = {
  settingsTab: string;
  setSettingsTab: (value: string) => void;
  theme: string;
  setTheme: (value: string) => void;
  notification: boolean;
  setNotification: (value: boolean) => void;
  setError: (value: string) => void;
  connected: boolean;
  request: Request;
  models: Model[];
  supports: (feature: string) => boolean;
  setFilter: (value: string) => void;
  setSidebarOpen: (value: boolean) => void;
  setPanel: (value: string) => void;
  openPanel: (value: string) => void;
  syncIndex: () => Promise<void>;
  host?: Host;
  projects: Project[];
  hostName: (host: Host) => string;
  selectedProject: string;
  refresh: () => Promise<void>;
  setSelectedProject: (id: string) => void;
  selectSession: (id: string | undefined) => void;
  directoryFailure: string;
  connectionState: ConnectionState;
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
  notification,
  setNotification,
  setError,
  connected,
  request,
  models,
  supports,
  setFilter,
  setSidebarOpen,
  setPanel,
  openPanel,
  syncIndex,
  host,
  projects,
  hostName,
  selectedProject,
  refresh,
  setSelectedProject,
  selectSession,
  directoryFailure,
  connectionState,
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
          <LanguageSelect />
          <section className="settings-section panel-stack">
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
              <span>
                {t('系统通知')}
                <small>{t('页面后台时提醒；应用内卡片和蓝点始终显示')}</small>
              </span>
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
          <section className="settings-section panel-stack">
            <h3>{t('安装应用')}</h3>
            <InstallApp />
            <p className="settings-installed">{t('已安装')}</p>
          </section>
          <section className="settings-section">
            <AppUpdates />
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
      {settingsTab === 'configuration' &&
        (connected ? (
          <ConfigurationPanel request={request} models={models} supports={supports} />
        ) : (
          <p>{t('连接电脑后查看模型与输出配置。')}</p>
        ))}
      {settingsTab === 'data' &&
        (connected ? <RetentionPanel request={request} /> : <p>{t('连接电脑后管理缓存。')}</p>)}
      {settingsTab === 'diagnostics' &&
        (connected ? <DiagnosticsPanel request={request} /> : <p>{t('连接电脑后读取诊断。')}</p>)}
      {settingsTab === 'account' &&
        (connected && supports('accountSummary') ? (
          <AccountPanel request={request} />
        ) : (
          <p>{t('连接支持账户摘要的电脑后查看。')}</p>
        ))}
      {settingsTab === 'shortcuts' && (
        <DataFields
          value={{
            'Ctrl + K': t('搜索会话'),
            'Ctrl + F': t('查找已加载消息'),
            'Alt + ← / →': t('切换上一条 / 下一条会话'),
            Enter: t('发送 / 加入队列'),
            'Shift + Enter': t('换行'),
            'Ctrl + Enter': t('发送'),
            Escape: t('关闭菜单或弹窗'),
            '/plan /goal /default': t('切换模式'),
            '/skills /mention': t('技能 / 项目文件'),
            '/queue /history /compact /new': t('队列 / 历史 / 整理 / 新对话'),
          }}
        />
      )}
      {settingsTab === 'conversations' && (
        <div className="panel-stack">
          <button
            className="settings-action"
            onClick={() => {
              setFilter('archived');
              setSidebarOpen(true);
              setPanel('');
            }}
          >
            <span>
              <strong>{t('查看归档对话')}</strong>
            </span>
          </button>
          <button className="settings-action" onClick={() => openPanel('drafts')}>
            <span>
              <strong>{t('未发送草稿')}</strong>
            </span>
          </button>
          <button
            className="settings-action"
            disabled={!connected}
            onClick={() => void syncIndex()}
          >
            <span>
              <strong>{t('同步电脑已有对话')}</strong>
            </span>
          </button>
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
          {host && (
            <p role="status">
              {t('浏览器连接：')}
              {connectionLabels[connectionState]}
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

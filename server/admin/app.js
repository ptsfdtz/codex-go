'use strict';
const renderedLabels = new Map();
const boundLabels = new Map();
const t = (key, values) => {
  const value = window.AgentDeckI18n.t(key, values);
  renderedLabels.set(value, { key, values });
  if (renderedLabels.size > 512) renderedLabels.delete(renderedLabels.keys().next().value);
  return value;
};
function labelText(node, value) {
  boundLabels.delete(node);
  node.textContent = value;
  const descriptor = renderedLabels.get(value);
  if (descriptor) boundLabels.set(node, descriptor);
}
const byId = (id) => document.getElementById(id);
let identity = null;
let tab = 'accounts';
let editing = null;
let refreshing = null;
const base = '/api/v1/admin';
function notice(message = '') {
  labelText(byId('notice'), message);
  byId('notice').hidden = !message;
}
function csrf() {
  return (
    document.cookie
      .split(';')
      .map((v) => v.trim().split('='))
      .find(([key]) => key === '__Host-agentdeck_csrf')?.[1] || ''
  );
}
function errorMessage(error) {
  return error instanceof Error ? error.message : t('操作未完成');
}
async function request(path, method = 'GET', body, retry = true) {
  const headers = { 'X-CSRF-Token': csrf() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new Error(t('无法连接服务，请检查网络后重试。'));
  }
  const result = await response.json().catch(() => ({ message: t('服务返回了无法读取的结果。') }));
  if (response.status === 401 && retry && path !== '/session' && path !== '/refresh' && csrf()) {
    if (!refreshing)
      refreshing = request('/refresh', 'POST', undefined, false).finally(() => {
        refreshing = null;
      });
    await refreshing;
    return request(path, method, body, false);
  }
  if (!response.ok) {
    if (response.status === 401) showLogin();
    throw Object.assign(new Error(result.message ? t(result.message) : t('操作未完成')), {
      status: response.status,
    });
  }
  return result;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) labelText(node, text);
  if (className) node.className = className;
  return node;
}
function button(text, action) {
  const node = element('button', text, 'secondary');
  node.type = 'button';
  node.addEventListener('click', () => perform(node, action));
  return node;
}
async function perform(node, action) {
  node.disabled = true;
  notice();
  try {
    await action();
  } catch (error) {
    notice(errorMessage(error));
  } finally {
    node.disabled = false;
  }
}
function showLogin() {
  identity = null;
  byId('login').hidden = false;
  byId('password').hidden = true;
  byId('management').hidden = true;
  byId('identity').replaceChildren();
}
function showIdentity() {
  byId('identity').replaceChildren(
    element('span', identity.username),
    button(t('修改密码'), () => showPassword()),
    button(t('退出登录'), async () => {
      await request('/session', 'DELETE');
      showLogin();
    }),
  );
}
function showPassword() {
  byId('login').hidden = true;
  byId('management').hidden = true;
  byId('password').hidden = false;
  byId('password-form').reset();
}
function showManagement() {
  byId('login').hidden = true;
  byId('password').hidden = true;
  byId('management').hidden = false;
  showIdentity();
  selectTab(tab);
}
function selectTab(value) {
  tab = value;
  for (const id of ['accounts', 'devices', 'audit']) {
    byId(id).hidden = id !== tab;
    document
      .querySelector(`[data-tab="${id}"]`)
      .setAttribute('aria-current', id === tab ? 'page' : 'false');
  }
}
function row(values, labels) {
  const tr = element('tr');
  for (const [index, value] of values.entries()) {
    const td = element('td');
    td.dataset.label = labels[index];
    if (value instanceof Node) td.append(value);
    else td.textContent = String(value);
    tr.append(td);
  }
  return tr;
}
function showSecret(name, value) {
  labelText(byId('secret-title'), t('{{p0}} 的临时密码', { p0: name }));
  byId('secret-value').textContent = value;
  byId('secret').showModal();
}
function field(name, title, value, type = 'text', limits = {}) {
  const label = element('label');
  label.append(element('span', title));
  const input = document.createElement('input');
  input.name = name;
  input.type = type;
  input.required = type !== 'checkbox';
  if (type === 'checkbox') input.checked = Boolean(value);
  else input.value = String(value);
  Object.assign(input, limits);
  label.append(input);
  return label;
}
function editor(title, fields, submit) {
  labelText(byId('editor-title'), title);
  byId('editor-fields').replaceChildren(...fields);
  editing = submit;
  byId('editor').showModal();
}
async function loadStatus() {
  const status = await request('/status');
  const c = status.connections;
  byId('status').textContent = t(
    '数据库正常 · {{p0}} 台电脑在线 · {{p1}} / {{p2}} 条连接 · 已转发 {{p3}} MiB',
    {
      p0: c.onlineHosts,
      p1: c.tunnels,
      p2: c.maxTunnels,
      p3: (c.relayedBytes / 1048576).toFixed(1),
    },
  );
}
async function loadAccounts() {
  const { accounts } = await request('/accounts');
  byId('account-rows').replaceChildren(
    ...accounts.map((account) => {
      const actions = element('div');
      actions.append(
        button(t('编辑'), () =>
          editor(
            t('编辑 {{p0}}', { p0: account.username }),
            [
              field('disabled', t('停用账户'), account.disabled, 'checkbox'),
              field('maxHosts', t('最多电脑数'), account.maxHosts, 'number', { min: 1, max: 1000 }),
              field('maxMobileDevices', t('最多移动设备数'), account.maxMobileDevices, 'number', {
                min: 1,
                max: 1000,
              }),
              field('maxTunnels', t('最多并发连接数'), account.maxTunnels, 'number', {
                min: 1,
                max: 1024,
              }),
              field(
                'bandwidth',
                t('转发速率上限（MiB/s）'),
                account.bandwidthBytesPerSecond / 1048576,
                'number',
                { min: 0.0625, max: 1024, step: 0.0625 },
              ),
            ],
            async (form) => {
              await request(`/accounts/${encodeURIComponent(account.accountId)}`, 'PUT', {
                disabled: form.get('disabled') === 'on',
                maxHosts: Number(form.get('maxHosts')),
                maxMobileDevices: Number(form.get('maxMobileDevices')),
                maxTunnels: Number(form.get('maxTunnels')),
                bandwidthBytesPerSecond: Math.round(Number(form.get('bandwidth')) * 1048576),
              });
              await loadAccounts();
            },
          ),
        ),
        button(t('重置密码'), async () => {
          if (
            !window.confirm(t('重置 {{p0}} 的密码并撤销全部登录会话？', { p0: account.username }))
          )
            return;
          const result = await request(
            `/accounts/${encodeURIComponent(account.accountId)}/reset-password`,
            'POST',
          );
          showSecret(account.username, result.temporaryPassword);
          await loadAccounts();
        }),
      );
      actions.append(
        button(t('删除用户'), async () => {
          if (
            !window.confirm(
              t(
                '永久删除用户 {{p0}} 及其全部设备和登录凭据？电脑本地文件和会话会保留，此操作无法撤销。',
                { p0: account.username },
              ),
            )
          )
            return;
          await request(`/accounts/${encodeURIComponent(account.accountId)}`, 'DELETE');
          if (account.accountId === identity.accountId) {
            showLogin();
            return;
          }
          await loadAccounts();
          await loadStatus();
        }),
      );
      const state = account.disabled
        ? t('已停用')
        : account.mustChangePassword
          ? t('待修改初始密码')
          : t('正常');
      return row(
        [
          account.username + (account.role === 'admin' ? t(' · 管理员') : ''),
          state,
          t('{{p0}} 台电脑 / {{p1}} 个移动设备 / {{p2}} 条连接', {
            p0: account.maxHosts,
            p1: account.maxMobileDevices,
            p2: account.maxTunnels,
          }),
          actions,
        ],
        [t('用户名'), t('状态'), t('设备与连接配额'), t('操作')],
      );
    }),
  );
}
function deviceActions(device) {
  const actions = element('div');
  if (!device.revoked)
    actions.append(
      button(t('撤销'), async () => {
        if (
          !window.confirm(
            t('撤销 {{p0}} 的 {{p1}} 并关闭连接？', {
              p0: device.username,
              p1: device.displayName,
            }),
          )
        )
          return;
        await request(`/devices/${encodeURIComponent(device.deviceId)}`, 'DELETE');
        await loadDevices();
        await loadStatus();
      }),
    );
  actions.append(
    button(t('删除设备'), async () => {
      if (
        !window.confirm(
          t(
            '永久删除 {{p0}} 的 {{p1}} 并关闭连接？需要重新登录才能再次使用，电脑本地文件和会话会保留。',
            { p0: device.username, p1: device.displayName },
          ),
        )
      )
        return;
      await request(`/devices/${encodeURIComponent(device.deviceId)}/registration`, 'DELETE');
      await loadDevices();
      await loadStatus();
    }),
  );
  return actions;
}
async function loadDevices() {
  const { devices } = await request('/devices');
  const kinds = { desktop: t('电脑'), mobile: t('移动设备'), adminWeb: t('管理浏览器') };
  byId('device-rows').replaceChildren(
    ...devices.map((device) =>
      row(
        [
          device.displayName,
          device.username,
          kinds[device.kind] || device.kind,
          device.revoked ? t('已撤销') : t('已登记'),
          deviceActions(device),
        ],
        [t('名称'), t('账户'), t('类型'), t('状态'), t('操作')],
      ),
    ),
  );
}
async function loadAudit() {
  const { entries } = await request('/audit');
  const names = {
    'account.created': t('创建账户'),
    'account.updated': t('修改账户与配额'),
    'account.password_changed': t('修改或重置密码'),
    'account.deleted': t('删除用户'),
    'device.deleted': t('删除设备'),
    'device.revoked': t('撤销设备'),
    'host.unbound': t('解绑电脑'),
    'session.created': t('创建登录会话'),
    'session.refresh_reused': t('阻止重复使用刷新凭据'),
  };
  byId('audit-rows').replaceChildren(
    ...entries.map((entry) =>
      row(
        [
          new Date(entry.createdAt).toLocaleString(window.AgentDeckI18n.getLocale()),
          entry.actor || t('系统或已删除账户'),
          names[entry.action] || entry.action,
          entry.subjectId || '—',
        ],
        [t('时间'), t('操作者'), t('操作'), t('目标')],
      ),
    ),
  );
}
async function load() {
  await loadStatus();
  if (tab === 'accounts') await loadAccounts();
  else if (tab === 'devices') await loadDevices();
  else await loadAudit();
}
byId('login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  perform(event.submitter, async () => {
    await request('/session', 'POST', {
      username: form.get('username'),
      password: form.get('password'),
    });
    byId('login-form').reset();
    await boot();
  });
});
byId('password-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  perform(event.submitter, async () => {
    if (form.get('newPassword') !== form.get('confirm'))
      throw new Error(t('两次输入的新密码不同。'));
    await request('/password', 'POST', {
      oldPassword: form.get('oldPassword'),
      newPassword: form.get('newPassword'),
    });
    byId('password-form').reset();
    showLogin();
    notice(t('密码已修改，请重新登录。'));
  });
});
byId('cancel-password').addEventListener('click', () => {
  if (identity?.mustChangePassword) showLogin();
  else {
    showManagement();
    load().catch((error) => notice(errorMessage(error)));
  }
});
byId('create-account').addEventListener('click', () =>
  editor(
    t('创建账户'),
    [
      field('username', t('用户名（字母、数字、点、横线或下划线）'), '', 'text', {
        maxLength: 80,
        pattern: '[A-Za-z0-9._-]+',
      }),
    ],
    async (form) => {
      const result = await request('/accounts', 'POST', { username: form.get('username') });
      showSecret(result.username, result.temporaryPassword);
      await loadAccounts();
    },
  ),
);
byId('editor-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  perform(event.submitter, async () => {
    await editing(form);
    byId('editor').close();
  });
});
byId('editor-cancel').addEventListener('click', () => byId('editor').close());
byId('secret-close').addEventListener('click', () => byId('secret').close());
byId('secret').addEventListener('close', () => {
  byId('secret-value').textContent = '';
});
byId('secret-copy').addEventListener('click', (event) =>
  perform(event.currentTarget, async () => {
    await navigator.clipboard.writeText(byId('secret-value').textContent);
  }),
);
byId('refresh').addEventListener('click', (event) => perform(event.currentTarget, load));
document.querySelectorAll('[data-tab]').forEach((node) =>
  node.addEventListener('click', () => {
    selectTab(node.dataset.tab);
    perform(node, load);
  }),
);
async function boot() {
  try {
    try {
      identity = await request('/session', 'GET', undefined, false);
    } catch (error) {
      if (!csrf()) {
        if (error.status === 401) {
          showLogin();
          notice();
          return;
        }
        throw error;
      }
      await request('/refresh', 'POST', undefined, false);
      identity = await request('/session', 'GET', undefined, false);
    }
    showIdentity();
    if (identity.mustChangePassword) showPassword();
    else {
      showManagement();
      await load();
    }
  } catch (error) {
    showLogin();
    notice(errorMessage(error));
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && identity && !identity.mustChangePassword)
    loadStatus().catch((error) => notice(errorMessage(error)));
});
setInterval(() => {
  if (!document.hidden && identity && !identity.mustChangePassword && !byId('management').hidden)
    loadStatus().catch((error) => notice(errorMessage(error)));
}, 15000);
window.addEventListener('agentdeck-languagechange', () => {
  if (identity) showIdentity();
  if (identity && !identity.mustChangePassword)
    load().catch((error) => notice(errorMessage(error)));
  for (const [node, descriptor] of boundLabels) {
    if (!node.isConnected) boundLabels.delete(node);
    else node.textContent = t(descriptor.key, descriptor.values);
  }
});
window.AgentDeckI18n.ready.then(boot).catch(() => {
  showLogin();
  notice(
    'Language resources could not be loaded. Reload to retry. / 语言资源加载失败，请刷新重试。',
  );
});

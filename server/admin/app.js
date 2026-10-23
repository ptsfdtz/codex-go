'use strict';
const byId = (id) => document.getElementById(id);
let identity = null;
let tab = 'accounts';
let editing = null;
let refreshing = null;
const base = '/api/v1/admin';
function notice(message = '') {
  byId('notice').textContent = message;
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
  return error instanceof Error ? error.message : '操作未完成';
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
    throw new Error('无法连接服务，请检查网络后重试。');
  }
  const result = await response.json().catch(() => ({ message: '服务返回了无法读取的结果。' }));
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
    throw Object.assign(new Error(result.message || '操作未完成'), { status: response.status });
  }
  return result;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
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
    button('修改密码', () => showPassword()),
    button('退出登录', async () => {
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
  byId('secret-title').textContent = `${name} 的临时密码`;
  byId('secret-value').textContent = value;
  byId('secret').showModal();
}
function field(name, title, value, type = 'text', limits = {}) {
  const label = element('label', title);
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
  byId('editor-title').textContent = title;
  byId('editor-fields').replaceChildren(...fields);
  editing = submit;
  byId('editor').showModal();
}
async function loadStatus() {
  const status = await request('/status');
  const c = status.connections;
  byId('status').textContent =
    `数据库正常 · ${c.onlineHosts} 台电脑在线 · ${c.tunnels} / ${c.maxTunnels} 条连接 · 已转发 ${(c.relayedBytes / 1048576).toFixed(1)} MiB`;
}
async function loadAccounts() {
  const { accounts } = await request('/accounts');
  byId('account-rows').replaceChildren(
    ...accounts.map((account) => {
      const actions = element('div');
      actions.append(
        button('编辑', () =>
          editor(
            `编辑 ${account.username}`,
            [
              field('disabled', '停用账户', account.disabled, 'checkbox'),
              field('maxHosts', '最多电脑数', account.maxHosts, 'number', { min: 1, max: 1000 }),
              field('maxMobileDevices', '最多移动设备数', account.maxMobileDevices, 'number', {
                min: 1,
                max: 1000,
              }),
              field('maxTunnels', '最多并发连接数', account.maxTunnels, 'number', {
                min: 1,
                max: 1024,
              }),
              field(
                'bandwidth',
                '转发速率上限（MiB/s）',
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
        button('重置密码', async () => {
          if (!window.confirm(`重置 ${account.username} 的密码并撤销全部登录会话？`)) return;
          const result = await request(
            `/accounts/${encodeURIComponent(account.accountId)}/reset-password`,
            'POST',
          );
          showSecret(account.username, result.temporaryPassword);
          await loadAccounts();
        }),
      );
      const state = account.disabled
        ? '已停用'
        : account.mustChangePassword
          ? '待修改初始密码'
          : '正常';
      return row(
        [
          account.username + (account.role === 'admin' ? ' · 管理员' : ''),
          state,
          `${account.maxHosts} 台电脑 / ${account.maxMobileDevices} 个移动设备 / ${account.maxTunnels} 条连接`,
          actions,
        ],
        ['用户名', '状态', '设备与连接配额', '操作'],
      );
    }),
  );
}
async function loadDevices() {
  const { devices } = await request('/devices');
  const kinds = { desktop: '电脑', mobile: '移动设备', adminWeb: '管理浏览器' };
  byId('device-rows').replaceChildren(
    ...devices.map((device) =>
      row(
        [
          device.displayName,
          device.username,
          kinds[device.kind] || device.kind,
          device.revoked ? '已撤销' : '已登记',
          device.revoked
            ? '—'
            : button('撤销', async () => {
                if (
                  !window.confirm(
                    `撤销 ${device.username} 的 ${device.displayName} 并关闭对应公网连接？`,
                  )
                )
                  return;
                await request(`/devices/${encodeURIComponent(device.deviceId)}`, 'DELETE');
                await loadDevices();
                await loadStatus();
              }),
        ],
        ['名称', '账户', '类型', '状态', '操作'],
      ),
    ),
  );
}
async function loadAudit() {
  const { entries } = await request('/audit');
  const names = {
    'account.created': '创建账户',
    'account.updated': '修改账户与配额',
    'account.password_changed': '修改或重置密码',
    'device.revoked': '撤销设备',
    'host.unbound': '解绑电脑',
    'session.created': '创建登录会话',
    'session.refresh_reused': '阻止重复使用刷新凭据',
  };
  byId('audit-rows').replaceChildren(
    ...entries.map((entry) =>
      row(
        [
          new Date(entry.createdAt).toLocaleString(),
          entry.actor || '服务器管理员',
          names[entry.action] || entry.action,
          entry.subjectId || '—',
        ],
        ['时间', '操作者', '操作', '目标'],
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
    if (form.get('newPassword') !== form.get('confirm')) throw new Error('两次输入的新密码不同。');
    await request('/password', 'POST', {
      oldPassword: form.get('oldPassword'),
      newPassword: form.get('newPassword'),
    });
    byId('password-form').reset();
    showLogin();
    notice('密码已修改，请重新登录。');
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
    '创建账户',
    [
      field('username', '用户名（字母、数字、点、横线或下划线）', '', 'text', {
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
boot();

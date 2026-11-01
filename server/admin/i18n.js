/* global localStorage, Event */
'use strict';
window.AgentDeckI18n = (() => {
  const key = 'agentdeck.language';
  const valid = (value) => ['system', 'zh-CN', 'en'].includes(value);
  const read = () => {
    try {
      const value = localStorage.getItem(key);
      return valid(value) ? value : 'system';
    } catch {
      return 'system';
    }
  };
  let preference = read();
  let locale, catalogs;
  const resolve = () =>
    preference === 'system'
      ? /^zh(?:-|$)/i.test(navigator.languages?.[0] || navigator.language)
        ? 'zh-CN'
        : 'en'
      : preference;
  const t = (message, values = {}) =>
    (catalogs?.[locale]?.[message] || message).replace(/\{\{(\w+)\}\}/g, (match, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : match,
    );
  const apply = () => {
    locale = resolve();
    document.documentElement.lang = locale;
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
      node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
    });
    const select = document.getElementById('language');
    select.value = preference;
    select.setAttribute('aria-label', t('language.label'));
    select.querySelector('[value="system"]').textContent = t('跟随系统');
  };
  const change = () => {
    apply();
    window.dispatchEvent(new Event('agentdeck-languagechange'));
  };
  const ready = Promise.all(
    ['en', 'zh-CN'].map(async (lang) => {
      const response = await fetch(`/admin/locales/${lang}.json`, {
        cache: 'no-cache',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('Cannot load language resources');
      return [lang, await response.json()];
    }),
  ).then((entries) => {
    catalogs = Object.fromEntries(entries);
    apply();
  });
  document.getElementById('language').addEventListener('change', (event) => {
    preference = valid(event.target.value) ? event.target.value : 'system';
    try {
      localStorage.setItem(key, preference);
    } catch {
      /* In-page preference works. */
    }
    change();
  });
  window.addEventListener('languagechange', () => {
    if (preference === 'system') change();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) {
      preference = read();
      change();
    }
  });
  return { ready, t, getLocale: () => locale };
})();

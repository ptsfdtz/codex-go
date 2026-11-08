import { useSyncExternalStore } from 'react';
import en from './en.json';
import zhCN from './zh-CN.json';

// Source-language messages already use their text as keys. Reuse the English
// catalog's complete key set instead of shipping the same Chinese strings twice.
// The build retains only non-identity translations in the Chinese JSON module.
const chinese = { ...Object.fromEntries(Object.keys(en).map((key) => [key, key])), ...zhCN };

export type LanguagePreference = 'system' | 'zh-CN' | 'en';
export type Locale = 'zh-CN' | 'en';
export const languageStorageKey = 'agentdeck.language';
const valid = (value: unknown): value is LanguagePreference =>
  value === 'system' || value === 'zh-CN' || value === 'en';
function readPreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(languageStorageKey);
    return valid(value) ? value : 'system';
  } catch {
    return 'system';
  }
}
let preference = readPreference();
const resolve = (): Locale =>
  preference === 'system'
    ? /^zh(?:-|$)/i.test(
        typeof navigator === 'undefined' ? 'en' : navigator.languages?.[0] || navigator.language,
      )
      ? 'zh-CN'
      : 'en'
    : preference;
let locale = resolve();
const plurals = { en: new Intl.PluralRules('en'), 'zh-CN': new Intl.PluralRules('zh-CN') };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => `${preference}:${locale}`;
export function useLocale() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return locale;
}
export const getLocale = (): Locale => locale;
export const getLanguagePreference = () => preference;
export function t(key: string, values?: Record<string, unknown>): string {
  const catalog: Record<string, string> = locale === 'en' ? en : chinese;
  const fallback: Record<string, string> = en;
  if (typeof values?.count === 'number') {
    const suffix =
      values.count === 0 && Object.hasOwn(catalog, `${key}_zero`)
        ? 'zero'
        : plurals[locale].select(values.count);
    if (Object.hasOwn(catalog, `${key}_${suffix}`)) key = `${key}_${suffix}`;
  }
  const template = Object.hasOwn(catalog, key)
    ? catalog[key]!
    : Object.hasOwn(fallback, key)
      ? fallback[key]!
      : key;
  // Catalogs intentionally support literal keys and {{name}} only. Replacement
  // is one pass: user values cannot introduce nested translations or markup.
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    values && Object.hasOwn(values, name) ? String(values[name] ?? '') : placeholder,
  );
}
function apply() {
  locale = resolve();
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
  // The manifest URL changes while its app identity and start URL stay stable.
  document
    .querySelector('link[rel="manifest"]')
    ?.setAttribute(
      'href',
      `${import.meta.env.BASE_URL}manifest${locale === 'en' ? '.en' : ''}.webmanifest`,
    );
  for (const listener of listeners) listener();
}
export function setLanguagePreference(value: LanguagePreference) {
  if (!valid(value)) return;
  preference = value;
  try {
    localStorage.setItem(languageStorageKey, value);
  } catch {
    /* In-page switching still works. */
  }
  apply();
}
if (typeof window !== 'undefined')
  window.addEventListener('languagechange', () => {
    if (preference === 'system') apply();
  });
if (typeof window !== 'undefined')
  window.addEventListener('storage', (event) => {
    if (event.key === languageStorageKey || event.key === null) {
      preference = readPreference();
      apply();
    }
  });
apply();

// Only apply to application error fields. Conversation text, filenames and API/model
// identifiers are rendered verbatim. Retain upstream/OS diagnostics when unknown.
const catalogs: Record<string, string>[] = [en, chinese];
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = catalogs.flatMap((catalog) =>
  Object.entries(catalog).map(([key, value]) => {
    const names: string[] = [];
    const parts = value.split(/(\{\{\w+\}\})/);
    if (parts.length === 1) return { key, value };
    const pattern = parts
      .map((part) => {
        if (!part.startsWith('{{')) return escapePattern(part);
        names.push(part.slice(2, -2));
        return '([\\s\\S]*?)';
      })
      .join('');
    return { key, value, names, regex: new RegExp(`^${pattern}$`) };
  }),
);
export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/^Error: /, '');
  const coded = /^([A-Z][A-Z_0-9]+): ([\s\S]*)$/.exec(message);
  if (coded) return `${coded[1]}: ${errorText(coded[2])}`;
  for (const pattern of patterns) {
    if (pattern.value === message) return t(pattern.key);
  }
  for (const pattern of patterns) {
    if (!pattern.regex || !pattern.names) continue;
    const match = pattern.regex.exec(message);
    if (match)
      return t(
        pattern.key,
        Object.fromEntries(pattern.names.map((name, i) => [name, match[i + 1]])),
      );
  }
  return message;
}

import i18next from 'i18next';
import { useSyncExternalStore } from 'react';
import en from './en.json';
import zhCN from './zh-CN.json';

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
const instance = i18next.createInstance();
void instance.init({
  lng: locale,
  fallbackLng: 'en',
  supportedLngs: ['zh-CN', 'en'],
  resources: { en: { translation: en }, 'zh-CN': { translation: zhCN } },
  initAsync: false,
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});
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
  return String(instance.t(key, values || {}));
}
function apply() {
  locale = resolve();
  void instance.changeLanguage(locale);
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
const catalogs: Record<string, string>[] = [en, zhCN];
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

import en from './en/index.ts';
import zhCN from './zh-CN/index.ts';

export type TranslationKey = keyof typeof en;
export const translations = { en, 'zh-CN': zhCN } satisfies Record<
  string,
  Record<TranslationKey, string>
>;
export type Locale = keyof typeof translations;

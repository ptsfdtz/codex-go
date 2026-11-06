import { Select } from '../components/Select';
import { Languages } from 'lucide-react';
import {
  getLanguagePreference,
  setLanguagePreference,
  t,
  useLocale,
  type LanguagePreference,
} from './index';

export function LanguageSelect({ iconOnly = false }: { iconOnly?: boolean }) {
  useLocale();
  const select = (
    <Select
      aria-label={t('language.label')}
      title={iconOnly ? t('language.label') : undefined}
      triggerIcon={
        iconOnly ? <Languages size={19} strokeWidth={1.6} aria-hidden="true" /> : undefined
      }
      value={getLanguagePreference()}
      onValueChange={(value) => setLanguagePreference(value as LanguagePreference)}
    >
      <option value="system">{t('跟随系统')}</option>
      <option value="zh-CN">简体中文</option>
      <option value="en">English</option>
    </Select>
  );
  if (iconOnly) return select;
  return (
    <label className="setting-row language-setting">
      <span>{t('language.label')}</span>
      {select}
    </label>
  );
}

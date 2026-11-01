import { Select } from '../components/Select';
import {
  getLanguagePreference,
  setLanguagePreference,
  t,
  useLocale,
  type LanguagePreference,
} from './index';

export function LanguageSelect() {
  useLocale();
  return (
    <label className="setting-row language-setting">
      <span>{t('language.label')}</span>
      <Select
        aria-label={t('language.label')}
        value={getLanguagePreference()}
        onValueChange={(value) => setLanguagePreference(value as LanguagePreference)}
      >
        <option value="system">{t('跟随系统')}</option>
        <option value="zh-CN">简体中文</option>
        <option value="en">English</option>
      </Select>
    </label>
  );
}

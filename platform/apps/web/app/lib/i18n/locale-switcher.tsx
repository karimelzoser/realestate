'use client';

import { useI18n } from './provider';

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const next = locale === 'en' ? 'ar' : 'en';
  return (
    <button
      className="locale-switcher"
      type="button"
      onClick={() => setLocale(next)}
      aria-label={next === 'ar' ? t('language.switchToArabic') : t('language.switchToEnglish')}
    >
      {next === 'ar' ? t('language.switchToArabic') : t('language.switchToEnglish')}
    </button>
  );
}

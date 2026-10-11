export const SUPPORTED_LOCALES = ['en', 'ar'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type AppDirection = 'ltr' | 'rtl';

export const DEFAULT_LOCALE: AppLocale = 'en';
export const LOCALE_STORAGE_KEY = 'preneura.locale';
export const EGYPT_TIME_ZONE = 'Africa/Cairo';
export const EGYPT_CURRENCY = 'EGP';

const localeConfig: Record<
  AppLocale,
  Readonly<{ intlLocale: 'en-EG' | 'ar-EG'; direction: AppDirection }>
> = {
  en: { intlLocale: 'en-EG', direction: 'ltr' },
  ar: { intlLocale: 'ar-EG', direction: 'rtl' },
};

const arabicIndicDigits = '٠١٢٣٤٥٦٧٨٩';
const easternArabicDigits = '۰۱۲۳۴۵۶۷۸۹';

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as AppLocale);
}

export function normalizeLocale(value: unknown): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_LOCALE;
}

export function getLocaleDirection(locale: AppLocale): AppDirection {
  return localeConfig[locale].direction;
}

export function getIntlLocale(locale: AppLocale): 'en-EG' | 'ar-EG' {
  return localeConfig[locale].intlLocale;
}

export function normalizeLocalizedDigits(value: string): string {
  let normalized = '';
  for (const character of value) {
    const arabicIndicIndex = arabicIndicDigits.indexOf(character);
    if (arabicIndicIndex >= 0) {
      normalized += String(arabicIndicIndex);
      continue;
    }
    const easternArabicIndex = easternArabicDigits.indexOf(character);
    if (easternArabicIndex >= 0) {
      normalized += String(easternArabicIndex);
      continue;
    }
    normalized += character;
  }
  return normalized;
}

export function formatEgp(
  value: number | bigint,
  locale: AppLocale,
  options: Omit<Intl.NumberFormatOptions, 'style' | 'currency'> = {},
): string {
  return new Intl.NumberFormat(getIntlLocale(locale), {
    style: 'currency',
    currency: EGYPT_CURRENCY,
    currencyDisplay: 'symbol',
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

export function formatEgyptNumber(
  value: number | bigint,
  locale: AppLocale,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(getIntlLocale(locale), options).format(value);
}

export function formatCairoDateTime(
  value: Date | string | number,
  locale: AppLocale,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: EGYPT_TIME_ZONE,
    ...options,
  }).format(date);
}

export function formatCairoDate(
  value: Date | string | number,
  locale: AppLocale,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: 'medium',
    timeZone: EGYPT_TIME_ZONE,
    ...options,
  }).format(date);
}

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

/** Display immutable decimal money without losing precision through a float. */
export function formatDecimalCurrency(value: string, currency: string, locale: AppLocale): string {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value) || !/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid money display value.');
  const [whole = '0', fraction = ''] = value.split('.');
  const integer = BigInt(whole);
  const negativeZero = value.startsWith('-') && integer === 0n;
  const formatter = new Intl.NumberFormat(getIntlLocale(locale), { style: 'currency', currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const digitFormatter = new Intl.NumberFormat(getIntlLocale(locale), { useGrouping: false });
  const digits = `${fraction}00`.slice(0, 2).split('').map((digit) => digitFormatter.format(Number(digit))).join('');
  return formatter.formatToParts(negativeZero ? -1n : integer).map((part) => {
    if (part.type === 'fraction') return digits;
    if (negativeZero && part.type === 'integer') return digitFormatter.format(0);
    return part.value;
  }).join('');
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

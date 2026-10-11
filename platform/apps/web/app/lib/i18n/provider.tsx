'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  localeCookieName,
  localeDirection,
  localeTag,
  messages,
  parseLocale,
  type Locale,
  type TranslationKey,
} from './catalog';

type I18nContextValue = {
  locale: Locale;
  direction: 'ltr' | 'rtl';
  t(key: TranslationKey): string;
  setLocale(locale: Locale): void;
  formatMoney(value: string | number | null, currency: string): string;
  formatDateTime(value: string | Date): string;
  formatNumber(value: string | number): string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => parseLocale(initialLocale));
  const direction = localeDirection(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [direction, locale]);

  const setLocale = useCallback((next: Locale) => {
    document.cookie = `${localeCookieName}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setLocaleState(next);
    document.documentElement.lang = next;
    document.documentElement.dir = localeDirection(next);
  }, []);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    direction,
    t: (key) => messages[locale][key],
    setLocale,
    formatMoney: (amount, currency) => {
      if (amount === null) return messages[locale]['common.none'];
      return new Intl.NumberFormat(localeTag(locale), {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(Number(amount));
    },
    formatDateTime: (date) => new Intl.DateTimeFormat(localeTag(locale), {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(typeof date === 'string' ? new Date(date) : date),
    formatNumber: (number) => new Intl.NumberFormat(localeTag(locale)).format(Number(number)),
  }), [direction, locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider.');
  return context;
}

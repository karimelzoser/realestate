'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  formatCairoDate,
  formatCairoDateTime,
  formatEgp,
  formatDecimalCurrency,
  formatEgyptNumber,
  getLocaleDirection,
  isAppLocale,
  type AppLocale,
} from '../lib/locale';

interface LocaleContextValue {
  locale: AppLocale;
  direction: 'ltr' | 'rtl';
  setLocale: (locale: AppLocale) => void;
  formatCurrency: (value: number | bigint) => string;
  formatAmount: (value: string, currency: string) => string;
  formatNumber: (value: number | bigint, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | string | number) => string;
  formatDateTime: (value: Date | string | number) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function synchronizeDocument(locale: AppLocale): void {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = getLocaleDirection(locale);
  root.dataset.locale = locale;
  root.dataset.localeReady = 'true';
}

export function LocaleProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [locale, setLocaleState] = useState<AppLocale>(DEFAULT_LOCALE);

  const persistLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale);
    synchronizeDocument(nextLocale);
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale); } catch { /* Locale still works when storage is unavailable. */ }
  }, []);

  useEffect(() => {
    let storedLocale: string | null = null;
    try { storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY); } catch { /* Use the in-memory/default locale. */ }
    const initialLocale = isAppLocale(storedLocale) ? storedLocale : DEFAULT_LOCALE;
    setLocaleState(initialLocale);
    synchronizeDocument(initialLocale);
  }, []);

  const direction = getLocaleDirection(locale);
  const contextValue = useMemo<LocaleContextValue>(
    () => ({
      locale,
      direction,
      setLocale: persistLocale,
      formatCurrency: (value) => formatEgp(value, locale),
      formatAmount: (value, currency) => formatDecimalCurrency(value, currency, locale),
      formatNumber: (value, options) => formatEgyptNumber(value, locale, options),
      formatDate: (value) => formatCairoDate(value, locale),
      formatDateTime: (value) => formatCairoDateTime(value, locale),
    }),
    [direction, locale, persistLocale],
  );

  return (
    <LocaleContext.Provider value={contextValue}>
      <div className="locale-switcher" role="group" aria-label="Language">
        <button
          type="button"
          className={locale === 'en' ? 'locale-switcher__button is-active' : 'locale-switcher__button'}
          aria-pressed={locale === 'en'}
          onClick={() => persistLocale('en')}
        >
          English
        </button>
        <button
          type="button"
          className={locale === 'ar' ? 'locale-switcher__button is-active' : 'locale-switcher__button'}
          aria-pressed={locale === 'ar'}
          onClick={() => persistLocale('ar')}
        >
          العربية
        </button>
      </div>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used inside LocaleProvider.');
  }
  return context;
}

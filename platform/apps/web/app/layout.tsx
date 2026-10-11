import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';
import { localeCookieName, localeDirection, parseLocale } from './lib/i18n/catalog';
import { LocaleSwitcher } from './lib/i18n/locale-switcher';
import { I18nProvider } from './lib/i18n/provider';

export const metadata: Metadata = {
  title: 'PRENEURA Real Estate OS',
  description: 'Secure real-estate operations, allocation and transaction platform.',
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get(localeCookieName)?.value);
  const direction = localeDirection(locale);

  return (
    <html lang={locale} dir={direction}>
      <body>
        <I18nProvider initialLocale={locale}>
          <LocaleSwitcher />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}

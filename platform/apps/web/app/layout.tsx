import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LocaleProvider } from './locale-provider';
import './globals.css';
import './locale.css';

export const metadata: Metadata = {
  title: 'PRENEURA Real Estate OS',
  description: 'Secure real-estate operations, allocation and transaction platform.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}

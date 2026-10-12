import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LocaleProvider } from './locale-provider';
import PublicTestNotice from './public-test-notice';
import './globals.css';
import './locale.css';

export const metadata: Metadata = {
  title: 'PRENEURA Real Estate OS',
  description: 'Secure real-estate operations, allocation and transaction platform.',
  ...(process.env.NEXT_PUBLIC_APP_ENV==='public-test'?{robots:{index:false,follow:false}}:{}),
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body>
        <LocaleProvider><PublicTestNotice />{children}</LocaleProvider>
      </body>
    </html>
  );
}

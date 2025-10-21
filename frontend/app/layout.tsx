import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Amplify } from 'aws-amplify';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import '@aws-amplify/ui-react/styles.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AWS Cost Guardian',
  description: 'Automate AWS refunds',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </body>
    </html>
  );
}
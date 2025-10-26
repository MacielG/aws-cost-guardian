import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import '@aws-amplify/ui-react/styles.css';
import ConfigureAmplifyClientSide from '../components/ConfigureAmplifyClientSide';
import { I18nClientProvider } from '@/components/I18nClientProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AWS Cost Guardian',
  description: 'Automate AWS refunds',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ConfigureAmplifyClientSide />
        <I18nClientProvider>{children}</I18nClientProvider>
      </body>
    </html>
  );
}
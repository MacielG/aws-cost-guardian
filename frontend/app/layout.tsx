import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import '@aws-amplify/ui-react/styles.css';
import ConfigureAmplifyClientSide from '../components/ConfigureAmplifyClientSide';
import { ToasterProvider } from '../components/ui/toaster';
import { I18nClientProvider } from '@/components/I18nClientProvider';
import { AuthProvider } from '@/components/auth/AuthProvider';
import AuthLayoutClient from '@/components/layout/AuthLayoutClient';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AWS Cost Guardian',
  description: 'Automate AWS refunds',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        <ToasterProvider>
          <ConfigureAmplifyClientSide />
          <AuthProvider>
            <I18nClientProvider>
              <AuthLayoutClient>{children}</AuthLayoutClient>
            </I18nClientProvider>
          </AuthProvider>
        </ToasterProvider>
      </body>
    </html>
  );
}
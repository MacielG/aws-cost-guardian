import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import '@aws-amplify/ui-react/styles.css';
import ConfigureAmplifyClientSide from '../components/ConfigureAmplifyClientSide';
import { ToasterProvider } from '../components/ui/toaster';
import { I18nClientProvider } from '@/components/I18nClientProvider';
import { AuthProvider } from '@/components/auth/AuthProvider';
import AppLayout from '@/components/layout/AppLayout';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AWS Cost Guardian',
  description: 'Automate AWS refunds',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ToasterProvider>
          <ConfigureAmplifyClientSide />
          <AuthProvider>
            <I18nClientProvider>
              <AppLayout>{children}</AppLayout>
            </I18nClientProvider>
          </AuthProvider>
        </ToasterProvider>
      </body>
    </html>
  );
}
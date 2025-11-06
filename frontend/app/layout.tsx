import type { Metadata } from 'next';
import './globals.css';
import '@aws-amplify/ui-react/styles.css';
import { Authenticator } from '@aws-amplify/ui-react';
import ConfigureAmplifyClientSide from '../components/ConfigureAmplifyClientSide';
import { ToasterProvider } from '../components/ui/toaster';
import { Toaster } from 'sonner';
import { I18nClientProvider } from '@/components/I18nClientProvider';
import { AuthProvider } from '@/components/auth/AuthProvider';
import AuthLayoutClient from '@/components/layout/AuthLayoutClient';
import { ThemeProvider } from '@/components/ThemeProvider';

// A fonte JetBrains Mono será aplicada globalmente via globals.css
// const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AWS Cost Guardian',
  description: 'Automated FinOps Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <ToasterProvider>
            <Toaster />
            <ConfigureAmplifyClientSide />
            <Authenticator.Provider>
              <AuthProvider>
                <I18nClientProvider>
                  <AuthLayoutClient>{children}</AuthLayoutClient>
                </I18nClientProvider>
              </AuthProvider>
            </Authenticator.Provider>
          </ToasterProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
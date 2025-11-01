'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { usePathname } from 'next/navigation';
import Header from './Header';
import Sidebar from './Sidebar';

interface AppLayoutProps {
  children: React.ReactNode;
}

// Páginas que NÃO devem ter Header e Sidebar
const PUBLIC_PAGES = ['/login', '/terms', '/trial'];

export default function AppLayout({ children }: AppLayoutProps) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  // Verificar se é uma página pública
  const isPublicPage = PUBLIC_PAGES.some(page => pathname.startsWith(page));

  // Se estiver carregando, mostrar loading (opcional)
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Carregando...</p>
        </div>
      </div>
    );
  }

  // Se for página pública ou usuário não logado, não mostrar layout
  if (isPublicPage || !user) {
    return <>{children}</>;
  }

  // Layout completo para páginas autenticadas
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="flex">
        <Sidebar />
        {/* Main content area */}
        <main className="flex-1 lg:ml-64 pt-4">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

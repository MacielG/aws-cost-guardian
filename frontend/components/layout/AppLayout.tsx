'use client';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
// Importe seu componente de spinner
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // 1. Obter 'isLoadingAuth'
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // 2. Apenas redirecione se o carregamento terminou
    if (!isLoadingAuth && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoadingAuth, isAuthenticated, router]); // Adicionar 'isLoadingAuth' à dependência

  // 3. IMPLEMENTAR GUARDA DE CARREGAMENTO
  //    Enquanto 'isLoadingAuth' for true, mostre um loader.
  //    Isso impede que {children} (ex: a página Dashboard) seja renderizado
  //    e tente fazer chamadas de API cedo demais.
  if (isLoadingAuth) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <LoadingSpinner className="h-10 w-10" />
      </div>
    );
  }

  // 4. Renderize o layout completo APENAS se o carregamento terminou
  //    E o usuário está autenticado.
  if (isAuthenticated) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Header />
          <div className="p-4 md:p-8">{children}</div>
        </main>
      </div>
    );
  }

  // Se não estiver carregando e não autenticado, retorna null
  // enquanto o redirect do useEffect é processado.
  return null;
}

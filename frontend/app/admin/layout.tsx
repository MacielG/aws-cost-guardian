'use client';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoadingAuth } = useAuth();
  const router = useRouter();

  const userGroups = user?.['cognito:groups'] || [];
  const isAdmin = userGroups.includes('Admins');

  useEffect(() => {
    if (isLoadingAuth) {
      return; // Espere a autenticação terminar
    }

    if (!isAdmin) {
      // Se não for admin, expulse-o para o dashboard do cliente
      router.replace('/dashboard');
    }
  }, [isLoadingAuth, isAdmin, router]);

  // Mostra loading enquanto verifica
  if (isLoadingAuth || !isAdmin) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Renderiza o layout de admin se a verificação passar
  return (
    <div>
      <h1>Layout Seguro do Admin</h1>
      {children}
    </div>
  );
}

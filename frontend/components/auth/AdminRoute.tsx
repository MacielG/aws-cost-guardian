'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoadingAuth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoadingAuth) {
      if (!user) {
        router.push('/login');
      } else if (!user['cognito:groups']?.includes('Admins')) {
        router.push('/dashboard'); // Redirecionar para dashboard se não for admin
      }
    }
  }, [user, isLoadingAuth, router]);

  if (isLoadingAuth) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!user['cognito:groups']?.includes('Admins')) {
    return null; // Não renderizar se não for admin
  }

  return <>{children}</>;
}

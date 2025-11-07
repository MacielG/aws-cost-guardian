'use client';

import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authStatus } = useAuthenticator(context => [context.authStatus]);
  const mode = searchParams.get('mode');

  useEffect(() => {
    if (authStatus === 'authenticated') {
      checkUserRoleAndRedirect();
    }
  }, [authStatus, router, mode]);

  const checkUserRoleAndRedirect = async () => {
    try {
      // Force refresh para garantir que o token inclui grupos atualizados
      const session = await fetchAuthSession({ forceRefresh: true });
      const groups = session.tokens?.accessToken?.payload['cognito:groups'] as string[] | undefined;
      const isAdmin = groups?.includes('Admins');

      if (isAdmin) {
        // Admin vai direto para dashboard admin
        router.push('/admin');
      } else if (mode === 'trial') {
        // Usuário trial vai para onboarding
        router.push('/onboard?mode=trial');
      } else {
        // Usuário normal vai para dashboard
        router.push('/dashboard');
      }
    } catch (error) {
      console.error('Erro ao verificar grupos do usuário:', error);
      // Fallback: redireciona para dashboard
      router.push('/dashboard');
    }
  };

return (
<div className="min-h-screen flex items-center justify-center bg-background p-4">
<div className="w-full max-w-md">
<Authenticator
  signUpAttributes={['email']}
    components={{
        Header: () => (
          <div className="text-center mb-8">
                <h1 className="text-2xl font-bold">AWS Cost Guardian</h1>
                <p className="text-muted-foreground">Automate AWS refunds</p>
              </div>
            ),
          }}
        />
      </div>
    </div>
  );
}

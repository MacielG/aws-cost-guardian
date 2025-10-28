'use client';

import { Authenticator } from '@aws-amplify/ui-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useEffect } from 'react';

export default function LoginPage() {
const router = useRouter();
const searchParams = useSearchParams();
  const { user } = useAuth();
const mode = searchParams.get('mode');

useEffect(() => {
  if (user) {
      if (mode === 'trial') {
        router.push('/onboard?mode=trial');
    } else {
    router.push('/dashboard');
}
}
}, [user, router, mode]);

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

'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { getCurrentUser, fetchAuthSession, signOut as amplifySignOut, FetchUserAttributesOutput } from 'aws-amplify/auth';

interface AuthenticatedUser {
  username: string;
  userId: string;
  email?: string;
  'cognito:groups'?: string[];
}

interface AuthContextType {
  user: AuthenticatedUser | null;
  session: FetchUserAttributesOutput | null;
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [session, setSession] = useState<FetchUserAttributesOutput | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const loadUser = async () => {
    setIsLoadingAuth(true);
    try {
      const currentUser = await getCurrentUser();
      const sessionData = await fetchAuthSession();

      if (!sessionData.tokens?.idToken) {
        console.warn('Sessão sem token válido');
        setUser(null);
        setSession(null);
        return;
      }

      setUser({
        username: currentUser.username,
        userId: currentUser.userId,
        email: sessionData.tokens?.idToken?.payload?.email as string | undefined,
        'cognito:groups': sessionData.tokens?.idToken?.payload?.['cognito:groups'] as string[] | undefined,
      });
      setSession(sessionData);
    } catch (err: any) {
      console.warn('Erro ao carregar usuário:', err?.message || err);

      if (err?.name === 'InvalidCharacterError' || err?.message?.includes('token')) {
        if (typeof window !== 'undefined') {
          localStorage.clear();
          sessionStorage.clear();
        }
      }

      setUser(null);
      setSession(null);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  useEffect(() => {
    loadUser();
  }, []);

  const signOut = async () => {
    try {
      await amplifySignOut();
      setUser(null);
      setSession(null);

      if (typeof window !== 'undefined') {
        localStorage.clear();
        sessionStorage.clear();
      }
    } catch (err) {
      console.error('Erro ao fazer logout:', err);

      if (typeof window !== 'undefined') {
        localStorage.clear();
        sessionStorage.clear();
      }

      setUser(null);
      setSession(null);
    }
  };

  const refreshUser = async () => {
    await loadUser();
  };

  const value = { user, session, isAuthenticated: !!user, isLoadingAuth, signOut, refreshUser };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

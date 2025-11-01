'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { getCurrentUser, fetchAuthSession, signOut as amplifySignOut } from 'aws-amplify/auth';

interface User {
  username: string;
  userId: string;
  email?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = async () => {
    try {
      const currentUser = await getCurrentUser();
      const session = await fetchAuthSession();
      
      if (!session.tokens?.idToken) {
        console.warn('Sessão sem token válido');
        setUser(null);
        setLoading(false);
        return;
      }
      
      setUser({
        username: currentUser.username,
        userId: currentUser.userId,
        email: session.tokens?.idToken?.payload?.email as string | undefined,
      });
    } catch (err: any) {
      console.warn('Erro ao carregar usuário:', err?.message || err);
      
      if (err?.name === 'InvalidCharacterError' || err?.message?.includes('token')) {
        if (typeof window !== 'undefined') {
          localStorage.clear();
          sessionStorage.clear();
        }
      }
      
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUser();
  }, []);

  const signOut = async () => {
    try {
      await amplifySignOut();
      setUser(null);
      
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
    }
  };

  const refreshUser = async () => {
    await loadUser();
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut, refreshUser }}>
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

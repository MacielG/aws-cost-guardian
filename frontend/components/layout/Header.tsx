'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function Header() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await signOut();
      router.push('/login');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
      // Mesmo com erro, redirecionar para login
      router.push('/login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (!user) {
    return null; // Não mostrar header se não estiver logado
  }

  return (
    <header className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo e Título */}
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <h1 className="text-xl font-bold text-gray-900">
                AWS Cost Guardian
              </h1>
            </div>
          </div>

          {/* Informações do Usuário e Logout */}
          <div className="flex items-center gap-4">
            {/* Email do Usuário */}
            <div className="hidden md:block text-sm text-gray-700">
              <span className="font-medium">{user.email || user.username}</span>
            </div>

            {/* Avatar/Ícone do Usuário */}
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-medium">
              {(user.email || user.username).charAt(0).toUpperCase()}
            </div>

            {/* Botão de Logout */}
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className={`
                px-4 py-2 text-sm font-medium rounded-md
                transition-colors duration-200
                ${isLoggingOut 
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                  : 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800'
                }
              `}
              aria-label="Sair da conta"
            >
              {isLoggingOut ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saindo...
                </span>
              ) : (
                'Logout'
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

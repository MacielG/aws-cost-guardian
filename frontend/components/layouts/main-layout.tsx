import React from 'react';
import { Sidebar } from '../ui/sidebar';
import { Header } from '../ui/header';
import { PageAnimator } from '../ui/pageanimator';

interface MainLayoutProps {
  children: React.ReactNode;
  title: string;
}

/**
 * MainLayout
 * Este componente agora é o container principal para todas as páginas autenticadas.
 * Ele gerencia a sidebar, o header e o container de conteúdo principal.
 */
export function MainLayout({ children, title }: MainLayoutProps) {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* 1. Sidebar (Menu de Navegação) */}
      <Sidebar />

      {/* 2. Conteúdo Principal (Header + Página) */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        <Header title={title} />

        {/* 3. O PONTO CHAVE: Container de Conteúdo Centralizado
          - 'max-w-7xl': Define uma largura máxima para o conteúdo (evita que estique demais em monitores grandes).
          - 'mx-auto': Centraliza esse container horizontalmente.
          - 'px-4 sm:px-6 lg:px-8': Adiciona padding responsivo nas laterais.
          - 'py-8': Adiciona espaçamento vertical.

          Todo o {children} (suas páginas) será renderizado dentro deste container.
        */}
        <main className="flex-1">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            {/* 4. Animação de Página
              Envolvemos o {children} com seu PageAnimator para manter as transições.
            */}
            <PageAnimator>{children}</PageAnimator>
          </div>
        </main>
      </div>
    </div>
  );
}

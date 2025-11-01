// frontend/components/layout/MainLayout.tsx
"use client";

import React from 'react';
import { Sidebar } from '@/components/ui/sidebar';
import { Header } from '@/components/ui/header';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <Sidebar />
      <div className="flex flex-col">
        <Header />
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
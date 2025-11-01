"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => setIsMobileMenuOpen((v) => !v);

  return (
    <div className="flex min-h-screen w-full flex-col bg-gray-50">
      <Header onToggleMobileMenu={toggleMobileMenu} />
      <Sidebar isMobileOpen={isMobileMenuOpen} />

      <main className="flex-1 overflow-y-auto pt-16 p-4 md:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}

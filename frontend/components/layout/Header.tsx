"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, LogOut, UserCircle, LayoutDashboard, Settings, CreditCard, LifeBuoy, Lightbulb, ShieldCheck, BarChart3 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ThemeToggle } from "../ThemeToggle";

interface HeaderProps {
  onToggleMobileMenu?: () => void;
}

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/recommendations", label: "Recomendações", icon: Lightbulb },
  { href: "/sla-claims", label: "Créditos SLA", icon: ShieldCheck },
  { href: "/billing", label: "Faturamento", icon: CreditCard },
  { href: "/settings", label: "Configurações", icon: Settings },
];

export function Header({ onToggleMobileMenu }: HeaderProps) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut();
      router.push("/login");
    } catch (error) {
      console.error("Erro ao fazer logout:", error);
    }
  };

  const userEmail = (user?.email || user?.username || "").toString();

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b bg-background/95 backdrop-blur-sm px-4 md:px-6">
      {/* Left: logo + nav icons */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <BarChart3 className="h-6 w-6 text-primary" />
          <span className="hidden md:inline">AWS Cost Guardian</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="group flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                <Icon className="h-5 w-5 text-muted-foreground group-hover:text-accent-foreground" />
                <span className="hidden lg:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <Button variant="ghost" className="md:hidden" onClick={onToggleMobileMenu}>
          <Menu className="h-6 w-6" />
          <span className="sr-only">Abrir menu</span>
        </Button>

        {!user && (
          <Link href="/login">
            <Button variant="default" size="sm">Entrar</Button>
          </Link>
        )}

        {user && (
          <div className="relative">
            <Button variant="ghost" className="flex items-center gap-2" onClick={() => setIsDropdownOpen(!isDropdownOpen)}>
              <UserCircle className="h-6 w-6 text-muted-foreground" />
              <span className="hidden text-sm font-medium md:block">{userEmail || "Carregando..."}</span>
            </Button>

            {isDropdownOpen && (
              <div className="absolute right-0 mt-2 w-56 origin-top-right rounded-md bg-popover shadow-lg ring-1 ring-border">
                <div className="py-1" role="menu" aria-orientation="vertical">
                  <div className="block border-b border-border px-4 py-2 text-sm">
                    <p className="font-medium text-popover-foreground">Logado como</p>
                    <p className="truncate text-muted-foreground">{userEmail}</p>
                  </div>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      handleLogout();
                    }}
                    className="group flex w-full items-center gap-2 px-4 py-2 text-sm text-popover-foreground hover:bg-accent"
                    role="menuitem"
                  >
                    <LogOut className="h-4 w-4 text-muted-foreground group-hover:text-accent-foreground" />
                    Sair (Logout)
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

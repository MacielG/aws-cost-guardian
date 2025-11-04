"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Settings, CreditCard, LifeBuoy, Lightbulb, ShieldCheck, BarChart3, Activity, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";

const navItems = [
{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
{ href: "/recommendations", label: "Recomendações", icon: Lightbulb },
{ href: "/sla-claims", label: "Créditos SLA", icon: ShieldCheck },
{ href: "/billing", label: "Faturamento", icon: CreditCard },
{ href: "/status", label: "Status do Sistema", icon: Activity },
{ href: "/settings/connections", label: "Configurações", icon: Settings },
  { href: "/admin", label: "Admin", icon: Shield },
];

interface SidebarProps {
  isMobileOpen?: boolean;
}

export function Sidebar({ isMobileOpen = false }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();

  if (!user) return null;

  const isAdmin = user['cognito:groups']?.includes('Admins');
  // Mobile-only slide-over sidebar. On larger screens the header contains the nav icons.
  return (
    <>
      {isMobileOpen && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" />}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 flex flex-col border-r border-gray-200 bg-white transition-transform duration-300 ease-in-out md:hidden",
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b px-6">
          <Link href="/dashboard" className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <BarChart3 className="h-6 w-6 text-blue-600" />
            <span>AWS Cost Guardian</span>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
        {navItems.map((item) => {
              // Skip admin item if not admin
              if (item.href === '/admin' && !isAdmin) return null;
              const isActive = pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900",
                      isActive && "bg-gray-100 text-gray-900"
                    )}
                  >
                    <Icon className={cn("h-5 w-5 shrink-0 text-gray-400 group-hover:text-gray-600", isActive && "text-gray-600")} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-auto border-t p-4">
          <Link href="/support" className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900">
            <LifeBuoy className="h-5 w-5 text-gray-400" />
            <span>Suporte</span>
          </Link>
        </div>
      </aside>
    </>
  );
}

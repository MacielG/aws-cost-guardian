import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Home, Settings, BarChart3, Shield } from 'lucide-react';

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const pathname = usePathname();

  const menuItems = [
    { href: '/dashboard', label: 'Dashboard', icon: Home },
    { href: '/sla-claims', label: 'SLA Claims', icon: Shield },
    { href: '/billing', label: 'Billing', icon: BarChart3 },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className={cn('flex flex-col w-64 bg-background-dark border-r border-border-color', className)}>
      <div className="p-6">
        <h2 className="text-h3 font-bold text-text-light">Cost Guardian</h2>
      </div>
      <nav className="flex-1 px-4">
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center px-4 py-3 rounded-md text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-primary-blue/20 text-primary-blue border-l-4 border-primary-blue'
                      : 'text-text-medium hover:bg-primary-blue/10 hover:text-primary-blue'
                  )}
                >
                  <Icon className="w-5 h-5 mr-3" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

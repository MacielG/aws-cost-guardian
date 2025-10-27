import React from 'react';
import { Bell, User } from 'lucide-react';
import { Button } from './button';

interface HeaderProps {
  title: string;
  className?: string;
}

export function Header({ title, className }: HeaderProps) {
  return (
    <header className={`bg-background-dark/80 backdrop-blur-md border-b border-border-color shadow-sm sticky top-0 z-50 ${className || ''}`}>
      <div className="flex items-center justify-between px-6 py-4">
        <h1 className="text-h2 font-semibold text-text-light">{title}</h1>
        <div className="flex items-center space-x-4">
          <Button variant="outline" size="icon">
            <Bell className="w-5 h-5" />
          </Button>
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-primary-blue rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-text-light" />
            </div>
            <span className="text-text-medium text-sm">User</span>
          </div>
        </div>
      </div>
    </header>
  );
}

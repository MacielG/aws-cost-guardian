'use client';

import React from 'react';

type Variant = 'default' | 'success' | 'destructive' | 'secondary' | 'outline';

export function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: Variant }) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded text-sm font-medium shadow-sm transition-colors duration-150';
  const colors: Record<Variant, string> = {
    default: 'bg-gray-100 text-gray-800',
    success: 'bg-green-100 text-green-800',
    destructive: 'bg-red-100 text-red-800',
    secondary: 'bg-blue-100 text-blue-800',
    outline: 'border border-gray-300 text-gray-800 bg-white',
  };

  return <span className={`${base} ${colors[variant]}`}>{children}</span>;
}

export default Badge;

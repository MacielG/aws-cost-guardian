import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  // accept a broader set of variants used in the codebase
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'secondary' | 'destructive' | 'outline';
  className?: string;
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  const variantStyles: Record<string, string> = {
    default: 'bg-gray-100 text-gray-800',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
    // map 'secondary' to a subtle gray pill
    secondary: 'bg-gray-50 text-gray-700 border border-gray-100',
    // 'destructive' map to danger styling
    destructive: 'bg-red-50 text-red-700',
    // outline - transparent with border
    outline: 'bg-transparent border border-gray-200 text-gray-800',
  };

  const styles = variantStyles[variant] ?? variantStyles['default'];

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles} ${className}`}>
      {children}
    </span>
  );
}

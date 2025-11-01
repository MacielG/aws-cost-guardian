import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  // accept a broader set of variants used in the codebase
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'secondary' | 'destructive' | 'outline';
  className?: string;
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  const variantStyles: Record<string, string> = {
    default: 'bg-muted text-muted-foreground border border-border',
    success: 'bg-primary/20 text-primary border border-primary/30 neon-text-primary',
    warning: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    danger: 'bg-destructive/20 text-destructive border border-destructive/30',
    info: 'bg-secondary/20 text-secondary border border-secondary/30 neon-text-secondary',
    // map 'secondary' to a subtle gray pill
    secondary: 'bg-accent text-accent-foreground border border-border',
    // 'destructive' map to danger styling
    destructive: 'bg-destructive/20 text-destructive border border-destructive/30',
    // outline - transparent with border
    outline: 'bg-transparent border border-input text-foreground',
  };

  const styles = variantStyles[variant] ?? variantStyles['default'];

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles} ${className}`}>
      {children}
    </span>
  );
}

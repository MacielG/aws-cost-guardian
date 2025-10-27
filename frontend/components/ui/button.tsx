'use client';

import React, { ButtonHTMLAttributes, isValidElement, ReactElement } from 'react';
import { cn } from '@/lib/utils'; // utilitário de classes

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'secondary';
  size?: 'sm' | 'icon' | 'default';
  asChild?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function Button({ className, variant = 'default', size = 'default', asChild = false, children, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center rounded-md font-medium shadow-sm transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-blue focus:ring-offset-2 focus:ring-offset-background-dark';
  const variantClass = variant === 'outline'
    ? 'border border-border-color bg-transparent text-primary-blue hover:bg-background-light'
    : variant === 'secondary'
      ? 'bg-secondary text-text-medium hover:bg-background-light hover:text-text-light'
      : 'bg-primary-blue text-text-light hover:bg-primary-blue-light shadow-md hover:shadow-lg';
  const sizeClass = size === 'sm' ? 'px-3 py-1.5 text-sm' : size === 'icon' ? 'p-2 text-sm' : 'px-4 py-2 text-base';
  const classes = cn(base, variantClass, sizeClass, className || '');

  if (asChild && children && isValidElement(children)) {
    // Aplica as classes no elemento filho (por exemplo <a>)
    const child = children as ReactElement;
    return React.cloneElement(child, { className: cn(classes, child.props.className), ...props });
  }

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}

export default Button;
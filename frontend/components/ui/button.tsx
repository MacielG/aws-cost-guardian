'use client';

import React, { ButtonHTMLAttributes, isValidElement, ReactElement } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils'; // utilitário de classes

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'
> {
  variant?: 'default' | 'outline' | 'secondary';
  size?: 'sm' | 'icon' | 'default';
  asChild?: boolean;
  isLoading?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function Button({ className, variant = 'default', size = 'default', asChild = false, isLoading = false, children, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center rounded-md font-medium shadow-sm transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-blue focus:ring-offset-2 focus:ring-offset-background-dark';
  const variantClass = variant === 'outline'
    ? 'border border-border-color bg-transparent text-primary-blue hover:bg-background-light'
    : variant === 'secondary'
      ? 'bg-secondary text-text-medium hover:bg-background-light hover:text-text-light'
      : 'bg-gradient-to-r from-primary-blue to-primary-blue-light text-text-light hover:from-primary-blue-light hover:to-primary-blue shadow-md hover:shadow-lg hover:scale-105';
  const sizeClass = size === 'sm' ? 'px-3 py-1.5 text-sm' : size === 'icon' ? 'p-2 text-sm' : 'px-4 py-2 text-base';
  const classes = cn(base, variantClass, sizeClass, className || '');

  if (asChild && children && isValidElement(children)) {
    // Aplica as classes no elemento filho (por exemplo <a>)
    const child = children as ReactElement;
    return React.cloneElement(child, { className: cn(classes, child.props.className), ...props });
  }

  return (
    <motion.button
      className={classes}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.1 }}
      disabled={isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading...
        </>
      ) : (
        children
      )}
    </motion.button>
  );
}

export default Button;
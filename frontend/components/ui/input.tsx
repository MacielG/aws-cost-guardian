import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<
  HTMLInputElement, 
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 
    'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'
  > & { hasError?: boolean }
>(({ className, hasError = false, ...props }, ref) => {
    return (
      <motion.input
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-md bg-background-dark px-3 py-2 text-sm text-text-light placeholder:text-text-medium focus:outline-none focus:ring-2 focus:ring-primary-blue/30 focus:ring-offset-2 focus:ring-offset-background-dark disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200',
          hasError ? 'border-secondary-red' : 'border-border-color focus:border-primary-blue',
          className
        )}
        animate={hasError ? { x: [-3, 3, -3, 3, 0] } : {}}
        transition={hasError ? { duration: 0.3, ease: "easeInOut" } : {}}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';

export default Input;

import { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils'; // Crie utils.ts com cn = (...classes) => classes.filter(Boolean).join(' ')

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline';
}

export function Button({ className, variant = 'default', ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'px-4 py-2 rounded font-medium',
        variant === 'outline' ? 'border border-gray-300' : 'bg-blue-500 text-white',
        className
      )}
      {...props}
    />
  );
}
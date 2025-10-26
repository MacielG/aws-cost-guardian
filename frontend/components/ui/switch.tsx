"use client";
import React from 'react';
import { cn } from '@/lib/utils';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  ariaLabel?: string;
}

export function Switch({ checked, onChange, className, ariaLabel }: SwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex items-center h-6 rounded-full transition-colors focus:outline-none',
        checked ? 'bg-blue-600' : 'bg-gray-300',
        className || ''
      )}
    >
      <span
        className={cn(
          'inline-block w-5 h-5 bg-white rounded-full shadow transform transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  );
}

export default Switch;

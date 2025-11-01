"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'
> {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState = ({ icon: Icon, title, description, action }: EmptyStateProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-background/80 dark:bg-background/60 p-12 text-center shadow"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
      >
        <Icon className="h-16 w-16 text-muted-foreground" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mt-4 text-center"
      >
        <h3 className="text-lg font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </motion.div>

      {action && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          onClick={action.onClick}
          className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] shadow"
        >
          {action.label}
        </motion.button>
      )}
    </motion.div>
  );
};

export const SuccessEmptyState = () => {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-green-200 bg-green-50 p-12 text-center">
      <svg className="h-16 w-16 text-green-500" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <motion.path
          d="M22 4L12 14.01l-3-3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        />
      </svg>
      <h3 className="mt-4 text-lg font-medium text-gray-900">Tudo otimizado!</h3>
      <p className="mt-1 text-sm text-gray-500">Nenhuma recomendação de economia encontrada.</p>
    </div>
  );
};

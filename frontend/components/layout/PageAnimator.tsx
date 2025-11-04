// frontend/components/layout/PageAnimator.tsx
'use client';
import React from 'react';
import { motion } from 'framer-motion';
import { pageTransition } from '@/lib/animations';

export const PageAnimator = ({ children }: { children: React.ReactNode }) => {
  return (
    <motion.div
      variants={pageTransition}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {children}
    </motion.div>
  );
};

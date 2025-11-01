// frontend/components/layout/PageAnimator.tsx
'use client';
import React from 'react';
import { motion } from 'framer-motion';

export const PageAnimator = ({ children }: { children: React.ReactNode }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  );
};

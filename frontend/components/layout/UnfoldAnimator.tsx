"use client";

import React from 'react';
import { motion } from "framer-motion";

interface UnfoldAnimatorProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  delay?: number;
}

export const UnfoldAnimator = ({ children, delay = 0, className }: UnfoldAnimatorProps) => {
  const variants = {
    hidden: {
      opacity: 0,
      transform: 'rotateY(-90deg)',
    },
    visible: {
      opacity: 1,
      transform: 'rotateY(0deg)',
    },
  };

  return (
    <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.5 }} transition={{ duration: 0.7, ease: "easeInOut" }} variants={variants} className={className} style={{ transformOrigin: 'left' }}>{children}</motion.div>
  );
};
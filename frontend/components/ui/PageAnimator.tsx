"use client";

import React from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";

/**
 * PageAnimator
 * Animação de página melhorada.
 * Em vez de um simples 'opacity', usamos um 'fadeIn' e 'slideUp' sutil.
 * * - 'variants': Define os estados 'hidden' (inicial) e 'visible' (animado).
 * - 'initial="hidden"': Começa transparente e 10px abaixo.
 * - 'animate="visible"': Anima para opacidade 1 e posição Y 0.
 * - 'exit="hidden"': Faz o efeito reverso ao sair da página.
 * - 'key={pathname}': Garante que a animação re-execute a cada mudança de rota.
 */
export const PageAnimator = ({ children }: Omit<React.HTMLAttributes<HTMLDivElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'
> & { children: React.ReactNode }) => {
  const pathname = usePathname();

  // Definição dos estados da animação (variants)
  const pageVariants = {
    hidden: {
      opacity: 0,
      y: 10, // Começa 10px abaixo
    },
    visible: {
      opacity: 1,
      y: 0, // Sobe para a posição original
      transition: {
        type: "spring" as const, // Use 'spring' para uma sensação mais natural
        damping: 20,
        stiffness: 100,
      },
    },
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname} // A chave é essencial para o AnimatePresence
        initial="hidden"
        animate="visible"
        exit="hidden"
        variants={pageVariants}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
};

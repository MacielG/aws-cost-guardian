'use client';
import { useEffect, useState } from 'react';
import {
  motion,
  useSpring,
  useTransform,
  MotionValue,
  animate,
} from 'framer-motion';

interface AnimatedCounterProps {
  value: number;
  animationOptions?: any;
  formatValue?: (value: number) => string;
  className?: string;
}

const AnimatedCounter = ({
  value,
  animationOptions,
  formatValue,
  className,
}: AnimatedCounterProps) => {
  const [isMounted, setIsMounted] = useState(false);

  /* CORREÇÃO: Mova todas as chamadas de Hooks (useSpring, useTransform, useEffect)
    para o topo do componente, ANTES do 'return' condicional.
  */
  const spring = useSpring(0, {
    to: value,
    mass: 1,
    tension: 20,
    friction: 10,
    ...animationOptions,
  });

  const displayValue = useTransform(spring, (currentValue) => {
    return formatValue
      ? formatValue(currentValue)
      : Math.round(currentValue).toLocaleString();
  });

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const controls = animate(spring, value);
    return () => controls.stop();
  }, [value, spring]);


  /* Agora o 'return' condicional pode ser usado sem problemas */
  if (!isMounted) {
    /* Opcionalmente, você pode querer que o valor inicial seja formatado 
      mesmo antes da montagem, se 'formatValue' for fornecido.
    */
    const initialDisplay = formatValue
      ? formatValue(value)
      : value.toLocaleString();
    return <span className={className}>{initialDisplay}</span>;
  }

  return (
    <motion.span className={className} {...animationOptions}>
      {displayValue}
    </motion.span>
  );
};

export default AnimatedCounter;

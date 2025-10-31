"use client";

import { motion, useSpring, useTransform } from 'framer-motion';
import { useEffect } from 'react';

interface AnimatedCounterProps {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}

export const AnimatedCounter = ({ 
  value, 
  prefix = "", 
  suffix = "",
  decimals = 2,
  className = ""
}: AnimatedCounterProps) => {
  const spring = useSpring(0, {
    mass: 0.8,
    stiffness: 75,
    damping: 15,
  });

  const displayValue = useTransform(spring, (currentValue) => {
    return `${prefix}${currentValue.toFixed(decimals)}${suffix}`;
  });

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span className={className}>{displayValue}</motion.span>;
};

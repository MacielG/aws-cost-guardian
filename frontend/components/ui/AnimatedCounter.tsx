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
  // Defensive: some test environments may mock or not provide framer-motion hooks.
  const hasMotionHooks = typeof useSpring === 'function' && typeof useTransform === 'function';

  if (!hasMotionHooks) {
    // Fallback: render static formatted value so tests and SSR/dev don't crash
    // Defensive: value may be undefined in some tests — coerce to number and
    // fallback to 0 so toFixed() never throws.
    const numeric = Number(value ?? 0);
    const formatted = `${prefix}${numeric.toFixed(decimals)}${suffix}`;
    return <span className={className}>{formatted}</span>;
  }

  const spring = useSpring(0, {
    mass: 0.8,
    stiffness: 75,
    damping: 15,
  });

  const displayValue = useTransform(spring, (currentValue) => {
    return `${prefix}${currentValue.toFixed(decimals)}${suffix}`;
  });

  useEffect(() => {
    // Coerce incoming value to finite number to avoid runtime exceptions
    const numeric = Number(value ?? 0);
    spring.set(isFinite(numeric) ? numeric : 0);
  }, [spring, value]);

  // In test environments our framer-motion mock returns plain DOM elements and
  // the animated value may be a simple object with a .get() method. Read the
  // current value defensively so we always render a primitive string inside
  // the span (avoids React trying to render an object).
  let displayString: string;
  try {
    if (displayValue && typeof (displayValue as any).get === 'function') {
      displayString = String((displayValue as any).get());
    } else {
      displayString = String(displayValue);
    }
  } catch (e) {
    // Fallback: compute from numeric value
    const numeric = Number(value ?? 0);
    displayString = `${prefix}${(isFinite(numeric) ? numeric : 0).toFixed(decimals)}${suffix}`;
  }

  return <motion.span className={className}>{displayString}</motion.span>;
};

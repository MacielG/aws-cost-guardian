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
const [displayValue, setDisplayValue] = useState(() =>
    formatValue ? formatValue(0) : '0'
);

useEffect(() => {
  const spring = useSpring(0, {
  to: value,
  mass: 1,
  tension: 20,
  friction: 10,
  ...animationOptions,
  });

  const unsubscribe = spring.onChange((currentValue) => {
  const formatted = formatValue
  ? formatValue(currentValue)
  : Math.round(currentValue).toLocaleString();
    setDisplayValue(formatted);
    });

return unsubscribe;
}, [value, formatValue, animationOptions]);

return <span className={className}>{displayValue}</span>;
};

export default AnimatedCounter;

import React from 'react';

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-md bg-background-light bg-gradient-to-r from-transparent via-border-color to-transparent bg-[length:1000px_100%] animate-shimmer ${className}`}
      style={{ minHeight: 24 }}
    />
  );
}

export default Skeleton;

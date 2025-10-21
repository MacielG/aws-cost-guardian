
'use client';
import { createContext, useContext, useState } from 'react';

type SelectContextType = {
  value?: string;
  onValueChange?: (v: string) => void;
  open?: boolean;
  setOpen?: (s: boolean) => void;
};

const SelectContext = createContext<SelectContextType>({});

export const Select = ({ children, value, onValueChange }: { children: React.ReactNode; value?: string; onValueChange?: (v: string) => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen }}>
      <div className="relative inline-block">{children}</div>
    </SelectContext.Provider>
  );
};

export const SelectTrigger = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => {
  const ctx = useContext(SelectContext);
  const handleClick = () => ctx.setOpen && ctx.setOpen(!ctx.open);
  return (
    <button type="button" onClick={handleClick} className={`border rounded px-3 py-2 text-sm flex items-center justify-between ${className}`}>
      {children}
    </button>
  );
};

export const SelectValue = ({ placeholder }: { placeholder?: string }) => {
  const ctx = useContext(SelectContext);
  return <span>{ctx.value || placeholder}</span>;
};

export const SelectContent = ({ children }: { children?: React.ReactNode }) => {
  const ctx = useContext(SelectContext);
  if (!ctx.open) return null;
  return (
    <div className="absolute z-10 mt-2 w-56 bg-white border rounded shadow-md">{children}</div>
  );
};

export const SelectItem = ({ children, value }: { children?: React.ReactNode; value: string }) => {
  const ctx = useContext(SelectContext);
  const handleClick = () => {
    ctx.onValueChange && ctx.onValueChange(value);
    ctx.setOpen && ctx.setOpen(false);
  };
  return (
    <div onClick={handleClick} className="px-3 py-2 hover:bg-gray-100 cursor-pointer">{children}</div>
  );
};

SelectTrigger.displayName = 'SelectTrigger';
SelectContent.displayName = 'SelectContent';
SelectItem.displayName = 'SelectItem';
SelectValue.displayName = 'SelectValue';

export default Select;

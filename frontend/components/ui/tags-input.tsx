"use client";
import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface TagsInputProps {
  value?: string; // comma separated
  onChange?: (next: string) => void; // returns comma separated
  placeholder?: string;
}

export function TagsInput({ value = '', onChange, placeholder }: TagsInputProps) {
  const parse = (v: string) => v.split(',').map(t => t.trim()).filter(Boolean);
  const [tags, setTags] = useState<string[]>(() => parse(value));
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTags(parse(value));
  }, [value]);

  useEffect(() => {
    onChange?.(tags.join(', '));
  }, [tags, onChange]);

  function addTagFromInput() {
    const next = input.split(',').map(t => t.trim()).filter(Boolean);
    if (next.length) {
      setTags(prev => Array.from(new Set([...prev, ...next])));
    }
    setInput('');
    inputRef.current?.focus();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((t, i) => (
          <span key={t + i} className="inline-flex items-center gap-2 bg-gray-100 text-sm px-2 py-1 rounded">
            <span className="select-none">{t}</span>
            <button
              type="button"
              onClick={() => setTags(prev => prev.filter(x => x !== t))}
              className="text-gray-500 hover:text-gray-700"
              aria-label={`Remover tag ${t}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          ref={inputRef}
          className={cn('flex-1 px-3 py-2 border rounded-md text-sm')}
          value={input}
          placeholder={placeholder || 'Adicionar tag e pressione Enter ou vírgula'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTagFromInput();
            }
            if (e.key === ',') {
              e.preventDefault();
              addTagFromInput();
            }
            if (e.key === 'Backspace' && input === '') {
              setTags(prev => prev.slice(0, -1));
            }
          }}
        />
        <button
          type="button"
          onClick={addTagFromInput}
          className="inline-flex items-center justify-center rounded font-medium shadow-sm transition-colors duration-150 border border-gray-300 bg-white text-gray-800 px-4 py-2 text-base"
        >
          Adicionar
        </button>
      </div>
    </div>
  );
}

export default TagsInput;

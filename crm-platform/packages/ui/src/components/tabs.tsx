'use client';

import { useId, useState, type ReactNode } from 'react';
import { cn } from '../cn';

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  /** Controlled selection (e.g. from `?tab=`). Omit for uncontrolled. */
  value?: string;
  onValueChange?: (id: string) => void;
  defaultValue?: string;
  className?: string;
}

/** Accessible tab list: arrow keys move, Home/End jump. Only the active panel is rendered. */
export function Tabs({ items, value, onValueChange, defaultValue, className }: TabsProps) {
  const base = useId();
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id ?? '');
  const active = value ?? inner;
  const select = (id: string) => {
    if (value === undefined) setInner(id);
    onValueChange?.(id);
  };
  const current = items.find((i) => i.id === active) ?? items[0];

  const onKey = (e: React.KeyboardEvent, index: number) => {
    const last = items.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (index + 1) % items.length
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (index - 1 + items.length) % items.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    select(items[next]!.id);
    document.getElementById(`${base}-tab-${items[next]!.id}`)?.focus();
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border"
      >
        {items.map((item, i) => (
          <button
            key={item.id}
            id={`${base}-tab-${item.id}`}
            role="tab"
            type="button"
            aria-selected={item.id === current?.id}
            aria-controls={`${base}-panel-${item.id}`}
            tabIndex={item.id === current?.id ? 0 : -1}
            onClick={() => select(item.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition',
              item.id === current?.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {current && (
        <div
          role="tabpanel"
          id={`${base}-panel-${current.id}`}
          aria-labelledby={`${base}-tab-${current.id}`}
          className="pt-4"
        >
          {current.content}
        </div>
      )}
    </div>
  );
}

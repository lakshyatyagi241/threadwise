'use client';

import { useEffect, useId, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@crm/ui';

export interface TabBarItem<T extends string> {
  id: T;
  label: ReactNode;
}

/**
 * An accessible tab list (arrow keys, Home and End move, only the active tab is in the tab order)
 * that scrolls sideways on a phone. The panel itself is rendered by the caller, so a form that spans
 * several tabs keeps one state.
 */
export function TabBar<T extends string>({
  items,
  value,
  onChange,
  label,
  idPrefix,
  className,
}: {
  items: readonly TabBarItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** Used to build the ids the panel points back to (`<prefix>-tab-<id>`). */
  idPrefix?: string;
  className?: string;
}) {
  const auto = useId();
  const prefix = idPrefix ?? auto;

  // On a phone the list scrolls sideways: keep the selected tab in view (a saved tab can start off screen).
  useEffect(() => {
    document
      .getElementById(`${prefix}-tab-${value}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [prefix, value]);

  const onKey = (e: KeyboardEvent, index: number) => {
    const last = items.length - 1;
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    const next =
      e.key === forward
        ? (index + 1) % items.length
        : e.key === back
          ? (index - 1 + items.length) % items.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    const target = items[next]!;
    onChange(target.id);
    document.getElementById(`${prefix}-tab-${target.id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'flex gap-1 overflow-x-auto overflow-y-hidden rounded-md border border-border bg-background p-1',
        className,
      )}
    >
      {items.map((item, i) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            id={`${prefix}-tab-${item.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${prefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'shrink-0 rounded px-3.5 py-1.5 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-primary',
              selected
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

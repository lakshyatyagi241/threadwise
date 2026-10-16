'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@crm/ui';
import { InlinePanel } from './inline-panel';

export interface MultiSelectOption {
  id: string;
  /** The text searched and read out. */
  label: string;
  /** What the option and its chip show; the label when missing. */
  render?: ReactNode;
}

export interface MultiSelectProps {
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
  searchLabel: string;
  emptyText: string;
  testId?: string;
}

/**
 * A dropdown that takes several choices: the closed box shows what is chosen (each with a small x), the open list has a search box
 * and a check for every option. Used by the Filters window for labels, channels and agents, where a workspace can have many.
 */
export function MultiSelect(p: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [needle, setNeedle] = useState('');
  const chosen = new Set(p.value);
  const byId = new Map(p.options.map((o) => [o.id, o]));
  const shown = p.options.filter((o) =>
    o.label.toLowerCase().includes(needle.trim().toLowerCase()),
  );
  const toggle = (id: string) =>
    p.onChange(chosen.has(id) ? p.value.filter((v) => v !== id) : [...p.value, id]);

  return (
    <div className="relative">
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex min-h-10 cursor-pointer items-center gap-1 rounded-md border border-border bg-background ps-2 pe-1 focus-within:ring-2 focus-within:ring-primary',
          open && 'border-primary',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-wrap gap-1 py-1">
          {p.value.length === 0 && (
            <span className="px-1 text-sm text-muted-foreground">{p.placeholder}</span>
          )}
          {p.value.map((id) => {
            const o = byId.get(id);
            return (
              <span
                key={id}
                className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
              >
                <span className="truncate">{o?.render ?? o?.label ?? id}</span>
                <button
                  type="button"
                  aria-label={`${o?.label ?? id} ×`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(id);
                  }}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
        {p.value.length > 0 && (
          <button
            type="button"
            aria-label={`${p.label} ×`}
            onClick={(e) => {
              e.stopPropagation();
              p.onChange([]);
            }}
            className="px-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            ×
          </button>
        )}
        <button
          type="button"
          data-testid={p.testId}
          aria-label={p.label}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="grid size-8 shrink-0 place-items-center border-s border-border text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <svg
            viewBox="0 0 20 20"
            className={cn('size-4 transition', open && 'rotate-180')}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden
          >
            <path d="m5 8 5 5 5-5" />
          </svg>
        </button>
      </div>
      <InlinePanel
        open={open}
        onClose={() => {
          setOpen(false);
          setNeedle('');
        }}
        label={p.label}
        className="space-y-2 p-2"
      >
        {p.options.length > 6 && (
          <input
            type="search"
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            aria-label={p.searchLabel}
            placeholder={p.searchLabel}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
          />
        )}
        <ul
          role="listbox"
          aria-multiselectable="true"
          aria-label={p.label}
          className="max-h-44 space-y-0.5 overflow-y-auto thin-scrollbar"
        >
          {shown.map((o) => (
            <li key={o.id} role="option" aria-selected={chosen.has(o.id)}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                <input type="checkbox" checked={chosen.has(o.id)} onChange={() => toggle(o.id)} />
                <span className="min-w-0 truncate">{o.render ?? o.label}</span>
              </label>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="px-1.5 py-1 text-xs text-muted-foreground">{p.emptyText}</li>
          )}
        </ul>
      </InlinePanel>
    </div>
  );
}

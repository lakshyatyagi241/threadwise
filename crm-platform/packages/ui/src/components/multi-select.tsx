'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../cn';

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  options: readonly MultiSelectOption[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Accessible name of the control. */
  label: string;
  placeholder?: string;
  /** Shown in the list when the filter matches nothing. */
  emptyLabel: string;
  /** Accessible name of a chip's remove button, e.g. `Remove Pro`. */
  removeLabel: (optionLabel: string) => string;
  /** Accessible name of the clear-all button; omit to hide it. */
  clearLabel?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Pick any number of options: chips for the chosen ones, a filter box, a list of what is left. Type to filter, Enter or a click
 * adds, Backspace on an empty box removes the last chip, Escape closes the list. A value with no matching option (a plan that was
 * deleted) still shows as a chip with its raw value so it can be removed.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  label,
  placeholder,
  emptyLabel,
  removeLabel,
  clearLabel,
  disabled,
  id,
  className,
}: MultiSelectProps) {
  const autoId = useId();
  const listId = `${id ?? autoId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const left = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) => !value.includes(o.value) && (q === '' || o.label.toLowerCase().includes(q)),
    );
  }, [options, value, query]);

  const add = (v: string) => {
    onChange([...value, v]);
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
  };
  const remove = (v: string) => onChange(value.filter((x) => x !== v));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(left.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && left[active]) {
        e.preventDefault();
        add(left[active].value);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && query === '' && value.length > 0) {
      remove(value[value.length - 1]!);
    }
  };

  return (
    <div className={cn('relative', className)}>
      <div
        className={cn(
          'flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5',
          'focus-within:ring-2 focus-within:ring-primary',
          disabled && 'opacity-50',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded bg-primary/10 py-0.5 ps-2 pe-1 text-xs text-primary"
          >
            {labelOf(v)}
            <button
              type="button"
              disabled={disabled}
              aria-label={removeLabel(labelOf(v))}
              onClick={(e) => {
                e.stopPropagation();
                remove(v);
              }}
              className="grid size-4 place-items-center rounded hover:bg-primary/20"
            >
              <svg
                viewBox="0 0 12 12"
                className="size-2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && left[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={query}
          placeholder={value.length === 0 ? placeholder : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
        />
        {clearLabel && value.length > 0 && (
          <button
            type="button"
            disabled={disabled}
            aria-label={clearLabel}
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
            className="ms-auto grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted"
          >
            <svg
              viewBox="0 0 12 12"
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        )}
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-background py-1 shadow-lg"
        >
          {left.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">{emptyLabel}</li>
          )}
          {left.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={false}
              // mouse-down, not click: the input's blur would close the list before a click lands
              onMouseDown={(e) => {
                e.preventDefault();
                add(o.value);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('cursor-pointer px-3 py-1.5 text-sm', i === active && 'bg-muted')}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

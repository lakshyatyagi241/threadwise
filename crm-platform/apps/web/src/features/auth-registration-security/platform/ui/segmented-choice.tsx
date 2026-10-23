'use client';

import { cn } from '@crm/ui';

/**
 * A segmented control over native radio buttons (arrow keys move the choice, the group is a radiogroup with a label). Shared with the
 * pack editor's Plans section, so the caller passes the translated labels.
 */
export function SegmentedChoice<V extends string>({
  name,
  label,
  value,
  options,
  onChange,
  disabled = false,
  describedBy,
  testId,
}: {
  /** The radio group's name: unique on the page. */
  name: string;
  /** What the group is for, read by a screen reader. */
  label: string;
  value: V;
  /** An option with `disabled` stays visible (and checked, if it is the value) but cannot be chosen; the caller says why in `describedBy`. */
  options: ReadonlyArray<{ value: V; label: string; disabled?: boolean }>;
  onChange: (value: V) => void;
  disabled?: boolean;
  describedBy?: string;
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      aria-disabled={disabled || undefined}
      data-testid={testId}
      data-value={value}
      className="inline-flex max-w-full flex-wrap gap-0.5 rounded-md border border-border bg-muted/40 p-0.5"
    >
      {options.map((o) => {
        const checked = o.value === value;
        const off = disabled || o.disabled === true;
        return (
          <label
            key={o.value}
            className={cn(
              'relative inline-flex min-h-8 items-center rounded px-3 text-xs font-medium',
              'focus-within:ring-2 focus-within:ring-primary',
              checked ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
              off ? 'cursor-not-allowed opacity-60' : !checked && 'cursor-pointer hover:bg-muted',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={checked}
              disabled={off}
              onChange={() => onChange(o.value)}
              className="sr-only"
              data-testid={testId ? `${testId}-${o.value}` : undefined}
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

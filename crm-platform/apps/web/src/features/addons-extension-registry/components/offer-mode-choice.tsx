'use client';

import { cn } from '@crm/ui';
import type { PlanAddonOfferMode } from '@crm/contracts';

/**
 * The pack editor's per-plan Included | Paid | Hidden control: native radio buttons in a labelled radiogroup (arrow keys move the choice),
 * where one option can be switched off on its own (Included, for a feature add-on that unlocks no feature yet). The caller passes the
 * translated labels.
 */
export function OfferModeChoice({
  name,
  label,
  value,
  options,
  onChange,
  disabled = false,
  disabledDescribedBy,
  testId,
}: {
  name: string;
  label: string;
  value: PlanAddonOfferMode;
  options: ReadonlyArray<{ value: PlanAddonOfferMode; label: string; disabled?: boolean }>;
  onChange: (value: PlanAddonOfferMode) => void;
  disabled?: boolean;
  /** The id of the line saying why an option is off; set on each switched-off radio. */
  disabledDescribedBy?: string;
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      data-testid={testId}
      data-value={value}
      className="inline-flex max-w-full flex-wrap gap-0.5 rounded-md border border-border bg-muted/40 p-0.5"
    >
      {options.map((o) => {
        const checked = o.value === value;
        const off = disabled || !!o.disabled;
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
              aria-describedby={o.disabled ? disabledDescribedBy : undefined}
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

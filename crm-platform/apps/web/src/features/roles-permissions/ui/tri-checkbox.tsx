'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@crm/ui';
import type { TriState } from '../lib/matrix';

/**
 * A checkbox that can show "some": the header "Select all permissions" and each module's "Select all".
 * The native `indeterminate` flag is a property, not an attribute, so it is set from an effect.
 */
export function TriCheckbox({
  state,
  onChange,
  label,
  disabled,
  className,
  ...rest
}: {
  state: TriState;
  /** The new checked value: a click on `some` or `none` ticks everything, on `all` clears. */
  onChange: (on: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={state === 'all'}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-checked={state === 'some' ? 'mixed' : state === 'all'}
        className="size-4 shrink-0 rounded border-border accent-[var(--primary)]"
        {...rest}
      />
      {label}
    </label>
  );
}

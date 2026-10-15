'use client';

import { cn } from '@crm/ui';
import { useId, type ReactNode } from 'react';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  invalid: boolean;
}

/**
 * Label, control, hint and error with the ids wired up (aria-describedby / role=alert),
 * so every guest input is announced with its problem. The control comes from a render prop.
 */
export function FormField({
  label,
  hint,
  error,
  labelEnd,
  optionalLabel,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Right-hand side of the label row (e.g. "Forgot password?"). */
  labelEnd?: ReactNode;
  optionalLabel?: string;
  className?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-semibold text-(--auth-ink-700)">
          {label}
          {optionalLabel && (
            <span className="ms-1 font-normal text-(--auth-ink-500)">({optionalLabel})</span>
          )}
        </label>
        {labelEnd}
      </div>
      {children({ id, 'aria-describedby': describedBy || undefined, invalid: Boolean(error) })}
      {error ? (
        <div id={errorId} role="alert" className="mt-1 text-[12.5px] text-(--auth-coral-ink)">
          {error}
        </div>
      ) : null}
      {hint ? (
        <p id={hintId} className={cn('mt-1 text-[12px] text-(--auth-ink-500)')}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

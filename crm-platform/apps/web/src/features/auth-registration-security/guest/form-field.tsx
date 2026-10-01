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
    <div className={cn('space-y-1.5 text-sm', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-medium">
          {label}
          {optionalLabel && (
            <span className="ms-1 text-xs font-normal text-muted-foreground">
              ({optionalLabel})
            </span>
          )}
        </label>
        {labelEnd}
      </div>
      {children({ id, 'aria-describedby': describedBy || undefined, invalid: Boolean(error) })}
      {error ? (
        <div id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </div>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

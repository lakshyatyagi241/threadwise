import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  /** Small uppercase mono label, as the side forms of the operator console print them. */
  eyebrow?: boolean;
  children: ReactNode;
}

/** Label, control, optional hint and error line. The error replaces the hint and is announced to screen readers. */
export function Field({ label, htmlFor, hint, error, className, eyebrow, children }: FieldProps) {
  return (
    <div className={cn('space-y-1.5 text-sm', className)}>
      <label
        htmlFor={htmlFor}
        className={
          eyebrow
            ? 'block font-mono text-[10px] font-normal uppercase tracking-[0.18em] text-muted-foreground'
            : 'block font-medium'
        }
      >
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

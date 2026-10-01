import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface EmptyStateProps {
  title: ReactNode;
  message?: ReactNode;
  /** Buttons or links shown under the message. */
  actions?: ReactNode;
  className?: string;
}

/** The dashed "nothing here" panel used when a list has no rows (or none match the filters). */
export function EmptyState({ title, message, actions, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-dashed border-border bg-background px-6 py-10 text-center',
        className,
      )}
    >
      <div className="text-lg font-semibold">{title}</div>
      {message && <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{message}</p>}
      {actions && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      )}
    </div>
  );
}

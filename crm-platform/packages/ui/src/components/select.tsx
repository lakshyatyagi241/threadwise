import type { SelectHTMLAttributes } from 'react';
import { cn } from '../cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export function Select({ className, invalid, ...rest }: SelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid ? 'border-danger' : 'border-border',
        className,
      )}
      {...rest}
    />
  );
}

import type { ComponentProps } from 'react';
import { cn } from '../cn';

export interface InputProps extends ComponentProps<'input'> {
  invalid?: boolean;
}

export function Input({ className, invalid, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary',
        invalid ? 'border-danger' : 'border-border',
        className,
      )}
      {...rest}
    />
  );
}

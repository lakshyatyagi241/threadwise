import type { ComponentProps } from 'react';
import { cn } from '../cn';

export interface TextareaProps extends ComponentProps<'textarea'> {
  invalid?: boolean;
}

export function Textarea({ className, invalid, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary',
        invalid ? 'border-danger' : 'border-border',
        className,
      )}
      {...rest}
    />
  );
}

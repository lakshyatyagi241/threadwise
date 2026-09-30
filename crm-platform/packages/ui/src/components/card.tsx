import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-md border border-border bg-background p-4 text-foreground', className)}
      {...rest}
    />
  );
}

import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

type Tone = 'info' | 'success' | 'warning' | 'danger';
const TONES: Record<Tone, string> = {
  info: 'border-border bg-muted text-foreground',
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  danger: 'border-danger/40 bg-danger/10 text-danger',
};

export function Alert({
  tone = 'info',
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('rounded-md border px-3 py-2 text-sm', TONES[tone], className)}
      {...rest}
    />
  );
}

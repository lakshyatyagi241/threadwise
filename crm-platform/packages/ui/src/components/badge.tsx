import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';
const TONES: Record<Tone, string> = {
  neutral: 'bg-muted text-foreground/80',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/15 text-danger',
};

export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}

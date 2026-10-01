import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** `accent` outlines the tile in the primary colour, `warning` in the warning colour. */
  tone?: 'default' | 'accent' | 'warning';
  className?: string;
}

const TONES = {
  default: 'border-border',
  accent: 'border-primary/40',
  warning: 'border-warning/40',
} as const;

/** One KPI: small label, large number, one line of context. */
export function StatTile({ label, value, hint, tone = 'default', className }: StatTileProps) {
  return (
    <div className={cn('rounded-md border bg-background p-4', TONES[tone], className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-semibold leading-none tabular-nums">{value}</div>
      {hint && (
        <div
          className={cn(
            'mt-2 text-xs',
            tone === 'accent' ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';
import { Card, cn } from '@crm/ui';

/** One KPI card: label, big number, an optional sub-line and a change chip (positive green, negative red). */
export function Kpi({
  label,
  value,
  sub,
  change,
  testId,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  change?: string;
  testId?: string;
}) {
  const n = change === undefined ? null : Number(change);
  return (
    <Card className="space-y-1 p-4" data-testid={testId}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-2xl font-semibold tabular-nums">{value}</p>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {sub && <span>{sub}</span>}
        {n !== null && Number.isFinite(n) && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 font-medium',
              n >= 0 ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
            )}
          >
            {n >= 0 ? '+' : ''}
            {change}%
          </span>
        )}
      </div>
    </Card>
  );
}

/** The window pickers of the three reports: a labelled select that changes the page state. */
export function WindowSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        className="h-9 rounded-md border border-border bg-background px-2"
        value={String(value)}
        onChange={(e) => {
          const picked = options.find((o) => String(o.value) === e.target.value);
          if (picked) onChange(picked.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export const PALETTE = [
  'var(--chart-1, #4f46e5)',
  'var(--chart-2, #0ea5e9)',
  'var(--chart-3, #10b981)',
  'var(--chart-4, #f59e0b)',
  'var(--chart-5, #ef4444)',
  'var(--chart-6, #8b5cf6)',
];
export const colorAt = (i: number) => PALETTE[i % PALETTE.length]!;

export const formatCurrency = (
  amount: string | number,
  currency: string,
  locale: string,
): string => {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
};

import type { ReactNode } from 'react';
import { cn } from '@crm/ui';
import { statusTone, type Tone } from '../lib/model';

const TONES: Record<Tone, string> = {
  good: 'bg-success/15 text-success',
  bad: 'bg-danger/15 text-danger',
  muted: 'bg-muted text-muted-foreground',
  warn: 'bg-warning/15 text-warning',
};

/** A small rounded status label. */
export function Pill({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        TONES[statusTone(status)],
      )}
    >
      {label ?? status}
    </span>
  );
}

/** One figure with a caption: the KPI strip of the overview and analytics tabs. */
export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-[26px] font-normal leading-none tabular-nums">{value}</div>
      {hint !== undefined && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** A bordered card with an optional heading row. */
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('rounded-2xl border border-border bg-background p-5 shadow-sm', className)}
    >
      {(title !== undefined || action !== undefined) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title !== undefined && (
            <h3 className="text-[19px] font-normal leading-tight">{title}</h3>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** A scrollable table frame. */
export function TableFrame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">{children}</table>
      </div>
    </div>
  );
}

export const TH =
  'px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground';
export const TD = 'px-4 py-3 align-middle';
export const ROW = 'border-t border-border';

/** The row shown when a table has nothing to list. */
export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-10 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

export const pillLink =
  'inline-flex h-9 items-center gap-2 rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted';

export const primaryButton =
  'inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50';

/** The inline result line under a form. */
export function ResultLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'rounded-lg border px-3 py-2 text-xs',
        ok
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-danger/40 bg-danger/10 text-danger',
      )}
    >
      {children}
    </div>
  );
}

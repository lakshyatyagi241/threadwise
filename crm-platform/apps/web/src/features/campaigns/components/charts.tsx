'use client';

import { cn } from '@crm/ui';

export { AreaChart, Donut, HBars } from '@/features/broadcasts/components/charts';

/** Sends per hour of the day as a strip of 24 cells shaded by volume (Reference's heatmap), with the busiest hour named. */
export function HourHeatmap({
  hours,
  label,
  empty,
}: {
  hours: Array<{ hour: number; sent: number; replies: number }>;
  label: string;
  empty: string;
}) {
  const max = Math.max(0, ...hours.map((h) => h.sent));
  if (max === 0) return <p className="py-6 text-center text-xs text-muted-foreground">{empty}</p>;
  return (
    <div role="img" aria-label={label}>
      <div
        className="grid grid-cols-12 gap-1 sm:grid-cols-24"
        style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
      >
        {hours.map((h) => {
          const level = h.sent === 0 ? 0 : Math.max(0.15, h.sent / max);
          return (
            <div
              key={h.hour}
              className="text-center"
              title={`${String(h.hour).padStart(2, '0')}:00 · ${h.sent}`}
            >
              <div
                className={cn(
                  'h-9 rounded-sm border border-border/60',
                  h.sent === 0 && 'bg-muted/50',
                )}
                style={
                  h.sent === 0
                    ? undefined
                    : {
                        background: `color-mix(in srgb, var(--brand) ${Math.round(level * 100)}%, transparent)`,
                      }
                }
              />
              <div className="mt-1 font-mono text-[9px] text-muted-foreground">
                {h.hour % 3 === 0 ? String(h.hour).padStart(2, '0') : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

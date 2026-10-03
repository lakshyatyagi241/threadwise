import { cn } from '@crm/ui';

/** Small SVG charts for the analytics screen (no chart library in the web app: the dashboards and broadcasts draw theirs the same way). */

const niceMax = (v: number) => {
  if (v <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
};

export interface Series {
  name: string;
  /** A CSS colour, normally a token (`var(--brand)`). */
  color: string;
  data: number[];
}

const W = 600;
const H = 280;
const PAD = { l: 40, r: 12, t: 12, b: 28 };

/** Lines with a soft fill on a shared scale, one per series; the x labels are thinned to fit. */
export function TrendChart({
  labels,
  series,
  label,
}: {
  labels: string[];
  series: Series[];
  label: string;
}) {
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.data)));
  const n = Math.max(labels.length, 1);
  const x = (i: number) =>
    PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (n - 1));
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const step = Math.max(1, Math.ceil(n / 8));
  const path = (data: number[]) =>
    data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
      {[0, 1, 2, 3, 4].map((k) => {
        const t = (max * k) / 4;
        return (
          <g key={k}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeDasharray="4"
            />
            <text
              x={PAD.l - 6}
              y={y(t) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--muted-foreground)"
            >
              {Math.round(t).toLocaleString()}
            </text>
          </g>
        );
      })}
      {labels.map((l, i) =>
        i % step === 0 ? (
          <text
            key={`${l}-${i}`}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize="11"
            fill="var(--muted-foreground)"
          >
            {l}
          </text>
        ) : null,
      )}
      {series.map((s) => (
        <g key={s.name}>
          {s.data.length > 1 && (
            <path
              d={`${path(s.data)} L${x(s.data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
              fill={s.color}
              opacity="0.1"
            />
          )}
          <path
            d={path(s.data)}
            fill="none"
            stroke={s.color}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          {s.data.length === 1 && <circle cx={x(0)} cy={y(s.data[0]!)} r="4" fill={s.color} />}
        </g>
      ))}
    </svg>
  );
}

export function Legend({
  items,
}: {
  items: Array<{ label: string; color: string; value?: number }>;
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-full"
            style={{ background: s.color }}
            aria-hidden="true"
          />
          {s.label}
          {s.value !== undefined && (
            <span className="tabular-nums">{s.value.toLocaleString()}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/** A ring split by value with a centre caption; slices of zero are skipped. */
export function Donut({
  slices,
  centre,
  caption,
  label,
}: {
  slices: Slice[];
  centre: string;
  caption: string;
  label: string;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const R = 70;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div>
      <svg
        viewBox="0 0 200 200"
        role="img"
        aria-label={label}
        className="mx-auto h-[200px] w-[200px]"
      >
        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--muted)" strokeWidth="26" />
        {total > 0 &&
          slices.map((s) => {
            if (s.value <= 0) return null;
            const len = (s.value / total) * C;
            const el = (
              <circle
                key={s.label}
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth="26"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 100 100)"
              />
            );
            offset += len;
            return el;
          })}
        <text x="100" y="98" textAnchor="middle" fontSize="26" fontWeight="600" fill="currentColor">
          {centre}
        </text>
        <text x="100" y="118" textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
          {caption}
        </text>
      </svg>
      <div className="mt-2 flex justify-center">
        <Legend items={slices} />
      </div>
    </div>
  );
}

/** One horizontal bar per row with its count; long labels wrap above the bar instead of overflowing. */
export function HBars({
  rows,
  color,
  label,
}: {
  rows: Array<{ label: string; value: number }>;
  color: string;
  label: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex items-start justify-between gap-3 text-xs">
            <span className="min-w-0 break-words">{r.label}</span>
            <span className={cn('font-mono tabular-nums')}>{r.value.toLocaleString()}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${(r.value / max) * 100}%`, background: color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

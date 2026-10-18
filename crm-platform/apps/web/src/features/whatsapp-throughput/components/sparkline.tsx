import type { WabaThroughputSeriesPoint } from '@crm/contracts';
import { sparkPoints } from '../lib/format';

/**
 * Sends over time as a line, with the points where sends were handed back or Meta throttled marked underneath. A plain SVG: the page
 * polls every few seconds and a charting library would redraw the whole thing each time.
 */
export function Sparkline({
  points,
  ceiling,
  label,
  width = 480,
  height = 64,
}: {
  points: readonly WabaThroughputSeriesPoint[];
  /** The number's paced rate: a dashed line at this height shows how close sending runs to it. */
  ceiling?: number;
  label: string;
  width?: number;
  height?: number;
}) {
  const line = sparkPoints(points, width, height - 8, ceiling);
  const max = Math.max(1, ceiling ?? 0, ...points.map((p) => p.sent));
  const ceilingY = ceiling ? height - 8 - (ceiling / max) * (height - 8) : null;
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      className="h-16 w-full text-primary"
      preserveAspectRatio="none"
    >
      {ceilingY !== null && (
        <line
          x1={0}
          x2={width}
          y1={ceilingY}
          y2={ceilingY}
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {line && (
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {points.map((p, i) =>
        p.metaThrottled > 0 ? (
          <rect
            key={`m${p.at}`}
            x={i * step - 1.5}
            y={height - 6}
            width={3}
            height={6}
            className="fill-danger"
          />
        ) : p.deferred > 0 ? (
          <rect
            key={`d${p.at}`}
            x={i * step - 1.5}
            y={height - 6}
            width={3}
            height={6}
            className="fill-warning"
          />
        ) : null,
      )}
    </svg>
  );
}

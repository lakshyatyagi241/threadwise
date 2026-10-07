/**
 * One tapered band of a funnel graph. Each band is a trapezoid centred in its row: it is as wide as `topPct` at the top and
 * narrows to `bottomPct` where the next stage begins, so stacked bands read as one continuous funnel. A zero stage draws a thin
 * muted sliver instead of vanishing. Purely visual: callers carry the labels and the accessible text.
 */
export function FunnelBand({
  topPct,
  bottomPct,
  strength,
  className = 'h-11',
}: {
  /** Width at the top edge, 0-100 (share of the first stage). */
  topPct: number;
  /** Width at the bottom edge, 0-100; never wider than the top. */
  bottomPct: number;
  /** 0-1, how solid the brand colour is (later stages fade). */
  strength: number;
  className?: string;
}) {
  const empty = topPct <= 0;
  const top = empty ? 4 : Math.max(4, Math.min(100, topPct));
  const bottom = Math.max(2, Math.min(top, bottomPct));
  const l0 = (100 - top) / 2;
  const r0 = 100 - l0;
  const l1 = (100 - bottom) / 2;
  const r1 = 100 - l1;
  return (
    <div
      aria-hidden
      className={`w-full ${empty ? 'bg-muted' : 'bg-primary'} ${className}`}
      style={{
        clipPath: `polygon(${l0}% 0, ${r0}% 0, ${r1}% 100%, ${l1}% 100%)`,
        opacity: empty ? 1 : strength,
      }}
    />
  );
}

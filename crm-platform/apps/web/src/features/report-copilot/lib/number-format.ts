export interface NumberStyle {
  unit?: string | undefined;
  prefix?: string | undefined;
  suffix?: string | undefined;
}

/**
 * A number the way the reader writes numbers: grouped by locale and lossless (up to six decimals), with its prefix and unit. Compact (1.2K) only when asked for.
 * A value that is not a finite number is a dash, never "NaN".
 */
export function formatNumber(
  value: number | string | null | undefined,
  locale: string,
  style: NumberStyle = {},
  opts: { compact?: boolean } = {},
): string {
  if (typeof value === 'string') return value.trim() === '' ? '–' : value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return '–';
  // Lossless by default: the figure the model read is the figure shown, grouped by locale and nothing more. Compact is opt-in (axis ticks).
  const compact = opts.compact ?? false;
  let body: string;
  try {
    body = new Intl.NumberFormat(locale, {
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : 6,
    }).format(value);
  } catch {
    body = String(value);
  }
  const unit = style.unit ?? '';
  const glue = unit && unit !== '%' ? ' ' : '';
  return `${style.prefix ?? ''}${body}${style.suffix ?? ''}${unit ? glue + unit : ''}`;
}

/** The exact value for a tooltip: no compacting. */
export const formatExact = (v: number, locale: string, style: NumberStyle = {}): string =>
  formatNumber(v, locale, style, { compact: false });

/** A change as text: a number is a signed percent, text is kept as written. */
export function formatDelta(delta: number | string | undefined, locale: string): string | null {
  if (delta === undefined) return null;
  if (typeof delta === 'string') return delta.trim() || null;
  if (!Number.isFinite(delta)) return null;
  const n = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(delta);
  return `${n}%`;
}

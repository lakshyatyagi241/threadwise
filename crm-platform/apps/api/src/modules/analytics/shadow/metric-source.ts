import { Logger } from '@nestjs/common';

/**
 * Where a screen's number comes from while it moves onto the rollups (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md,
 * section 9): `legacy` is the old live query, `shadow` serves the old query and also runs the new one to compare, `rollup` serves the new.
 */
export type MetricSource = 'legacy' | 'shadow' | 'rollup';

const logger = new Logger('AnalyticsShadow');

/** Reads one metric's source from `ANALYTICS_SOURCES`, a JSON map of metric key to source. Anything missing or invalid is `legacy`. */
export function sourceOf(
  key: string,
  raw: string | undefined = process.env.ANALYTICS_SOURCES,
): MetricSource {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'legacy';
    const value = (parsed as Record<string, unknown>)[key];
    return value === 'shadow' || value === 'rollup' ? value : 'legacy';
  } catch {
    return 'legacy';
  }
}

/** Structural equality for plain JSON-like values; `undefined` object properties are ignored. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (ao[k] === undefined && bo[k] === undefined) continue;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

export interface ServeOptions<T> {
  /** Overrides `ANALYTICS_SOURCES`, for tests. */
  source?: MetricSource;
  /** Defaults to `deepEqual`. Pass a tolerance for values that legitimately differ slightly. */
  equal?: (legacy: T, rollup: T) => boolean;
  onDiff?: (diff: { key: string; legacy: T; rollup: T }) => void;
  onError?: (key: string, err: unknown) => void;
}

/**
 * Serves a metric from the old query, the new one, or both. In `shadow` mode the caller always gets the legacy value: a difference or a
 * failure of the rollup query is logged and never reaches the user. A failing legacy query fails the request in every mode.
 */
export async function serve<T>(
  key: string,
  legacy: () => Promise<T>,
  rollup: () => Promise<T>,
  opts: ServeOptions<T> = {},
): Promise<T> {
  const source = opts.source ?? sourceOf(key);
  if (source === 'legacy') return legacy();
  if (source === 'rollup') return rollup();

  const [old, next] = await Promise.allSettled([legacy(), rollup()]);
  if (old.status === 'rejected') throw old.reason;
  if (next.status === 'rejected') {
    (opts.onError ?? defaultOnError)(key, next.reason);
  } else if (!(opts.equal ?? deepEqual)(old.value, next.value)) {
    (opts.onDiff ?? defaultOnDiff)({ key, legacy: old.value, rollup: next.value });
  }
  return old.value;
}

function defaultOnDiff(diff: { key: string; legacy: unknown; rollup: unknown }): void {
  logger.warn(diff, 'analytics shadow diff');
}

function defaultOnError(key: string, err: unknown): void {
  logger.warn({ key, err }, 'analytics shadow query failed');
}

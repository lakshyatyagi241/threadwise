/**
 * The number cap of the pilot (spec 10.3, D3): the server sends `used` and `limit` already reduced to the stricter of the plan
 * and the platform cap, so the screen never recomputes it. A missing, zero or negative limit means "no cap shown".
 */
export interface Cap {
  used: number;
  /** `null`: no cap to show. */
  limit: number | null;
  /** The next number would be refused: the connect button is disabled and says why. */
  full: boolean;
  remaining: number | null;
}

export function capIndicator(used: number, limit: number | null | undefined): Cap {
  const u = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return { used: u, limit: null, full: false, remaining: null };
  }
  const l = Math.floor(limit);
  return { used: u, limit: l, full: u >= l, remaining: Math.max(0, l - u) };
}

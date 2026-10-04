/**
 * Who a limit is counted against.
 *
 * - `ip`           the client address (`req.ip`, which follows `TRUST_PROXY`). For routes with no caller yet: login, public
 *                  forms, webhooks.
 * - `actor`        the authenticated caller (pool, org and id). Falls back to the address when the route is public.
 * - `actor-or-ip`  same as `actor`; the name says what happens on a route that can be called both ways.
 */
export type ThrottleSubject = 'ip' | 'actor' | 'actor-or-ip';

export interface ThrottleSpec {
  /** Requests allowed in one window. */
  limit: number;
  windowSeconds: number;
  by: ThrottleSubject;
}

/** What a caller may pass to `@Throttle()`: a policy name, or a spec with the optional parts left out. */
export type ThrottleInput =
  PolicyName | { limit: number; windowSeconds: number; by?: ThrottleSubject };

/**
 * Named policies (WD-INFRA-010). A policy is a number a reviewer can argue about in one place; routes name it instead of
 * repeating `10, 60` in forty controllers.
 *
 * Every counter is per route handler. WaDesk's unnamed `throttle:N,M` keyed only on user or address, so every throttled
 * route shared one bucket and a busy poll starved unrelated actions (WD-INFRA-010 QUIRK); here two routes with the same
 * policy still count separately.
 */
export const RATE_POLICIES = {
  /** Sign-in, password reset, one-time codes, anything an attacker can guess at. */
  auth: { limit: 10, windowSeconds: 60, by: 'ip' },
  /** Unauthenticated forms that write (contact, booking, checkout, coupon check). */
  'public-form': { limit: 20, windowSeconds: 60, by: 'ip' },
  /** Provider callbacks. High, because several tenants' traffic can arrive from one provider address. */
  webhook: { limit: 300, windowSeconds: 60, by: 'ip' },
  /** Screens that poll (inbox, notifications, health tiles). Per caller, not per address, so an office does not share it. */
  'ui-poll': { limit: 120, windowSeconds: 60, by: 'actor-or-ip' },
} as const satisfies Record<string, ThrottleSpec>;

export type PolicyName = keyof typeof RATE_POLICIES;

export function isPolicyName(value: string): value is PolicyName {
  return Object.prototype.hasOwnProperty.call(RATE_POLICIES, value);
}

/** Validates and fills in a `@Throttle()` argument. Throws at decoration time so a bad number fails at boot, not at 3am. */
export function resolveThrottle(input: ThrottleInput): ThrottleSpec {
  if (typeof input === 'string') {
    if (!isPolicyName(input)) throw new Error(`Unknown rate-limit policy "${String(input)}"`);
    return RATE_POLICIES[input];
  }
  if (!Number.isInteger(input.limit) || input.limit < 1) {
    throw new Error(`Rate limit must be a positive integer, got ${String(input.limit)}`);
  }
  if (!Number.isInteger(input.windowSeconds) || input.windowSeconds < 1) {
    throw new Error(
      `Rate-limit window must be a positive number of seconds, got ${String(input.windowSeconds)}`,
    );
  }
  return {
    limit: input.limit,
    windowSeconds: input.windowSeconds,
    by: input.by ?? 'actor-or-ip',
  };
}

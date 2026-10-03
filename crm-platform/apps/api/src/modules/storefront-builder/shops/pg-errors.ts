interface PgLike {
  code?: string;
  constraint?: string;
  cause?: PgLike;
}

/** The constraint a Postgres unique violation (23505) names, or null when the error is something else. Drizzle may wrap the driver error in `cause`. */
export function uniqueViolation(err: unknown): { constraint: string } | null {
  let e = err as PgLike | null;
  for (let depth = 0; e && depth < 4; depth += 1) {
    if (e.code === '23505') return { constraint: e.constraint ?? '' };
    e = e.cause ?? null;
  }
  return null;
}

export const SLUG_CONSTRAINT = 'uq_wa_storefronts_slug';
export const DOMAIN_CONSTRAINT = 'uq_wa_storefronts_custom_domain';

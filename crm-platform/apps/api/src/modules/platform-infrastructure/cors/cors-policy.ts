export type CorsOrigin = string[] | boolean;

/**
 * The `origin` option for the API's CORS (TW-INFRA-014).
 *
 * The API answers with `credentials: true`. A list of origins is the whole policy: those sites may call it from a browser.
 * With no list, what to do depends on where it runs:
 *
 * - development and test: allow any origin, so a local web app on any port works without configuration.
 * - production: allow none (`false`: no CORS headers at all, so browsers refuse cross-origin calls; same-origin and
 *   server-to-server calls are unaffected). Reflecting every origin together with credentials would let any website a user
 *   visits make authenticated calls as that user from their browser, and a missing environment variable must not be what
 *   switches that on.
 */
export function corsOriginFor(origins: readonly string[], nodeEnv: string): CorsOrigin {
  if (origins.length > 0) return [...origins];
  return nodeEnv === 'production' ? false : true;
}

/** True when production is running with no allowed origins, which is worth saying once at boot. */
export function corsIsClosedInProduction(origins: readonly string[], nodeEnv: string): boolean {
  return origins.length === 0 && nodeEnv === 'production';
}

/**
 * Where live exchange rates come from (TW-CPN-023). The domain asks for "units of each currency per one US dollar" and gets a
 * plain map; which vendor answers is the adapter's business, so swapping the free public API for a paid feed is one new file.
 */
export interface FxRates {
  /** Short vendor name for the audit trail and the success message, e.g. "open.er-api.com". */
  provider: string;
  /** ISO code -> units per 1 USD, as decimal strings (never floats on the way to the database). */
  rates: ReadonlyMap<string, string>;
}

export interface FxRateProvider {
  readonly name: string;
  /** Throws `FxRateError` with a message safe to show an operator when the provider cannot answer. */
  latest(): Promise<FxRates>;
}

export class FxRateError extends Error {}

export const FX_RATE_PROVIDER = Symbol('FX_RATE_PROVIDER');

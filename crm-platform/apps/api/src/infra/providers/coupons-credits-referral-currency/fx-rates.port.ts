/**
 * The port between the currency catalogue and whoever publishes exchange rates (WD-CPN-023). WaDesk called one free public API
 * inline from its controller; the domain only ever talks to this interface, so a different source (a paid feed, a central bank)
 * is one adapter file.
 *
 * `fetchUsdRates` returns units of each currency per ONE US dollar, keyed by upper-case ISO code, and throws an `FxRatesError`
 * with a sentence the operator can read when the source fails, answers with a non-2xx status, or returns no rates. The adapter
 * carries its own timeout.
 */
export const FX_RATES = Symbol('FX_RATES');

export interface FxRatesPort {
  /** Shown to the operator in the result ("Updated 25 currencies from open.er-api.com."). */
  readonly name: string;
  fetchUsdRates(): Promise<Record<string, number>>;
}

export class FxRatesError extends Error {}

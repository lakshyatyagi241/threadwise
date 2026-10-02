import { CASH_ROUNDING_INCREMENT_MINOR } from './currency';
import { DEFAULT_ROUNDING_MODE, roundToMultiple, type RoundingMode } from './rounding';

/**
 * Cash rounding: rounds a payable total to a coarser step than the minor unit (CHF 0.05, AUD 0.05, NZD 0.10 ...), or to a whole
 * major unit. The difference is reported as its own "rounding adjustment" line so the printed document still adds up.
 */
export interface CashRounding {
  /** Step in minor units (CHF 0.05 -> 5n). */
  incrementMinor: bigint;
  mode?: RoundingMode;
}

export function cashRoundingFor(
  currency: string,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE,
): CashRounding | null {
  const inc = CASH_ROUNDING_INCREMENT_MINOR[currency.toUpperCase()];
  return inc === undefined ? null : { incrementMinor: inc, mode };
}

export function applyCashRounding(
  totalMinor: bigint,
  rounding: CashRounding,
): { roundedMinor: bigint; adjustmentMinor: bigint } {
  const rounded = roundToMultiple(
    totalMinor,
    rounding.incrementMinor,
    rounding.mode ?? DEFAULT_ROUNDING_MODE,
  );
  return { roundedMinor: rounded, adjustmentMinor: rounded - totalMinor };
}

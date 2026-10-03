/**
 * Money of the wallet domain. Everything on the wire is an integer count of hundredths of the currency unit (WaDesk's "minor":
 * the rate grid stores 12.00 as 1200). The database holds the balance as a decimal in whole units; the conversion happens once,
 * in the ledger. No float ever carries an amount: input is parsed from text.
 */

/** "12", "12.5", "12.50" -> 1250. Null for anything that is not a plain non-negative amount with at most `maxDecimals` decimals. */
export function walletMajorToMinor(input: string | number, maxDecimals = 2): number | null {
  const text = typeof input === 'number' ? String(input) : input.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole = '0', frac = ''] = text.split('.');
  const trimmedFrac = frac.replace(/0+$/, '');
  if (trimmedFrac.length > maxDecimals) return null;
  const minor = Number(whole) * 100 + Number((trimmedFrac + '00').slice(0, 2));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 1250 -> "12.50"; -5 -> "-0.05". */
export function walletMinorToMajor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Meta's wholesale cost keeps four decimals ("0.0250"); stored as millionths of a unit so 0.004 is not rounded to 0.
 * "0.025" -> 25000. Null when not a plain amount or more than 6 decimals.
 */
export function majorToMicros(input: string | number): number | null {
  const text = typeof input === 'number' ? String(input) : input.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole = '0', frac = ''] = text.split('.');
  const trimmedFrac = frac.replace(/0+$/, '');
  if (trimmedFrac.length > 6) return null;
  const micros = Number(whole) * 1_000_000 + Number((trimmedFrac + '000000').slice(0, 6));
  return Number.isSafeInteger(micros) ? micros : null;
}

/** 25000 -> "0.025000" trimmed to at least 2 decimals: "0.025". */
export function microsToMajor(micros: number): string {
  const whole = Math.floor(micros / 1_000_000);
  let frac = String(micros % 1_000_000)
    .padStart(6, '0')
    .replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${whole}.${frac}`;
}

/** Micros to the whole-cent figure the reseller P&L reads (`meta_cost_minor`), rounded half up. */
export function microsToMinor(micros: number): number {
  return Math.round(micros / 10_000);
}

/** Hard limits, one place for the API and the forms. */
export const WALLET_LIMITS = {
  /** A single top-up or adjustment: 10,000,000.00. WaDesk had no maximum (WD-WALLET-016 rule 5). */
  maxAmountMinor: 1_000_000_000,
  minTopupMinor: 100,
  noteMin: 5,
  noteMax: 500,
  /** Price of one message in the rate grid, hundredths: 1,000,000.00. */
  maxPriceMinor: 100_000_000,
} as const;

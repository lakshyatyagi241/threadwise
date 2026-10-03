import { walletMajorToMinor, walletMinorToMajor, type WalletDirection } from '@crm/contracts';

/**
 * Money on the wire is an integer count of hundredths of the currency unit. It is turned into text first and Intl formats
 * the text itself, so no float ever holds an amount. A currency code the browser does not know falls back to the code.
 */
export function formatMinor(minor: number, currency: string, locale: string): string {
  const major = walletMinorToMajor(minor);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      // Intl accepts a decimal string and formats it exactly (ES2023 string numeric literals).
    }).format(major as unknown as number);
  } catch {
    return `${currency} ${major}`;
  }
}

/** An amount typed by a person ("250", "250.5") to hundredths; null when it is not a plain non-negative amount. */
export function parseAmount(text: string): number | null {
  return walletMajorToMinor(text.trim());
}

/** A whole-unit top-up amount ("1000"): at least 1, digits only. Null otherwise. */
export function parseTopupUnits(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,8}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

export type Tone = 'success' | 'danger' | 'neutral';

/** A movement is signed by its DIRECTION, never by the stored sign: WaDesk stored charges positive and showed them as money in. */
export function directionSign(direction: WalletDirection): '+' | '-' {
  return direction === 'out' ? '-' : '+';
}

export function directionTone(direction: WalletDirection): Tone {
  return direction === 'out' ? 'danger' : 'success';
}

export function formatMovement(
  amountMinor: number,
  direction: WalletDirection,
  currency: string,
  locale: string,
): string {
  return `${directionSign(direction)}${formatMinor(Math.abs(amountMinor), currency, locale)}`;
}

/** Tailwind text colour for a tone, from the design tokens. */
export const TONE_CLASS: Record<Tone, string> = {
  success: 'text-success',
  danger: 'text-danger',
  neutral: 'text-foreground',
};

/** The sign of a net figure for the "Net movement" card. */
export function formatNet(netMinor: number, currency: string, locale: string): string {
  const abs = formatMinor(Math.abs(netMinor), currency, locale);
  if (netMinor > 0) return `+${abs}`;
  if (netMinor < 0) return `-${abs}`;
  return abs;
}

/** The currency's symbol ("$", "₹"), or its code when the browser does not know it. */
export function currencySymbol(currency: string, locale: string): string {
  try {
    const part = new Intl.NumberFormat(locale, { style: 'currency', currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Quick-add amounts of the top-up box, in whole currency units. */
export const QUICK_ADD_UNITS = [500, 1000, 2000, 5000] as const;

/** Where "Add money" leads: the existing wallet checkout, carrying the amount in whole units. */
export const topupHref = (base: string, units: number): string => `${base}?amount=${units}`;

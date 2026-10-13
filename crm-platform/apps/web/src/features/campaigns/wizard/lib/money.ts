/** Prices come in hundredths of the billing currency ("minor units"); zero- and three-decimal currencies differ. */
export function minorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

export const minorToMajor = (minor: number, currency: string): number =>
  minor / 10 ** minorDigits(currency);

export function formatMinor(minor: number, currency: string, locale?: string): string {
  const value = minorToMajor(minor, currency);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** What a campaign has cost so far, as text: the amount in its currency, or a dash when there is no wallet currency to name it. */
export function costLabel(
  cost: { amountMinor: number; currency: string | null },
  locale?: string,
): string {
  return cost.currency ? formatMinor(cost.amountMinor, cost.currency, locale) : '—';
}

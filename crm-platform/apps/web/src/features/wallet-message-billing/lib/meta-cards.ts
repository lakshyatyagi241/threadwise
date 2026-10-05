import type { MetaCardCategory } from '@crm/contracts';

/** The largest Meta file the import accepts: Meta's own cards are about 20 KB. */
export const MAX_CARD_BYTES = 2 * 1024 * 1024;

/** The columns of the card table, in the order Meta lists them. */
export const CARD_COLUMNS: readonly MetaCardCategory[] = [
  'marketing',
  'utility',
  'authentication',
  'authentication_international',
  'service',
];

/** The file as base64, which is how a binary workbook travels in the JSON body. */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  // In slices: spreading a whole file into String.fromCharCode overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** True for the two kinds of file Meta's card comes as: the workbook, or a CSV saved from it. */
export function isCardFileName(name: string): boolean {
  return /\.(xlsx|csv)$/i.test(name);
}

/**
 * A cost as money in its own currency, keeping the small digits Meta prices in (₹0.8631, $0.0118): never rounded to cents,
 * which would turn a $0.0014 utility message into $0.00.
 */
export function formatCardCost(value: string | null, currency: string, locale: string): string {
  if (value === null) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(value as unknown as number);
  } catch {
    return `${currency} ${value}`;
  }
}

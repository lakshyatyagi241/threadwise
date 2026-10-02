import type { WabaConnection } from '@crm/contracts';

export type PillTone = 'success' | 'warning' | 'danger' | 'neutral';

/** Quality as Meta words it: GREEN / YELLOW / RED, anything else is unrated. */
export function qualityTone(q: string | null): PillTone {
  switch (q?.toUpperCase()) {
    case 'GREEN':
      return 'success';
    case 'YELLOW':
      return 'warning';
    case 'RED':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** `TIER_1K` -> `1K`, `TIER_UNLIMITED` -> `∞`; null when Meta has not said. */
export function tierLabel(tier: string | null): string | null {
  if (!tier) return null;
  const t = tier.replace(/^TIER_/i, '');
  return t.toUpperCase() === 'UNLIMITED' ? '∞' : t;
}

/** The card's title: verified name, then the label, then the number (WD-WABA-004). */
export function cardTitle(c: WabaConnection): string | null {
  return c.verifiedName || c.displayLabel || c.phoneNumber || null;
}

export const metaManagerUrl = (wabaId: string) =>
  `https://business.facebook.com/wa/manage/phone-numbers/?waba_id=${encodeURIComponent(wabaId)}`;

/** Meta can still report a number on the retired On-Premises API while the row says connected. */
export const isOnPremise = (c: WabaConnection) => c.platformType?.toUpperCase() === 'ON_PREMISE';

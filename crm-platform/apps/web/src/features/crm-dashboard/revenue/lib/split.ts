import type { DealTotals, RevenueGroup } from '@crm/contracts';
import { magnitude, moneyView } from '../../lib/format';

export const KNOWN_ORIGINS = [
  'manual',
  'quote',
  'order',
  'woocommerce',
  'shopify',
  'own',
  'api',
  'ai',
] as const;
export type KnownOrigin = (typeof KNOWN_ORIGINS)[number];

export const isKnownOrigin = (key: string): key is KnownOrigin =>
  (KNOWN_ORIGINS as readonly string[]).includes(key);

/** Whether a row of this grouping is named by its data (a person, a team, a product, a source) rather than by a fixed word. */
export const namedByData = (group: RevenueGroup): boolean => group !== 'origin';

/** The share of `part` in `whole`, 0 to 100 with one decimal, for the width of a bar; both are the figure the screen shows large. */
export function sharePercent(part: DealTotals, whole: DealTotals): number {
  const w = magnitude(whole);
  if (!(w > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((magnitude(part) / w) * 1000) / 10));
}

/** True when one bar can stand for these figures: a single currency (or all converted into one) and nothing left out. */
export function isOneScale(t: DealTotals): boolean {
  const v = moneyView(t);
  return v.primary !== null && v.missing.length === 0;
}

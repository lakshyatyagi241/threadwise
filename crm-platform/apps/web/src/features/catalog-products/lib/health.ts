import type { CatalogHealth } from '@crm/contracts';

export type HealthSample = CatalogHealth['samples'][number];
export type ScoreTone = 'good' | 'warn' | 'bad';

/** 90 or more is green, 70 to 89 amber, below 70 red (the colours of WaDesk's health badge). */
export function scoreTone(score: number): ScoreTone {
  if (score >= 90) return 'good';
  if (score >= 70) return 'warn';
  return 'bad';
}

export type HealthReason = 'noImage' | 'noPrice' | 'syncError';

/** Why a product is listed under "Show products to fix", in WaDesk's order. */
export function healthReasons(sample: HealthSample): HealthReason[] {
  const out: HealthReason[] = [];
  if (!sample.imageUrl) out.push('noImage');
  if (!sample.priceMinor) out.push('noPrice');
  if (sample.metaSyncStatus === 'error' || sample.metaSyncStatus === 'failed')
    out.push('syncError');
  return out;
}

/** The card is shown only when there is something to score. */
export const showHealth = (health: CatalogHealth): health is CatalogHealth & { score: number } =>
  health.total > 0 && health.score !== null;

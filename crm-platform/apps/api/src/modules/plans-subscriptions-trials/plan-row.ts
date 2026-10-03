import { sql, type SQL } from 'drizzle-orm';
import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  storedFeature,
  storedLimit,
  type PlanAdminItem,
  type PlanBillingUnit,
  type PlanFeatures,
  type PlanLimits,
} from '@crm/contracts';
import { planKind, type PlanFacts } from './plan-rules';

/** A `plans` row as `tx.execute` returns it (snake_case; numeric as string; timestamps as strings). */
export interface PlanRow {
  id: string | number;
  uuid: string;
  slug: string;
  name: string;
  subtitle: string | null;
  detail: string | null;
  kind: 'plan' | 'addon';
  amount: string;
  offer_amount: string | null;
  currency: string;
  billing_unit: PlanBillingUnit;
  billing_duration: number;
  is_free: boolean;
  is_lifetime: boolean;
  is_active: boolean;
  is_default: boolean;
  is_highlighted: boolean;
  is_custom_quote: boolean;
  sort_order: number;
  cta_label: string;
  data_retention_days: number;
  limits: Record<string, unknown>;
  features: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
}

/** Every column the catalogue reads, once, so a new column is added in one place. */
export const PLAN_COLUMNS: SQL = sql.raw(
  `id, uuid, slug, name, subtitle, detail, kind, amount::text AS amount, offer_amount::text AS offer_amount,
   currency, billing_unit, billing_duration, is_free, is_lifetime, is_active, is_default, is_highlighted,
   is_custom_quote, sort_order, cta_label, data_retention_days, limits, features, created_at, updated_at`,
);

export function toFacts(row: PlanRow): PlanFacts {
  return {
    id: row.uuid,
    slug: row.slug,
    name: row.name,
    subtitle: row.subtitle,
    amount: row.amount,
    offerAmount: row.offer_amount,
    currency: row.currency,
    billingUnit: row.billing_unit,
    billingDuration: row.billing_duration,
    isFree: row.is_free,
    isLifetime: row.is_lifetime,
    isActive: row.is_active,
    isDefault: row.is_default,
    isHighlighted: row.is_highlighted,
    isCustomQuote: row.is_custom_quote,
    sortOrder: row.sort_order,
    ctaLabel: row.cta_label,
    limits: row.limits,
    features: row.features,
  };
}

export function fullLimits(raw: unknown): PlanLimits {
  return Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, storedLimit(raw, k)])) as PlanLimits;
}

export function fullFeatures(raw: unknown): PlanFeatures {
  return Object.fromEntries(
    PLAN_FEATURE_KEYS.map((k) => [k, storedFeature(raw, k)]),
  ) as PlanFeatures;
}

const iso = (v: string | Date): string => new Date(v).toISOString();

export function toAdminItem(
  row: PlanRow,
  extra: { inUse: number; isRegistrationDefault: boolean },
): PlanAdminItem {
  const facts = toFacts(row);
  return {
    id: row.uuid,
    slug: row.slug,
    name: row.name,
    subtitle: row.subtitle,
    detail: row.detail,
    kind: planKind(facts),
    amount: row.amount,
    offerAmount: row.offer_amount,
    currency: row.currency,
    billingUnit: row.billing_unit,
    billingDuration: row.billing_duration,
    isFree: row.is_free,
    isLifetime: row.is_lifetime,
    isActive: row.is_active,
    isDefault: row.is_default,
    isHighlighted: row.is_highlighted,
    isCustomQuote: row.is_custom_quote,
    sortOrder: row.sort_order,
    ctaLabel: row.cta_label,
    dataRetentionDays: Number(row.data_retention_days),
    limits: fullLimits(row.limits),
    features: fullFeatures(row.features),
    inUse: extra.inUse,
    isRegistrationDefault: extra.isRegistrationDefault,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

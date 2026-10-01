import type { PlanAdminItem } from '@crm/contracts';
import { formatMoney, type PriceView } from '../../account/plans/plan-format';

/** The price cell of the catalogue table: the same views the workspace cards use, from the operator's item. */
export function adminPriceView(plan: PlanAdminItem, locale: string): PriceView {
  if (plan.kind === 'free') return { kind: 'free' };
  if (plan.kind === 'custom_quote') return { kind: 'custom' };
  const hasOffer = plan.offerAmount !== null;
  return {
    kind: 'paid',
    main: formatMoney(hasOffer ? plan.offerAmount! : plan.amount, plan.currency, locale),
    strike: hasOffer ? formatMoney(plan.amount, plan.currency, locale) : null,
    period: plan.isLifetime ? null : { unit: plan.billingUnit, count: plan.billingDuration },
    lifetime: plan.isLifetime,
  };
}

/** Cap shown in the table: 0 is "unlimited". */
export const capLabel = (
  value: number,
): { unlimited: true } | { unlimited: false; count: number } =>
  value > 0 ? { unlimited: false, count: value } : { unlimited: true };

/** Registration default dropdown: the active plans, in the catalogue's order. */
export function activePlanOptions(
  plans: readonly Pick<PlanAdminItem, 'slug' | 'name' | 'isActive' | 'kind'>[],
): Array<{ slug: string; name: string; kind: PlanAdminItem['kind'] }> {
  return plans.filter((p) => p.isActive).map((p) => ({ slug: p.slug, name: p.name, kind: p.kind }));
}

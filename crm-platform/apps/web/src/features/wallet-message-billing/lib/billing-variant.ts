import type { WalletSummary } from '@crm/contracts';

/**
 * Which "How billing works" text applies: the prepaid wallet pays every message; a plan with a monthly allowance explains that
 * allowance (and, when the plan has ended, that sending is paused); any other plan gets the generic text.
 */
export type BillingVariant = 'wallet' | 'planLimited' | 'planGeneric';

export function billingVariant(s: Pick<WalletSummary, 'billingMode' | 'plan'>): BillingVariant {
  if (s.billingMode === 'wallet') return 'wallet';
  return s.plan.monthlyMessagesLimit > 0 ? 'planLimited' : 'planGeneric';
}

/** A readable label for a ledger row that has no description: "message.sent" -> "Message sent". */
export function humanizeSource(source: string | null): string {
  if (!source) return '';
  const words = source.replace(/[._-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

import { minorToMajor, type MarketOperatorSubscription } from '@crm/contracts';
import { textRule, type TextRule } from './confirmations';
import { formatMoney } from './pricing';

/** The reason for a refund: 5 to 250 characters after trimming (the contract's bounds; the payment provider keeps it as a note). */
export const REFUND_REASON_MIN = 5;
export const REFUND_REASON_MAX = 250;

export interface RefundCheck {
  reason: TextRule;
  canSubmit: boolean;
}

export function refundCheck(reason: string): RefundCheck {
  const rule = textRule(reason, REFUND_REASON_MIN, REFUND_REASON_MAX);
  return { reason: rule, canSubmit: rule.ok };
}

/**
 * An amount the API sent in minor units as text, written as the language writes money. The text is turned into major units with the
 * currency's own exponent (no float), then formatted; no currency (nothing was paid through a gateway) is a dash.
 */
export function formatMinor(
  minor: string,
  currency: string | null | undefined,
  locale: string,
): string {
  if (!currency || !/^-?\d{1,18}$/.test(minor)) return '-';
  return formatMoney(minorToMajor(minor, currency), currency, locale);
}

/** Only a subscription that was bought with money and is still running has an unused share to return. */
export const canRefundUnused = (
  s: Pick<MarketOperatorSubscription, 'source' | 'status'>,
): boolean => s.source === 'purchase' && s.status !== 'ended';

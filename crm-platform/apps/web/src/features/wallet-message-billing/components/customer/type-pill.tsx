'use client';

import { useTranslations } from 'next-intl';
import type { WalletTxType } from '@crm/contracts';
import { Badge } from '@crm/ui';

const TONE = {
  topup: 'success',
  earn: 'success',
  refund: 'neutral',
  spend: 'danger',
  admin_adjust: 'warning',
} as const;

/** The movement type as a pill: Top-up, Earning, Refund, Message charge, Adjustment. */
export function TypePill({ type }: { type: WalletTxType }) {
  const t = useTranslations('wallet-message-billing.types');
  return <Badge tone={TONE[type]}>{t(type)}</Badge>;
}

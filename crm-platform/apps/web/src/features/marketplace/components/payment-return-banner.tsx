'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import { PAYMENT_RETURN_TONE, paymentReturnOutcome } from '../lib/payment-return';

/**
 * The line at the top of the app page after the buyer comes back from checkout: paid (the app is theirs), still being confirmed (the
 * provider has not said yet), not paid, or cancelled. Nothing is drawn without a known outcome in the address.
 */
export function PaymentReturnBanner() {
  const t = useTranslations('marketplace.paymentReturn');
  const outcome = paymentReturnOutcome(useSearchParams()?.get('payment'));
  if (!outcome) return null;
  return (
    <Alert tone={PAYMENT_RETURN_TONE[outcome]} data-testid="payment-return" data-outcome={outcome}>
      <p className="font-medium">{t(`${outcome}.title`)}</p>
      <p>{t(`${outcome}.message`)}</p>
    </Alert>
  );
}

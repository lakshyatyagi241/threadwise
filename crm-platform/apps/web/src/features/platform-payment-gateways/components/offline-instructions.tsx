'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Card } from '@crm/ui';
import { formatMoney } from '../lib/money';
import type { NextStep } from '../lib/next-action';
import { ProofForm } from './proof-form';

type Instructions = Extract<NextStep, { kind: 'instructions' }>;

/**
 * What to do after choosing a bank-transfer or offline gateway (TW-PAYGW-013): the account details, the order number as the
 * payment reference, then the receipt upload. The order waits for an operator's approval either way.
 */
export function OfflineInstructions({
  step,
  orderNumber,
  orderId,
}: {
  step: Instructions;
  orderNumber: string;
  orderId: string;
}) {
  const t = useTranslations('platform-payment-gateways.offline');
  const locale = useLocale();
  const router = useRouter();
  const done = () =>
    router.push(`/billing/orders?payment=pending&order=${encodeURIComponent(orderNumber)}`);
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t(`intro.${step.method}`)}</p>
      </header>
      <Card className="space-y-3 p-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('amount')}</dt>
          <dd className="font-semibold tabular-nums">
            {formatMoney(step.amount, step.currency, locale)}
          </dd>
          <dt className="text-muted-foreground">{t('reference')}</dt>
          <dd className="font-mono" data-testid="offline-reference">
            {orderNumber}
          </dd>
          {step.rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="break-words">{r.value}</dd>
            </div>
          ))}
        </dl>
        {step.notes && <p className="whitespace-pre-line text-sm">{step.notes}</p>}
        <Alert tone="info">{t('useReference')}</Alert>
      </Card>
      <Card className="space-y-3 p-4">
        <h2 className="font-medium">{t('proofTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('proofHelp')}</p>
        <ProofForm orderId={orderId} onDone={done} />
      </Card>
    </div>
  );
}

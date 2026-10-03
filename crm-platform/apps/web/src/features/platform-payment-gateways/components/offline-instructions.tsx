'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Card } from '@crm/ui';
import { formatMoney } from '../lib/money';
import type { NextStep } from '../lib/next-action';
import { ProofForm } from './proof-form';

type Instructions = Extract<NextStep, { kind: 'instructions' }>;

const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
const mono = (chunks: ReactNode) => <span className="font-mono">{chunks}</span>;

/**
 * What to do after choosing a bank-transfer or offline gateway (WD-PAYGW-013), laid out like WaDesk's checkout pages: the
 * account details (or the operator's instructions), the order number as the payment reference, then the receipt upload. The
 * order waits for an operator's approval either way.
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
  const amount = formatMoney(step.amount, step.currency, locale);
  const done = () =>
    router.push(`/billing/orders?payment=proof&order=${encodeURIComponent(orderNumber)}`);
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 py-8">
      <header className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t(`eyebrow.${step.method}`)}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{t(`title.${step.method}`)}</h1>
        <p className="text-sm text-muted-foreground">
          {step.method === 'bank_transfer'
            ? t.rich('intro.bank_transfer', { amount, ref: orderNumber, strong, mono })
            : t.rich('intro.offline', {
                amount,
                ref: orderNumber,
                currency: step.currency,
                strong,
                mono,
              })}
        </p>
      </header>

      {step.method === 'bank_transfer' ? (
        <Card className="space-y-3 p-6">
          {step.rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-4 text-sm">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                {r.label}
              </span>
              <span className="break-words font-mono">{r.value}</span>
            </div>
          ))}
          {step.notes && (
            <p className="mt-4 whitespace-pre-wrap border-t border-border pt-4 text-xs text-muted-foreground">
              {step.notes}
            </p>
          )}
        </Card>
      ) : (
        <Card className="space-y-2 p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('instructions')}
          </p>
          <p className="whitespace-pre-wrap text-sm" data-testid="offline-instructions">
            {step.notes}
          </p>
        </Card>
      )}

      {step.method === 'bank_transfer' && (
        <Alert tone="warning">{t.rich('referenceNote', { ref: orderNumber, strong, mono })}</Alert>
      )}

      <Card className="space-y-3 p-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {t('proofTitle')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('proofHelp')}</p>
        <ProofForm orderId={orderId} onDone={done} />
      </Card>

      <p>
        <Link
          href="/billing/orders"
          className="text-xs font-semibold text-muted-foreground hover:underline"
        >
          {t(`later.${step.method}`)}
        </Link>
      </p>
    </div>
  );
}

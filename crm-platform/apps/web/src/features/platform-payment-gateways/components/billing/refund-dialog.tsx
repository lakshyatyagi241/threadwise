'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { BILLING_KEYS, billingApi } from '../../billing-api';
import { minorToMajor, money, toMinorUnits } from '../../lib/billing-format';

const NS = 'platform-payment-gateways.billing.refund';

export type RefundTarget =
  | { kind: 'order'; id: string; label: string; currency: string; total: string }
  | { kind: 'subscription'; id: string; label: string; currency: string };

/**
 * Refund through the payment provider (TW-PAYGW-061). An order refunds the money paid for it; a subscription refunds one charge
 * the provider lists as paid. Empty amount = the rest of what was paid. The provider's answer is shown as it is (processed,
 * pending, or why it refused) so the operator never has to guess whether money moved.
 */
export function RefundDialog({
  target,
  locale,
  onClose,
}: {
  target: RefundTarget | null;
  locale: string;
  onClose: () => void;
}) {
  const t = useTranslations(NS);
  const tc = useTranslations('platform-payment-gateways.billing.common');
  const toast = useToast();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [endIt, setEndIt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subId = target?.kind === 'subscription' ? target.id : null;
  const charges = useQuery({
    queryKey: BILLING_KEYS.subscriptionCharges(subId ?? ''),
    queryFn: ({ signal }) => billingApi.subscriptionCharges(subId!, signal),
    enabled: subId !== null,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const paid = (charges.data?.data ?? []).filter((c) => c.status === 'paid' && c.paymentId);

  const reset = () => {
    setAmount('');
    setReason('');
    setPaymentId('');
    setEndIt(false);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const run = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('no target');
      const minor = amount.trim() ? toMinorUnits(amount, target.currency) : undefined;
      if (amount.trim() && !minor) throw new Error('bad_amount');
      const body = { reason: reason.trim(), ...(minor ? { amountMinor: minor } : {}) };
      return target.kind === 'order'
        ? billingApi.refundOrder(target.id, body)
        : billingApi.refundSubscription(target.id, {
            ...body,
            paymentId,
            endSubscription: endIt,
          });
    },
    onSuccess: (r) => {
      if (r.status === 'failed') {
        setError(r.failure ?? t('failed'));
        void qc.invalidateQueries({ queryKey: ['operator', 'billing'] });
        return;
      }
      toast.success(
        r.status === 'processed'
          ? t('processed', {
              amount: money(minorToMajor(r.amountMinor, r.currency), r.currency, locale),
            })
          : t('pending'),
      );
      void qc.invalidateQueries({ queryKey: ['operator', 'billing'] });
      close();
    },
    onError: (e) =>
      setError(
        e instanceof Error && e.message === 'bad_amount'
          ? t('badAmount')
          : e instanceof ApiError && (e.status === 422 || e.status === 502 || e.status === 404)
            ? e.message
            : tc('actionFailed'),
      ),
  });

  const ready =
    reason.trim().length >= 3 && (target?.kind === 'order' || paymentId !== '') && !run.isPending;

  return (
    <Modal
      open={target !== null}
      onClose={close}
      title={t('title', { label: target?.label ?? '' })}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={run.isPending}>
            {tc('cancel')}
          </Button>
          <Button variant="danger" disabled={!ready} onClick={() => run.mutate()}>
            {t('submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        {target?.kind === 'subscription' && (
          <Field label={t('charge')} htmlFor="refund-charge">
            {charges.isPending ? (
              <Spinner label={t('loadingCharges')} />
            ) : charges.isError ? (
              <Alert tone="danger">{t('chargesFailed')}</Alert>
            ) : paid.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noPaidCharges')}</p>
            ) : (
              <Select
                id="refund-charge"
                value={paymentId}
                onChange={(e) => setPaymentId(e.target.value)}
              >
                <option value="">{t('pickCharge')}</option>
                {paid.map((c) => (
                  <option key={c.id} value={c.paymentId ?? ''}>
                    {money(minorToMajor(c.amountMinor, c.currency), c.currency, locale)}
                    {c.paidAt ? ` · ${c.paidAt.slice(0, 10)}` : ''} · {c.paymentId}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field
          label={t('amount', { currency: target?.currency ?? '' })}
          htmlFor="refund-amount"
          hint={t('amountHint')}
        >
          <Input
            id="refund-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={target?.kind === 'order' ? target.total : ''}
          />
        </Field>
        <Field label={t('reason')} htmlFor="refund-reason">
          <Input
            id="refund-reason"
            maxLength={250}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {target?.kind === 'subscription' && (
          <Checkbox
            id="refund-end"
            checked={endIt}
            onChange={(e) => setEndIt(e.target.checked)}
            label={t('endSubscription')}
          />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

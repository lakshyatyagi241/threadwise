'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import type { StoreOrderDetail } from '@crm/contracts';
import { Alert, Button, Field, Input, Select, Spinner, Textarea, useToast } from '@crm/ui';
import { useUpdateOrderStatus } from '../api/hooks';
import { errorKind } from '../lib/errors';
import {
  buildStatusBody,
  initialStatusForm,
  isHttpUrl,
  isStatusFormDirty,
  type StatusFormValues,
} from '../lib/orders-detail';
import { ORDER_STATUSES, nextStatusSuggestion } from '../lib/status';
import { useErrorLine } from './parts';

/**
 * WaDesk "Update status": any status (there is no state machine), optional notes and an optional payment link. The buyer is
 * messaged when the status changed or a new link was typed; the result says whether that message went out. Mount it with
 * `key={order.rowVersion}` so a saved or reloaded order resets the form.
 */
export function OrderStatusForm({
  order,
  onReload,
}: {
  order: StoreOrderDetail;
  onReload: () => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.orderDetail.form');
  const ts = useTranslations('checkout-orders-merchant-payments.status');
  const { toast } = useToast();
  const errLine = useErrorLine();
  const update = useUpdateOrderStatus(order.id);
  const [form, setForm] = useState<StatusFormValues>(() => initialStatusForm(order));
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null);

  const link = form.paymentLink.trim();
  const linkInvalid = link !== '' && !isHttpUrl(link);
  const body = buildStatusBody(order, form);
  const dirty = isStatusFormDirty(order, form);
  const suggestion = nextStatusSuggestion(form.status);
  const known = (ORDER_STATUSES as readonly string[]).includes(order.status);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body || update.isPending) return;
    setError(null);
    update.mutate(body, {
      onSuccess: (res) =>
        toast(
          `${t('saved', { no: order.orderNo })} ${res.notified ? t('notified') : t('notNotified')}`,
        ),
      onError: (e2) => {
        const message = errLine(e2);
        setError({ message, conflict: errorKind(e2) === 'conflict' });
        toast(message, 'danger');
      },
    });
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-4 rounded-lg border border-border bg-background p-4 sm:p-5"
    >
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('status')}
          htmlFor="order-status"
          hint={suggestion ? t('suggestion', { status: ts(suggestion) }) : undefined}
        >
          <Select
            id="order-status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            {!known && <option value={order.status}>{order.status}</option>}
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ts(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={
            <>
              {t('paymentLink')}{' '}
              <span className="font-normal text-muted-foreground">({t('optional')})</span>
            </>
          }
          htmlFor="order-payment-link"
          hint={t('paymentLinkHint')}
          error={linkInvalid ? t('invalidLink') : undefined}
        >
          <Input
            id="order-payment-link"
            type="url"
            dir="ltr"
            inputMode="url"
            maxLength={1024}
            placeholder="https://rzp.io/..."
            value={form.paymentLink}
            invalid={linkInvalid}
            onChange={(e) => setForm({ ...form, paymentLink: e.target.value })}
          />
        </Field>
      </div>
      <Field label={t('notes')} htmlFor="order-notes">
        <Textarea
          id="order-notes"
          rows={3}
          maxLength={1000}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </Field>
      {error && (
        <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-2">
          <span>{error.message}</span>
          {error.conflict && (
            <Button variant="secondary" size="sm" onClick={onReload}>
              {t('reload')}
            </Button>
          )}
        </Alert>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={!body || !dirty || update.isPending}>
          {update.isPending && <Spinner />}
          {update.isPending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}

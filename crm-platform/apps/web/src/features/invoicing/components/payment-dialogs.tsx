'use client';

import { MANUAL_PAYMENT_METHODS, type InvoiceSummary, type PaymentOutcome, type PaymentResponse } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Field, Input, Modal, Select, Spinner, Textarea, useToast } from '@crm/ui';
import { invalidateInvoicing } from '../api/hooks';
import { invoicingApi } from '../api/service';
import { errorCode, fieldErrors } from '../lib/errors';
import { exponentOf, formatMoney, minorToInput } from '../lib/money';
import { checkPayment, checkRefund, NOTE_MAX, REFERENCE_MAX } from '../lib/payments';
import { invoiceMinor, majorToMinor } from '../lib/wire';
import { useErrorText, useToday } from './parts';
import { useInvoiceActions, type ManualMethod } from './use-invoice-actions';

const REASON_MAX = 500;
type PayTarget = Pick<InvoiceSummary, 'id' | 'number' | 'currency' | 'amountsMinor'>;

/**
 * "Record payment". The amount (a major-units string) starts at what the invoice still owes; paying less records a partial
 * payment, paying more asks for a second look and is sent with `allowOverpayment` only after the person confirms (the server
 * answers 422 PAY_OVERPAYMENT otherwise). Mount it only while it is open: it starts from the invoice every time.
 */
export function RecordPaymentDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: PayTarget;
  onClose: () => void;
  onDone?: (outcome: PaymentOutcome) => void;
}) {
  const t = useTranslations('invoicing.payDialog');
  const tm = useTranslations('invoicing.method');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const today = useToday();
  const balance = invoiceMinor(invoice).balance;
  const [amount, setAmount] = useState(minorToInput(balance, invoice.currency));
  const [method, setMethod] = useState<ManualMethod>('bank');
  const [paidAt, setPaidAt] = useState(today);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [confirmOver, setConfirmOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const check = checkPayment({ amount, paidAt, reference, note }, invoice.currency, balance, today);
  const partial = check.amountMinor !== null && check.amountMinor < balance;

  async function submit() {
    if (Object.keys(check.problems).length > 0 || check.amount === null || check.amountMinor === null) {
      setErrors({
        amount: check.problems.amount && t(`problems.${check.problems.amount}`),
        paidAt: check.problems.paidAt && t(`problems.${check.problems.paidAt}`),
        reference: check.problems.reference && t(`problems.${check.problems.reference}`),
        note: check.problems.note && t(`problems.${check.problems.note}`),
      });
      return;
    }
    if (check.overpays && !confirmOver) {
      setConfirmOver(true);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const outcome = await invoicingApi.recordPayment(invoice.id, {
        amount: check.amount,
        method,
        paidAt,
        reference: reference.trim() || null,
        note: note.trim() || null,
        allowOverpayment: check.overpays,
      });
      await invalidateInvoicing(qc);
      toast(t('recorded', { amount: formatMoney(check.amountMinor, invoice.currency, locale) }));
      onDone?.(outcome);
      onClose();
    } catch (e) {
      const server = fieldErrors(e);
      const code = errorCode(e);
      setConfirmOver(false);
      setErrors({
        amount:
          code === 'PAY_OVERPAYMENT' || code === 'PAY_NOTHING_TO_PAY' ? errorText(e) : server.amount ? t('problems.amountInvalid') : undefined,
        paidAt: code === 'PAY_FUTURE_DATE' ? errorText(e) : server.paidAt ? t('problems.dateInvalid') : undefined,
        form:
          code === 'PAY_OVERPAYMENT' || code === 'PAY_NOTHING_TO_PAY' || code === 'PAY_FUTURE_DATE'
            ? undefined
            : Object.keys(server).length === 0 || code === 'PAY_CURRENCY_MISMATCH'
              ? errorText(e)
              : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="md"
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={invoice.number ? t('forInvoice', { number: invoice.number }) : undefined}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="brand" onClick={() => void submit()} disabled={busy}>
            {busy && <Spinner />}
            {confirmOver ? t('recordAnyway') : t('record')}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {errors.form && (
          <Alert tone="danger" className="sm:col-span-2">
            {errors.form}
          </Alert>
        )}
        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm sm:col-span-2">
          <span className="text-muted-foreground">{t('balance')}</span>
          <span dir="ltr" className="font-semibold tabular-nums">
            {formatMoney(balance, invoice.currency, locale)}
          </span>
        </div>
        <Field label={t('amount', { currency: invoice.currency })} htmlFor="pay-amount" error={errors.amount}>
          <Input
            id="pay-amount"
            inputMode="decimal"
            autoFocus
            dir="ltr"
            value={amount}
            invalid={!!errors.amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setConfirmOver(false);
            }}
          />
        </Field>
        <Field label={t('method')} htmlFor="pay-method">
          <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as ManualMethod)}>
            {MANUAL_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {tm(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('paidOn')} htmlFor="pay-date" error={errors.paidAt}>
          <Input
            id="pay-date"
            type="date"
            max={today}
            value={paidAt}
            invalid={!!errors.paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
          />
        </Field>
        <Field label={t('reference')} htmlFor="pay-ref" hint={t('referenceHint')} error={errors.reference}>
          <Input
            id="pay-ref"
            maxLength={REFERENCE_MAX + 20}
            value={reference}
            invalid={!!errors.reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
        <Field label={t('note')} htmlFor="pay-note" className="sm:col-span-2" error={errors.note}>
          <Textarea id="pay-note" rows={2} maxLength={NOTE_MAX + 50} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {partial && !errors.amount && (
          <Alert tone="info" className="sm:col-span-2">
            {t('partialNote', { left: formatMoney(balance - (check.amountMinor ?? 0), invoice.currency, locale) })}
          </Alert>
        )}
        {check.overpays && (
          <Alert tone="warning" className="sm:col-span-2">
            {t(confirmOver ? 'overpayConfirm' : 'overpayNote', {
              extra: formatMoney((check.amountMinor ?? 0) - balance, invoice.currency, locale),
            })}
          </Alert>
        )}
      </form>
    </Modal>
  );
}

/**
 * "Mark as paid": one confirm records the whole balance as received today by the chosen method. Nothing else is asked; use
 * "Record payment" for a part payment, another date or a reference.
 */
export function MarkPaidDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: PayTarget;
  onClose: () => void;
  onDone?: (outcome: PaymentOutcome) => void;
}) {
  const t = useTranslations('invoicing.markPaidDialog');
  const tm = useTranslations('invoicing.method');
  const locale = useLocale();
  const errorText = useErrorText();
  const actions = useInvoiceActions();
  const [method, setMethod] = useState<ManualMethod>('bank');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const balance = invoiceMinor(invoice).balance;

  async function confirm() {
    setError(null);
    setBusy(true);
    const r = await actions.markPaid(invoice, method, { quiet: true });
    setBusy(false);
    if (r.ok) {
      onDone?.(r.value);
      onClose();
    } else setError(r.error);
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={invoice.number ?? undefined}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="brand" onClick={() => void confirm()} disabled={busy || balance <= 0}>
            {busy && <Spinner />}
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm">
          {t('message', { amount: formatMoney(balance, invoice.currency, locale) })}
        </p>
        <Field label={t('method')} htmlFor="markpaid-method">
          <Select id="markpaid-method" value={method} onChange={(e) => setMethod(e.target.value as ManualMethod)}>
            {MANUAL_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {tm(m)}
              </option>
            ))}
          </Select>
        </Field>
        {error !== null && <Alert tone="danger">{errorText(error)}</Alert>}
      </div>
    </Modal>
  );
}

/**
 * Refund of all or part of one payment. The amount starts at what is still refundable and can never exceed it; the invoice owes
 * the refunded amount again (a mistake in the ledger is corrected by a refund, never by editing).
 */
export function RefundDialog({
  payment,
  onClose,
  onDone,
}: {
  payment: PaymentResponse;
  onClose: () => void;
  onDone?: (outcome: PaymentOutcome) => void;
}) {
  const t = useTranslations('invoicing.refundDialog');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const today = useToday();
  const refundable = majorToMinor(payment.refundable, exponentOf(payment.currency));
  const [amount, setAmount] = useState(minorToInput(refundable, payment.currency));
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const c = checkRefund(amount, payment.currency, refundable);
    if (c.amount === null || c.amountMinor === null) {
      setErrors({ amount: t(`problems.${c.problem ?? 'amountInvalid'}`) });
      return;
    }
    if (date > today) {
      setErrors({ date: t('problems.dateFuture') });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const outcome = await invoicingApi.refund(payment.id, {
        amount: c.amount,
        reason: reason.trim() || null,
        paidAt: date,
      });
      await invalidateInvoicing(qc);
      toast(t('refunded', { amount: formatMoney(c.amountMinor, payment.currency, locale) }));
      onDone?.(outcome);
      onClose();
    } catch (e) {
      const code = errorCode(e);
      setErrors(
        code === 'PAY_REFUND_EXCEEDS'
          ? { amount: errorText(e) }
          : code === 'PAY_FUTURE_DATE'
            ? { date: errorText(e) }
            : { form: errorText(e) },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={payment.invoice?.number ?? undefined}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="danger" onClick={() => void submit()} disabled={busy || refundable <= 0}>
            {busy && <Spinner />}
            {t('refund')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <p className="text-sm text-muted-foreground">
          {t('available', { amount: formatMoney(refundable, payment.currency, locale) })}
        </p>
        <Field label={t('amount', { currency: payment.currency })} htmlFor="refund-amount" error={errors.amount}>
          <Input
            id="refund-amount"
            inputMode="decimal"
            autoFocus
            dir="ltr"
            value={amount}
            invalid={!!errors.amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label={t('date')} htmlFor="refund-date" error={errors.date}>
          <Input id="refund-date" type="date" max={today} value={date} invalid={!!errors.date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('reason')} htmlFor="refund-reason">
          <Textarea id="refund-reason" rows={2} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <p className="text-xs text-muted-foreground">{t('effect')}</p>
      </form>
    </Modal>
  );
}

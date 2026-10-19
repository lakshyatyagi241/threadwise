'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MarketOperatorApp,
  MarketOperatorSubscription,
  MarketWithdrawnRefund,
} from '@crm/contracts';
import { Alert, Button, Checkbox, Modal, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { marketKeys, prorateSubscription, refundWithdrawnApp } from '../api';
import { formatMinor, refundCheck } from '../lib/refunds';
import { NoteField } from './comp-fields';
import { ErrorLine } from './ui';

/** What a change of money makes stale: the subscriptions, their revenue and the listing. */
function useRefreshMoney() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: marketKeys.subscriptionsAll });
    void qc.invalidateQueries({ queryKey: marketKeys.subscriptionSummary });
    void qc.invalidateQueries({ queryKey: marketKeys.appsAll });
    void qc.invalidateQueries({ queryKey: marketKeys.appDetailsAll });
  };
}

// --- one subscription ----------------------------------------------------------------------------------------------------------------

/**
 * Returns the unused share of the last payment of one subscription (an operator action, super admins only). The amount is worked out by the
 * API with a dry run when the dialog opens, so the operator sees what will be returned before pressing the button; nothing is refunded
 * twice, because the tool subtracts what was already returned. Optionally ends the subscription now once the refund went through.
 */
export function ProrateDialog({
  subscription,
  onClose,
}: {
  subscription: MarketOperatorSubscription;
  onClose: () => void;
}) {
  const t = useTranslations('marketplace.operator.prorateDialog');
  const locale = useLocale();
  const toast = useToast();
  const refresh = useRefreshMoney();
  const [reason, setReason] = useState('');
  const [endNow, setEndNow] = useState(false);
  const check = refundCheck(reason);
  const formId = 'prorate-form';
  const names = { workspace: subscription.workspace.name, app: subscription.app.name };

  const preview = useQuery({
    queryKey: ['market-operator', 'prorate', subscription.id],
    queryFn: () => prorateSubscription(subscription.id, { dryRun: true }),
    refetchOnWindowFocus: false,
    retry: false,
  });
  const quote = preview.data;
  const owed = quote ? BigInt(quote.refundableMinor) : 0n;
  const money = (minor: string) => formatMinor(minor, quote?.currency, locale);

  const run = useMutation({
    mutationFn: () =>
      prorateSubscription(subscription.id, { dryRun: false, reason: reason.trim(), endNow }),
    onSuccess: (r) => {
      refresh();
      if (r.refund?.status === 'failed') return;
      toast.success(t('done', { ...names, amount: money(r.refundableMinor) }));
      onClose();
    },
    onError: () => refresh(),
  });
  const failed = run.data?.refund?.status === 'failed' ? run.data.refund.failure : null;

  return (
    <Modal
      open
      size="md"
      eyebrow={t('eyebrow')}
      title={t('title', { workspace: subscription.workspace.name })}
      closeLabel={t('close')}
      onClose={() => {
        if (!run.isPending) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={run.isPending}>
            {t('back')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="danger"
            disabled={!check.canSubmit || owed <= 0n || run.isPending}
          >
            {run.isPending && <Spinner />}
            {t('confirm', { amount: money(quote?.refundableMinor ?? '0') })}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (check.canSubmit && owed > 0n) run.mutate();
        }}
      >
        <p className="text-muted-foreground" dir="auto">
          {t('summary', names)}
        </p>
        {preview.isPending && (
          <p className="flex items-center gap-2 text-muted-foreground" role="status">
            <Spinner /> {t('working')}
          </p>
        )}
        {preview.isError && <ErrorLine error={preview.error} />}
        {quote && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1" data-testid="prorate-figures">
            <dt>{t('paid')}</dt>
            <dd className="text-end tabular-nums">{money(quote.paidMinor)}</dd>
            <dt>{t('unused')}</dt>
            <dd className="text-end tabular-nums">{money(quote.unusedMinor)}</dd>
            <dt>{t('already')}</dt>
            <dd className="text-end tabular-nums">{money(quote.alreadyRefundedMinor)}</dd>
            <dt className="font-medium">{t('refundable')}</dt>
            <dd className="text-end font-medium tabular-nums" data-testid="prorate-refundable">
              {money(quote.refundableMinor)}
            </dd>
          </dl>
        )}
        {quote && owed <= 0n && (
          <Alert tone="info" data-testid="prorate-nothing">
            {t('nothing')}
          </Alert>
        )}
        {quote && owed > 0n && (
          <>
            <Checkbox
              id="prorate-end"
              label={
                <span>
                  {t('endNow')}
                  <span className="block text-xs text-muted-foreground">{t('endNowHint')}</span>
                </span>
              }
              checked={endNow}
              disabled={run.isPending}
              onChange={(e) => setEndNow(e.target.checked)}
            />
            <NoteField
              id="prorate-reason"
              label={t('reason')}
              value={reason}
              rule={check.reason}
              disabled={run.isPending}
              onChange={setReason}
            />
          </>
        )}
        {failed ? <Alert tone="danger">{t('refused', { reason: failed })}</Alert> : null}
        <ErrorLine error={run.error} />
      </form>
    </Modal>
  );
}

// --- a withdrawn app -------------------------------------------------------------------------------------------------------------------

/**
 * Returns every subscriber of a withdrawn app the share of their last payment from the moment it was withdrawn. Step one is a dry run (how
 * many are owed and how much per currency); step two, after the operator has looked, does it. A run handles up to 200 subscriptions and says
 * when there are more; running again continues where it stopped and never returns the same money twice.
 */
export function WithdrawnRefundDialog({
  app,
  onClose,
}: {
  app: Pick<MarketOperatorApp, 'slug' | 'name'>;
  onClose: () => void;
}) {
  const t = useTranslations('marketplace.operator.withdrawnRefund');
  const locale = useLocale();
  const toast = useToast();
  const refresh = useRefreshMoney();
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<MarketWithdrawnRefund | null>(null);
  const [last, setLast] = useState<MarketWithdrawnRefund | null>(null);
  const check = refundCheck(reason);
  const formId = 'withdrawn-refund-form';

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      refundWithdrawnApp(app.slug, {
        dryRun,
        reason: reason.trim(),
        ...(!dryRun && last?.next ? { after: last.next } : {}),
      }),
    onSuccess: (r) => {
      if (r.dryRun) {
        setPreview(r);
        return;
      }
      refresh();
      setLast(r);
      toast.success(t('done', { count: r.refunded, name: app.name }));
      if (!r.hasMore) onClose();
    },
    onError: () => refresh(),
  });
  const busy = run.isPending;
  const shown = last ?? preview;
  const totals = (shown?.totals ?? []).map((x) => formatMinor(x.amountMinor, x.currency, locale));

  return (
    <Modal
      open
      size="md"
      eyebrow={t('eyebrow')}
      title={t('title', { name: app.name })}
      closeLabel={t('close')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          {preview ? (
            <Button
              variant="danger"
              disabled={busy || !check.canSubmit || preview.refundable === 0}
              onClick={() => run.mutate(false)}
            >
              {busy && <Spinner />}
              {last?.hasMore ? t('continue') : t('run', { count: preview.refundable })}
            </Button>
          ) : (
            <Button type="submit" form={formId} disabled={busy}>
              {busy && <Spinner />}
              {t('preview')}
            </Button>
          )}
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!preview) run.mutate(true);
        }}
      >
        <p className="text-muted-foreground" dir="auto">
          {t('intro', { name: app.name })}
        </p>
        {shown && (
          <section aria-live="polite" className="space-y-2 rounded-md border border-border p-3">
            <h3 className="font-medium" data-testid="withdrawn-owed">
              {t('owed', { count: shown.refundable })}
            </h3>
            {totals.length > 0 && (
              <p className="tabular-nums" dir="auto" data-testid="withdrawn-totals">
                {totals.join(' + ')}
              </p>
            )}
            {last && (
              <p className="text-xs text-muted-foreground">
                {t('result', { refunded: last.refunded, failed: last.failed })}
              </p>
            )}
            {shown.hasMore && <p className="text-xs text-muted-foreground">{t('more')}</p>}
            {shown.refundable === 0 && <p className="text-muted-foreground">{t('nobody')}</p>}
          </section>
        )}
        {preview && preview.refundable > 0 && (
          <NoteField
            id="withdrawn-reason"
            label={t('reason')}
            value={reason}
            rule={check.reason}
            disabled={busy}
            onChange={setReason}
          />
        )}
        {last && last.failed > 0 && <Alert tone="danger">{t('someFailed')}</Alert>}
        <ErrorLine error={run.error} />
      </form>
    </Modal>
  );
}

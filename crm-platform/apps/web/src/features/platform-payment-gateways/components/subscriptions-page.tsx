'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubscriptionItem } from '@crm/contracts';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import {
  SUBSCRIPTIONS_KEY,
  cancelSubscription,
  fetchSubscriptionCharges,
  fetchSubscriptions,
  subscriptionChargesKey,
  syncSubscription,
} from '../api';
import { formatMoney } from '../lib/money';

const NS = 'platform-payment-gateways.subscriptions';
const TONE: Record<SubscriptionItem['status'], 'success' | 'danger' | 'warning' | 'neutral'> = {
  active: 'success',
  past_due: 'danger',
  pending: 'warning',
  canceled: 'neutral',
  expired: 'neutral',
};

/**
 * My subscriptions (TW-PAYGW-060): every plan and add-on subscription this workspace has with the payment provider, whether it
 * renews and when it is paid until, a failed-payment warning, what the provider charged cycle by cycle (with receipts), a
 * refresh from the provider, and a cancel that keeps the paid period.
 */
export function SubscriptionsPage() {
  const t = useTranslations(NS);
  const { permissions } = useSession();
  const canManage = 'plan.subscription.manage' in permissions;
  const q = useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: ({ signal }) => fetchSubscriptions(signal),
    refetchOnWindowFocus: false,
  });
  const items = q.data?.data ?? [];
  const failing = items.filter((s) => s.paymentFailed);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {failing.length > 0 && (
        <Alert tone="danger" data-testid="payment-failed-banner">
          {t('failedBanner', { names: failing.map((s) => s.name).join(', ') })}
        </Alert>
      )}

      {q.isPending ? (
        <div className="flex min-h-40 items-center justify-center text-muted-foreground">
          <Spinner label={t('loading')} />
        </div>
      ) : q.isError ? (
        <Alert tone="danger">{t('loadFailed')}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          message={t('emptyMessage')}
          actions={
            <Link className="text-sm underline" href="/account/plans">
              {t('browsePlans')}
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map((s) => (
            <SubscriptionCard key={s.id} item={s} canManage={canManage} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SubscriptionCard({ item: s, canManage }: { item: SubscriptionItem; canManage: boolean }) {
  const t = useTranslations(NS);
  const locale = useLocale();
  const timeZone = useTimeZone();
  const qc = useQueryClient();
  const [showCharges, setShowCharges] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<{ tone: 'success' | 'info' | 'danger'; text: string } | null>(
    null,
  );
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'long' }).format(new Date(iso));

  const refresh = () => qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
  const sync = useMutation({
    mutationFn: () => syncSubscription(s.id),
    onSuccess: async (r) => {
      setNote({
        tone: r.outcome === 'up_to_date' ? 'info' : 'success',
        text: t(
          `sync.${['up_to_date', 'renewed', 'gateway_canceled', 'gateway_expired'].includes(r.outcome) ? r.outcome : 'unknown'}`,
        ),
      });
      await refresh();
      void qc.invalidateQueries({ queryKey: subscriptionChargesKey(s.id) });
    },
    onError: () => setNote({ tone: 'danger', text: t('sync.failed') }),
  });
  const cancel = useMutation({
    mutationFn: () => cancelSubscription(s.id),
    onSuccess: async () => {
      setConfirm(false);
      setNote({ tone: 'success', text: t('cancelDone') });
      await refresh();
    },
    onError: (e) => {
      setConfirm(false);
      setNote({
        tone: 'danger',
        text: e instanceof ApiError && e.status === 403 ? t('forbidden') : t('cancelFailed'),
      });
    },
  });

  const live = s.status === 'active' || s.status === 'past_due';
  return (
    <li className="rounded-lg border border-border p-4" data-testid="subscription-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{s.name}</span>
            <Badge tone="neutral">{t(`kind.${s.kind}`)}</Badge>
            <Badge tone={TONE[s.status]}>{t(`status.${s.status}`)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('price', {
              amount: formatMoney(s.amount, s.currency, locale),
              cycle: t(`cycle.${s.billingCycle}`),
            })}
            {' · '}
            {s.gateway}
          </p>
          {s.currentPeriodEnd && (
            <p className="text-sm" data-testid="period-line">
              {s.autoRenew
                ? t('renewsOn', { date: date(s.currentPeriodEnd) })
                : live || s.canceledAt
                  ? t('endsOn', { date: date(s.currentPeriodEnd) })
                  : t('endedOn', { date: date(s.currentPeriodEnd) })}
            </p>
          )}
          {s.paymentFailed && <p className="text-sm text-danger">{t('paymentFailed')}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={sync.isPending}
            onClick={() => {
              setNote(null);
              sync.mutate();
            }}
          >
            {t('refreshFromProvider')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowCharges((v) => !v)}>
            {showCharges ? t('hideCharges') : t('showCharges')}
          </Button>
          {canManage && s.autoRenew && (
            <Button
              size="sm"
              variant="secondary"
              className="border-danger/40 text-danger"
              onClick={() => {
                setNote(null);
                setConfirm(true);
              }}
            >
              {t('cancel')}
            </Button>
          )}
        </div>
      </div>
      {note && (
        <div className="mt-3">
          <Alert tone={note.tone}>{note.text}</Alert>
        </div>
      )}
      {showCharges && <Charges id={s.id} />}
      <ConfirmDialog
        open={confirm}
        title={t('confirmTitle', { name: s.name })}
        message={
          s.currentPeriodEnd
            ? t('confirmBody', { date: date(s.currentPeriodEnd) })
            : t('confirmBodyNoDate')
        }
        confirmLabel={t('confirm')}
        cancelLabel={t('keep')}
        tone="danger"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onClose={() => setConfirm(false)}
      />
    </li>
  );
}

function Charges({ id }: { id: string }) {
  const t = useTranslations(NS);
  const locale = useLocale();
  const timeZone = useTimeZone();
  const q = useQuery({
    queryKey: subscriptionChargesKey(id),
    queryFn: ({ signal }) => fetchSubscriptionCharges(id, signal),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) {
    return (
      <div className="mt-3 flex justify-center text-muted-foreground">
        <Spinner label={t('loading')} />
      </div>
    );
  }
  if (q.isError)
    return (
      <div className="mt-3">
        <Alert tone="danger">{t('chargesFailed')}</Alert>
      </div>
    );
  const rows = q.data.data;
  return (
    <div className="mt-3 space-y-2">
      {q.data.source === 'orders' && <Alert tone="info">{t('chargesFromOrders')}</Alert>}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noCharges')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-start text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start">{t('col.date')}</th>
                <th className="px-3 py-2 text-end">{t('col.amount')}</th>
                <th className="px-3 py-2 text-start">{t('col.status')}</th>
                <th className="px-3 py-2 text-end">{t('col.receipt')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const when = c.paidAt ?? c.issuedAt;
                return (
                  <tr key={c.id} className="border-t border-border" data-testid="charge-row">
                    <td className="px-3 py-2">
                      {when
                        ? new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium' }).format(
                            new Date(when),
                          )
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {formatMoney(c.amount, c.currency, locale)}
                    </td>
                    <td className="px-3 py-2">{t(`chargeStatus.${c.status}`)}</td>
                    <td className="px-3 py-2 text-end">
                      {c.receiptUrl ? (
                        <a
                          className="underline"
                          href={c.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t('openReceipt')}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

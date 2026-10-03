'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BillingSubscription } from '@crm/contracts';
import { Alert, Button, ConfirmDialog } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { BILLING_KEYS, cancelAutoRenew } from '../api';

const NS = 'plans-subscriptions-trials.plans.renewal';

/**
 * The auto-renew line and its "Cancel auto-renew" button (WD-PLAN-012). Shown only while a renewing subscription exists; cancelling keeps the
 * paid period, so the confirmation says so. After it the line disappears (the next read reports no subscription).
 */
export function CancelRenewal({
  subscription,
  canManage,
  compact = false,
}: {
  subscription: BillingSubscription;
  canManage: boolean;
  /** Only the button and its confirmation (the top bar already says when the plan renews). */
  compact?: boolean;
}) {
  const t = useTranslations(NS);
  const locale = useLocale();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const cancel = useMutation({
    mutationFn: cancelAutoRenew,
    onSuccess: async () => {
      setDone(true);
      setOpen(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: BILLING_KEYS.plans }),
        qc.invalidateQueries({ queryKey: BILLING_KEYS.status }),
      ]);
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.status === 403
          ? t('forbidden')
          : e instanceof ApiError && e.code === 'PLAN_NO_SUBSCRIPTION'
            ? t('none')
            : t('failed'),
      ),
  });

  if (done) return compact ? null : <Alert tone="success">{t('cancelled')}</Alert>;
  const date = subscription.renewsAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(subscription.renewsAt))
    : null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="auto-renew">
      {!compact && <span>{date ? t('renewsOn', { date }) : t('renews')}</span>}
      {canManage && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          {t('cancel')}
        </Button>
      )}
      <ConfirmDialog
        open={open}
        title={t('confirmTitle')}
        message={
          <>
            <p>{t('confirmBody')}</p>
            {error && <p className="mt-2 text-danger">{error}</p>}
          </>
        }
        confirmLabel={t('confirm')}
        cancelLabel={t('keep')}
        tone="danger"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

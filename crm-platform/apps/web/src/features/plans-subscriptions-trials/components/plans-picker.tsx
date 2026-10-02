'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ERROR_CODES, type BillingPlan, type ChangePlanResponse } from '@crm/contracts';
import { Alert, Button, EmptyState, Modal, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { BILLING_KEYS, changePlan, fetchBillingPlans } from '../api';
import { USAGE_PATH, checkoutPath } from '../lib/format';
import { CompareTable } from './compare-table';
import { PlanCard } from './plan-card';
import { ValidityBanner } from './validity-banner';

const NS = 'plans-subscriptions-trials';

/**
 * /account/plans (WD-PLAN-011): the validity banner, every active plan for THIS workspace, what choosing each one does, and the
 * comparison table. A workspace admin can upgrade (checkout), downgrade or switch (an immediate change with a confirmation); members
 * without `plan.subscription.manage` see the same plans with the buttons off.
 */
export function PlansPicker() {
  const t = useTranslations(`${NS}.plans`);
  const tc = useTranslations(`${NS}.common`);
  const q = useQuery({
    queryKey: BILLING_KEYS.plans,
    queryFn: ({ signal }) => fetchBillingPlans(signal),
    staleTime: 0,
  });
  const [pending, setPending] = useState<BillingPlan | null>(null);
  const [done, setDone] = useState<ChangePlanResponse | null>(null);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 id="account-pane-title" className="text-2xl font-semibold">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>

      {q.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label={tc('loading')} /> {tc('loading')}
        </p>
      ) : q.isError ? (
        <div className="space-y-3">
          <Alert tone="danger">
            {q.error instanceof ApiError ? q.error.message : t('errors.generic')}
          </Alert>
          <Button variant="secondary" onClick={() => void q.refetch()}>
            {tc('retry')}
          </Button>
        </div>
      ) : (
        <>
          <ValidityBanner validity={q.data.validity} planName={q.data.current?.name ?? null} />
          {!q.data.canManage && <Alert tone="info">{t('readOnly')}</Alert>}
          {done && <ChangeResult result={done} />}

          {q.data.data.length === 0 ? (
            <EmptyState title={t('title')} message={t('empty')} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="plan-cards">
              {q.data.data.map((plan) => (
                <PlanCard
                  key={plan.slug}
                  plan={plan}
                  canManage={q.data.canManage}
                  busy={false}
                  onSwitch={setPending}
                />
              ))}
            </div>
          )}

          <CompareTable plans={q.data.data} />

          <Link
            href={USAGE_PATH}
            className="inline-flex text-sm font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('usageLink')}
          </Link>
        </>
      )}

      <SwitchDialog
        plan={pending}
        onClose={() => setPending(null)}
        onDone={(res) => {
          setPending(null);
          setDone(res);
        }}
      />
    </div>
  );
}

function ChangeResult({ result }: { result: ChangePlanResponse }) {
  const tr = useTranslations(`${NS}.plans.result`);
  const tl = useTranslations(`${NS}.limits`);
  return (
    <Alert tone="success" data-testid="change-result">
      <p>{tr('switched', { name: result.planName })}</p>
      {result.overLimit.length > 0 && (
        <div className="mt-1 space-y-1">
          <p>{tr('overLimit')}</p>
          <ul className="list-disc ps-5">
            {result.overLimit.map((o) => (
              <li key={o.key}>
                {tr('overLimitRow', { label: tl(o.key), used: o.used, limit: o.limit })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Alert>
  );
}

/** The confirmation before an immediate switch (a downgrade or an equal-priced plan). */
function SwitchDialog({
  plan,
  onClose,
  onDone,
}: {
  plan: BillingPlan | null;
  onClose: () => void;
  onDone: (res: ChangePlanResponse) => void;
}) {
  const t = useTranslations(`${NS}.plans`);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (slug: string) => changePlan(slug),
    onSuccess: async (res) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: BILLING_KEYS.plans }),
        qc.invalidateQueries({ queryKey: BILLING_KEYS.status }),
        qc.invalidateQueries({ queryKey: BILLING_KEYS.usage }),
      ]);
      setError(null);
      onDone(res);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === ERROR_CODES.PLAN_CHECKOUT_REQUIRED && plan) {
        window.location.assign(checkoutPath(plan.slug));
        return;
      }
      setError(
        err instanceof ApiError && err.status === 403
          ? t('errors.forbidden')
          : err instanceof ApiError && err.code in PLAN_ERROR_KEYS
            ? t(`errors.${PLAN_ERROR_KEYS[err.code as keyof typeof PLAN_ERROR_KEYS]}`)
            : t('errors.generic'),
      );
    },
  });

  const keepsPeriod = plan !== null && plan.kind === 'paid';
  return (
    <Modal
      open={plan !== null}
      onClose={() => {
        if (!mutation.isPending) {
          setError(null);
          onClose();
        }
      }}
      title={plan ? t('confirm.title', { name: plan.name }) : ''}
      footer={
        <>
          <Button variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            {t('confirm.cancel')}
          </Button>
          <Button
            disabled={mutation.isPending || !plan}
            onClick={() => plan && mutation.mutate(plan.slug)}
          >
            {mutation.isPending ? t('action.working') : t('confirm.confirm')}
          </Button>
        </>
      }
    >
      {plan && (
        <div className="space-y-3 text-sm">
          <p>
            {plan.action === 'downgrade'
              ? t('confirm.downgradeBody', { name: plan.name })
              : t('confirm.switchBody', { name: plan.name })}
          </p>
          {keepsPeriod && <p className="text-muted-foreground">{t('confirm.keepsPeriod')}</p>}
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}

const PLAN_ERROR_KEYS = {
  PLAN_CHANGE_NOT_ALLOWED: 'PLAN_CHANGE_NOT_ALLOWED',
  PLAN_CHECKOUT_REQUIRED: 'PLAN_CHECKOUT_REQUIRED',
} as const;

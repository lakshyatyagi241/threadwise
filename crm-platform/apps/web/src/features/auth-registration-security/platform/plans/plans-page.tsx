'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deletePlanResponseSchema,
  planAdminItemSchema,
  type PlanAdminListResponse,
  type PlanAdminItem,
} from '@crm/contracts';
import { Alert, Badge, Button, Card, Modal, Spinner, Switch } from '@crm/ui';
import { adminPriceView, capLabel } from '../lib/plan-display';
import { planErrorKind, type PlanErrorKind } from '../lib/plan-errors';
import { useCanEdit } from '../operator-context';
import { operatorFetch } from '../operator-fetch';
import { PageHeader } from '../ui/page-header';
import { ReadOnlyNotice } from '../ui/read-only-notice';
import { ErrorBlock, LoadingBlock } from '../ui/state';
import { useToast } from '../ui/toast';
import { PlanEditor } from './plan-editor';
import { PLANS_QUERY_KEY, fetchPlans } from './plans-query';

const NS = 'auth-registration-security.platform.plans';

/** The catalogue: KPI strip, a table of every plan with an inline active switch, and create / edit / delete. */
export function PlansPage() {
  const q = useQuery({
    queryKey: PLANS_QUERY_KEY,
    queryFn: ({ signal }) => fetchPlans(signal),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return <PlansCatalogue data={q.data} />;
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <Card className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-2xl font-semibold" data-testid="kpi-value">
        {value}
      </p>
    </Card>
  );
}

function PlansCatalogue({ data }: { data: PlanAdminListResponse }) {
  const t = useTranslations(NS);
  const te = useTranslations(`${NS}.errors`);
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCanEdit('plans');
  const [editing, setEditing] = useState<PlanAdminItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PlanAdminItem | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: PLANS_QUERY_KEY });
  const errorText = (kind: PlanErrorKind) =>
    kind.key === 'inUse' ? te('inUse', { count: kind.count }) : te(kind.key);

  const toggle = useMutation({
    mutationFn: (v: { plan: PlanAdminItem; isActive: boolean }) =>
      operatorFetch(`/plans/${v.plan.id}/active`, {
        method: 'PATCH',
        body: { isActive: v.isActive },
        schema: planAdminItemSchema,
      }),
    onMutate: (v) => setTogglingId(v.plan.id),
    onSuccess: (plan) => {
      toast.success(
        t(plan.isActive ? 'toasts.activated' : 'toasts.deactivated', { name: plan.name }),
      );
      return refresh();
    },
    onError: (err) => toast.error(errorText(planErrorKind(err))),
    onSettled: () => setTogglingId(null),
  });

  const remove = useMutation({
    mutationFn: (plan: PlanAdminItem) =>
      operatorFetch(`/plans/${plan.id}`, { method: 'DELETE', schema: deletePlanResponseSchema }),
    onSuccess: async () => {
      toast.success(t('toasts.deleted', { name: deleting?.name ?? '' }));
      setDeleting(null);
      await refresh();
    },
  });

  const when = (n: number) => new Intl.NumberFormat(locale).format(n);

  const renderName = (plan: PlanAdminItem) => (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{plan.name}</span>
        {plan.isHighlighted && (
          <Badge tone="success" className="whitespace-nowrap">
            {t('badges.popular')}
          </Badge>
        )}
        {plan.isRegistrationDefault || plan.isDefault ? (
          <Badge tone="warning" className="whitespace-nowrap">
            {t('badges.signupDefault')}
          </Badge>
        ) : null}
      </div>
      <p dir="ltr" className="text-start font-mono text-xs text-muted-foreground">
        {plan.slug}
      </p>
      {plan.subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{plan.subtitle}</p>}
    </>
  );

  const renderPrice = (plan: PlanAdminItem) => {
    const price = adminPriceView(plan, locale);
    if (price.kind === 'free') return <span>{t('price.free')}</span>;
    if (price.kind === 'custom') return <span>{t('price.custom')}</span>;
    return (
      <div>
        {price.strike && (
          <span className="me-1.5 text-xs text-muted-foreground line-through">{price.strike}</span>
        )}
        <span className="font-medium">{price.main}</span>
        <p className="text-xs text-muted-foreground">
          {price.lifetime
            ? t('price.lifetime')
            : price.period
              ? t(`period.${price.period.unit}`, { count: price.period.count })
              : null}
        </p>
      </div>
    );
  };

  const renderMessages = (plan: PlanAdminItem) => {
    const cap = capLabel(plan.limits.monthly_messages);
    return cap.unlimited ? t('messages.unlimited') : t('messages.limited', { count: cap.count });
  };

  const renderStatus = (plan: PlanAdminItem) => (
    <div className="flex items-center gap-2">
      <Switch
        checked={plan.isActive}
        label={t('active.toggle', { name: plan.name })}
        disabled={!canEdit || togglingId === plan.id}
        onCheckedChange={(isActive) => toggle.mutate({ plan, isActive })}
      />
      <span className="text-xs text-muted-foreground">
        {plan.isActive ? t('active.on') : t('active.off')}
      </span>
    </div>
  );

  const renderActions = (plan: PlanAdminItem, align: 'start' | 'end' = 'end') => (
    <div className={align === 'end' ? 'flex justify-end gap-1.5' : 'flex gap-1.5'}>
      <Button
        size="sm"
        variant="secondary"
        aria-label={t('actions.editName', { name: plan.name })}
        onClick={() => setEditing(plan)}
      >
        {t('actions.edit')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-danger"
        aria-label={t('actions.deleteName', { name: plan.name })}
        onClick={() => {
          remove.reset();
          setDeleting(plan);
        }}
      >
        {t('actions.delete')}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={canEdit && <Button onClick={() => setEditing('new')}>{t('new')}</Button>}
      />
      {!canEdit && <ReadOnlyNotice section="plans" />}

      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        role="group"
        aria-label={t('kpi.label')}
      >
        <Kpi label={t('kpi.total')} value={data.summary.total} />
        <Kpi label={t('kpi.active')} value={data.summary.active} />
        <Kpi label={t('kpi.free')} value={data.summary.free} />
        <Kpi label={t('kpi.paid')} value={data.summary.paid} />
      </div>

      {data.data.length === 0 ? (
        <Card className="space-y-3 p-6 text-center">
          <h2 className="text-lg font-semibold">{t('empty.title')}</h2>
          <p className="mx-auto max-w-prose text-sm text-muted-foreground">{t('empty.body')}</p>
          {canEdit && (
            <div>
              <Button onClick={() => setEditing('new')}>{t('empty.action')}</Button>
            </div>
          )}
        </Card>
      ) : (
        <>
          {/* Wide screens: a table. Narrow ones: one card per plan, so nothing scrolls sideways. */}
          <Card className="hidden overflow-x-auto p-0 xl:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('table.label')}</caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  {(['plan', 'price', 'messages', 'workspaces', 'status'] as const).map((col) => (
                    <th key={col} scope="col" className="px-4 py-3 text-start font-medium">
                      {t(`table.${col}`)}
                    </th>
                  ))}
                  {canEdit && (
                    <th scope="col" className="px-4 py-3 text-end font-medium">
                      <span className="sr-only">{t('table.actions')}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.data.map((plan) => (
                  <tr
                    key={plan.id}
                    className="border-b border-border align-top last:border-b-0"
                    data-testid={`plan-row-${plan.slug}`}
                  >
                    <td className="px-4 py-3">{renderName(plan)}</td>
                    <td className="px-4 py-3">{renderPrice(plan)}</td>
                    <td className="px-4 py-3">{renderMessages(plan)}</td>
                    <td className="px-4 py-3 font-mono" data-testid="plan-in-use">
                      {when(plan.inUse)}
                    </td>
                    <td className="px-4 py-3">{renderStatus(plan)}</td>
                    {canEdit && <td className="px-4 py-3">{renderActions(plan)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <ul className="space-y-3 xl:hidden" aria-label={t('table.label')}>
            {data.data.map((plan) => (
              <li key={plan.id} data-testid={`plan-card-${plan.slug}`}>
                <Card className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">{renderName(plan)}</div>
                    <div className="shrink-0">{renderStatus(plan)}</div>
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">{t('table.price')}</dt>
                      <dd>{renderPrice(plan)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t('table.messages')}</dt>
                      <dd>{renderMessages(plan)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t('table.workspaces')}</dt>
                      <dd className="font-mono">{when(plan.inUse)}</dd>
                    </div>
                  </dl>
                  {canEdit && renderActions(plan, 'start')}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <PlanEditor
          key={editing === 'new' ? 'new' : editing.id}
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null);
            toast.success(t(created ? 'toasts.created' : 'toasts.updated', { name: saved.name }));
            void refresh();
          }}
        />
      )}

      {deleting && (
        <Modal
          open
          onClose={() => !remove.isPending && setDeleting(null)}
          title={t('delete.title', { name: deleting.name })}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)} disabled={remove.isPending}>
                {t('delete.cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate(deleting)}
              >
                {remove.isPending && <Spinner label={t('delete.deleting')} />}
                {t('delete.confirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <p>{t('delete.body')}</p>
            {deleting.inUse > 0 && !remove.isError && (
              <Alert tone="warning">{t('delete.inUseHint', { count: deleting.inUse })}</Alert>
            )}
            {remove.isError && (
              <Alert tone="danger">{errorText(planErrorKind(remove.error))}</Alert>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

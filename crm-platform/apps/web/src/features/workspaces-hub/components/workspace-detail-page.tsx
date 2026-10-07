'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkspaceHubDetail, WorkspaceHubRow } from '@crm/contracts';
import { Badge, Button, Card, StatTile } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { TabBar } from '@/features/auth-registration-security/platform/ui/tab-bar';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { BarChart } from '@/features/dashboards-analytics-charts/components/charts';
import { STATE_TONE } from '@/features/plans-subscriptions-trials/lib/format';
import { AdjustDialog } from '@/features/wallet-message-billing/components/admin/adjust-dialog';
import { KEYS as WALLET_KEYS } from '@/features/wallet-message-billing/api';
import { useUrlState } from '@/features/platform-payment-gateways/lib/use-url-state';
import { fetchHubDetail, hubKeys } from '../api';
import { capText, endsInfo, formatMrr, formatWalletBalance } from '../lib/format';
import type { HubAccess } from '../lib/permissions';
import { useRowActions } from '../lib/use-row-actions';
import { ActionDialogs } from './action-dialogs';
import { Breadcrumb } from './breadcrumb';
import { LastActiveCell, OwnerCell } from './cells';
import { RowActions, actionsFor, type HubActionId } from './row-actions';

const TABS = ['overview', 'plan', 'wallet', 'provider', 'support'] as const;
type Tab = (typeof TABS)[number];

/** What the detail response says the caller may do, in the same shape the list menu uses. */
export function accessFromCan(can: WorkspaceHubDetail['can']): HubAccess {
  return {
    dashboard: true,
    editPlan: can.editPlan,
    planLimits: can.editPlan,
    provider: can.manageProvider,
    impersonate: can.impersonate,
    suspend: can.suspend,
    unsuspend: can.unsuspend,
  };
}

/** One workspace at a glance: the figures a support person needs, the same actions as the list, and a tab per part of the account. */
export function WorkspaceDetailPage({ id }: { id: string }) {
  const t = useTranslations('workspaces-hub.detail');
  const q = useQuery({
    queryKey: hubKeys.detail(id),
    queryFn: ({ signal }) => fetchHubDetail(id, signal),
    refetchOnWindowFocus: false,
  });
  return (
    <div className="space-y-6">
      <Breadcrumb current={q.data?.row.name ?? t('crumb')} />
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <DetailBody detail={q.data} />
      )}
    </div>
  );
}

export function DetailBody({ detail }: { detail: WorkspaceHubDetail }) {
  const t = useTranslations('workspaces-hub.detail');
  const th = useTranslations('workspaces-hub.cell.health');
  const ts = useTranslations('plans-subscriptions-trials.operator.state');
  const locale = useLocale();
  const { row } = detail;
  const access = accessFromCan(detail.can);
  const actions = useRowActions();
  const { values, set } = useUrlState({ tab: 'overview' });
  const tab: Tab = (TABS as readonly string[]).includes(values.tab)
    ? (values.tab as Tab)
    : 'overview';
  const num = new Intl.NumberFormat(locale);
  const suspended = row.status === 'suspended';

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {row.name}
            <Badge tone={suspended ? 'danger' : 'success'}>
              {th(suspended ? 'suspended' : row.health)}
            </Badge>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs">{row.slug}</span>
            <Badge tone={STATE_TONE[row.validity.state]}>{ts(row.validity.state)}</Badge>
            <Badge>{row.plan.known ? (row.plan.name ?? row.plan.slug) : row.plan.slug}</Badge>
            <span className="text-xs">
              {t('created', {
                date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                  new Date(row.createdAt),
                ),
              })}
            </span>
          </span>
        }
        actions={
          <>
            <ActionButtons row={row} access={access} onAction={(a) => actions.run(row, a)} />
            <RowActions
              row={row}
              access={access}
              onAction={(a) => actions.run(row, a)}
              triggerClassName="size-10"
            />
          </>
        }
      />

      <div
        className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7"
        data-testid="detail-kpis"
      >
        <StatTile label={t('kpi.members')} value={num.format(detail.members)} />
        <StatTile label={t('kpi.contacts')} value={num.format(detail.contacts)} />
        <StatTile
          label={t('kpi.openTickets')}
          value={num.format(detail.openTickets)}
          tone={detail.openTickets > 0 ? 'warning' : 'default'}
        />
        <StatTile
          label={t('kpi.delivered')}
          value={detail.deliveredPct === null ? '–' : `${Math.round(detail.deliveredPct)}%`}
        />
        <StatTile
          label={t('kpi.wallet')}
          value={formatWalletBalance(row.wallet.balanceMinor, row.wallet.currency, locale)}
          tone={row.wallet.low ? 'warning' : 'default'}
        />
        <StatTile label={t('kpi.mrr')} value={formatMrr(row.mrr, null, locale)} />
        <StatTile label={t('kpi.messages7d')} value={num.format(row.messages7d)} />
      </div>

      <Card className="space-y-3">
        <h2 className="text-base font-semibold">{t('chart.title')}</h2>
        <MessagesChart days={detail.messages30d} />
      </Card>

      <TabBar
        items={TABS.map((id) => ({ id, label: t(`tabs.${id}`) }))}
        value={tab}
        onChange={(next) => set({ tab: next }, true)}
        label={t('tabs.label')}
        idPrefix="hub"
      />
      <div role="tabpanel" id="hub-panel" aria-labelledby={`hub-tab-${tab}`} className="space-y-4">
        {tab === 'overview' && <OverviewTab detail={detail} />}
        {tab === 'plan' && (
          <PlanTab
            row={row}
            canEdit={access.editPlan}
            onEdit={() => actions.run(row, 'editPlan')}
          />
        )}
        {tab === 'wallet' && <WalletTab detail={detail} />}
        {tab === 'provider' && (
          <ProviderTab
            row={row}
            canManage={access.provider}
            onChange={() => actions.run(row, 'provider')}
          />
        )}
        {tab === 'support' && <SupportTab detail={detail} />}
      </div>

      <ActionDialogs target={actions.target} onClose={actions.close} />
    </>
  );
}

/** The two actions an operator reaches for most sit beside the menu as buttons. */
function ActionButtons({
  row,
  access,
  onAction,
}: {
  row: WorkspaceHubRow;
  access: HubAccess;
  onAction: (a: HubActionId) => void;
}) {
  const t = useTranslations('workspaces-hub.actions');
  const shown = actionsFor(row).filter((a) => a === 'editPlan' || a === 'impersonate');
  return (
    <>
      {shown.map((a) => (
        <Button
          key={a}
          variant={a === 'impersonate' ? 'primary' : 'secondary'}
          disabled={!access[a]}
          title={access[a] ? undefined : t('denied')}
          onClick={() => onAction(a)}
        >
          {t(a)}
        </Button>
      ))}
    </>
  );
}

function MessagesChart({ days }: { days: WorkspaceHubDetail['messages30d'] }) {
  const t = useTranslations('workspaces-hub.detail.chart');
  const locale = useLocale();
  if (days.every((d) => d.sent === 0 && d.delivered === 0)) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>;
  }
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  return (
    <BarChart
      label={t('label')}
      labels={days.map((d) => fmt.format(new Date(d.day)))}
      series={[
        { name: t('sent'), values: days.map((d) => d.sent), color: 'var(--primary)' },
        { name: t('delivered'), values: days.map((d) => d.delivered), color: 'var(--success)' },
      ]}
    />
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function OverviewTab({ detail }: { detail: WorkspaceHubDetail }) {
  const t = useTranslations('workspaces-hub.detail.overview');
  const th = useTranslations('workspaces-hub.cell.health');
  const tc = useTranslations('workspaces-hub.cell');
  const { row } = detail;
  return (
    <Card>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t('owner')}>
          <OwnerCell row={row} />
        </Fact>
        <Fact label={t('health')}>{th(row.health)}</Fact>
        <Fact label={t('lastActive')}>
          <LastActiveCell row={row} />
        </Fact>
        {row.suspendedBy.length > 0 && (
          <Fact label={t('suspendedBy')}>
            {row.suspendedBy
              .map((k) =>
                k === 'frozen' || k === 'tos_violation' || k === 'fraud'
                  ? tc(`suspendedBy.${k}`)
                  : k,
              )
              .join(', ')}
          </Fact>
        )}
      </dl>
      <div className="mt-4 border-t border-border pt-4">
        <h3 className="text-xs font-medium text-muted-foreground">{t('adminNote')}</h3>
        <p className="mt-1 whitespace-pre-wrap text-sm">{detail.adminNote ?? t('noNote')}</p>
      </div>
    </Card>
  );
}

function PlanTab({
  row,
  canEdit,
  onEdit,
}: {
  row: WorkspaceHubRow;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations('workspaces-hub.detail.planTab');
  const tl = useTranslations('workspaces-hub.cell.limits');
  const ts = useTranslations('plans-subscriptions-trials.operator.state');
  const tc = useTranslations('workspaces-hub.common');
  const locale = useLocale();
  const ends = endsInfo(row.validity);
  const limits: Array<[string, number | null]> = [
    [tl('messages'), row.limits.monthlyMessages],
    [tl('users'), row.limits.users],
    [tl('contacts'), row.limits.contacts],
    [tl('devices'), row.limits.devices],
  ];
  return (
    <Card className="space-y-4">
      <dl className="grid gap-4 sm:grid-cols-3">
        <Fact label={t('plan')}>
          {row.plan.known ? (row.plan.name ?? row.plan.slug) : row.plan.slug}
        </Fact>
        <Fact label={t('state')}>{ts(row.validity.state)}</Fact>
        <Fact label={t('ends')}>
          {ends.iso
            ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ends.iso))
            : tc('none')}
        </Fact>
      </dl>
      <div>
        <h3 className="text-sm font-medium">{t('limits')}</h3>
        <dl className="mt-2 grid gap-3 sm:grid-cols-4">
          {limits.map(([label, value]) => (
            <Fact key={label} label={label}>
              <span className="tabular-nums">
                {value === null ? tc('unlimited') : capText(value, locale)}
              </span>
            </Fact>
          ))}
        </dl>
        {row.limits.overridden && <p className="mt-3 text-sm text-warning">{t('overrideNote')}</p>}
      </div>
      <Button variant="secondary" disabled={!canEdit} onClick={onEdit}>
        {t('edit')}
      </Button>
    </Card>
  );
}

function WalletTab({ detail }: { detail: WorkspaceHubDetail }) {
  const t = useTranslations('workspaces-hub.detail.walletTab');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { row } = detail;
  return (
    <Card className="space-y-4">
      <div>
        <div className="text-xs font-medium text-muted-foreground">{t('balance')}</div>
        <div className="text-3xl font-semibold tabular-nums">
          {formatWalletBalance(row.wallet.balanceMinor, row.wallet.currency, locale)}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!detail.can.adjustWallet} onClick={() => setOpen(true)}>
          {t('adjust')}
        </Button>
        <Link
          href={`/admin/wallet/workspaces/${row.workspaceId}`}
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          {t('open')}
        </Link>
      </div>
      {open && (
        <AdjustDialog
          workspaceId={row.workspaceId}
          workspaceName={row.name}
          currency={row.wallet.currency}
          balanceMinor={Number(row.wallet.balanceMinor)}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            toast.success(t('adjusted'));
            void qc.invalidateQueries({ queryKey: hubKeys.all });
            void qc.invalidateQueries({ queryKey: WALLET_KEYS.workspaces });
          }}
        />
      )}
    </Card>
  );
}

function ProviderTab({
  row,
  canManage,
  onChange,
}: {
  row: WorkspaceHubRow;
  canManage: boolean;
  onChange: () => void;
}) {
  const t = useTranslations('workspaces-hub.detail.providerTab');
  const ts = useTranslations('workspaces-hub.cell.providerSource');
  const tn = useTranslations('workspaces-hub.cell');
  return (
    <Card className="space-y-4">
      <dl className="grid gap-4 sm:grid-cols-3">
        <Fact label={t('provider')}>{row.provider.name ?? row.provider.key}</Fact>
        <Fact label={t('source')}>{ts(row.provider.source)}</Fact>
        <Fact label={t('numbers')}>{tn('numbersCount', { count: row.numbers })}</Fact>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!canManage} onClick={onChange}>
          {t('change')}
        </Button>
        <Link
          href={`/admin/whatsapp-providers/switch?workspace=${row.workspaceId}&name=${encodeURIComponent(row.name)}`}
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          {t('switch')}
        </Link>
      </div>
    </Card>
  );
}

function SupportTab({ detail }: { detail: WorkspaceHubDetail }) {
  const t = useTranslations('workspaces-hub.detail.supportTab');
  return (
    <Card className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('text')}</p>
      <p className="text-sm">{t('openTickets', { count: detail.openTickets })}</p>
      <Link
        href={`/admin/support/customers/${detail.row.workspaceId}`}
        className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
      >
        {t('open')}
      </Link>
    </Card>
  );
}

'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { WorkspaceHubRow } from '@crm/contracts';
import { Badge, cn } from '@crm/ui';
import { STATE_TONE } from '@/features/plans-subscriptions-trials/lib/format';
import { agoParts, capText, endsInfo, formatMrr, formatWalletBalance } from '../lib/format';

const HEALTH_TONE = {
  suspended: 'danger',
  good: 'success',
  active: 'success',
  low: 'warning',
  new: 'neutral',
  idle: 'warning',
} as const;

export function WorkspaceCell({ row }: { row: WorkspaceHubRow }) {
  const t = useTranslations('workspaces-hub.cell');
  const suspended = row.status === 'suspended';
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <Link
          href={`/admin/workspaces/${row.workspaceId}`}
          className="font-medium text-primary hover:underline"
        >
          {row.name}
        </Link>
        {suspended && <Badge tone="danger">{t('suspended')}</Badge>}
      </div>
      <div className="font-mono text-xs text-muted-foreground">{row.slug}</div>
      {suspended && row.suspendedBy.length > 0 && (
        <div className="mt-0.5 text-xs text-danger">
          {row.suspendedBy
            .map((k) =>
              k === 'frozen' || k === 'tos_violation' || k === 'fraud' ? t(`suspendedBy.${k}`) : k,
            )
            .join(', ')}
        </div>
      )}
    </div>
  );
}

export function ProviderCell({ row }: { row: WorkspaceHubRow }) {
  const t = useTranslations('workspaces-hub.cell.providerSource');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span>{row.provider.name ?? row.provider.key}</span>
      <Badge tone={row.provider.source === 'override' ? 'warning' : 'neutral'}>
        {t(row.provider.source)}
      </Badge>
    </div>
  );
}

export function NumbersCell({ row }: { row: WorkspaceHubRow }) {
  const t = useTranslations('workspaces-hub.cell');
  return <span className="tabular-nums">{t('numbersCount', { count: row.numbers })}</span>;
}

export function PlanCell({ row }: { row: WorkspaceHubRow }) {
  const t = useTranslations('workspaces-hub.cell');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span>{row.plan.known ? (row.plan.name ?? row.plan.slug) : row.plan.slug}</span>
      {!row.plan.known && <Badge tone="warning">{t('unknownPlan')}</Badge>}
      {row.plan.platformOwned && <Badge>{t('platformOwned')}</Badge>}
    </div>
  );
}

export function StateCell({ row }: { row: WorkspaceHubRow }) {
  const ts = useTranslations('plans-subscriptions-trials.operator.state');
  const t = useTranslations('workspaces-hub.cell.health');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={STATE_TONE[row.validity.state]}>{ts(row.validity.state)}</Badge>
      <Badge tone={HEALTH_TONE[row.health]}>{t(row.health)}</Badge>
    </div>
  );
}

export function EndsCell({ row }: { row: WorkspaceHubRow }) {
  const t = useTranslations('workspaces-hub.cell');
  const tc = useTranslations('workspaces-hub.common');
  const locale = useLocale();
  const ends = endsInfo(row.validity);
  if (!ends.iso) return <span className="text-muted-foreground">{tc('none')}</span>;
  return (
    <div className="whitespace-nowrap">
      <div>
        {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ends.iso))}
      </div>
      <div
        className={cn(
          'text-xs',
          ends.tone === 'danger' && 'font-medium text-danger',
          ends.tone === 'warning' && 'font-medium text-warning',
          ends.tone === 'neutral' && 'text-muted-foreground',
        )}
      >
        {ends.expired ? t('expired') : t('daysLeft', { count: ends.days ?? 0 })}
      </div>
    </div>
  );
}

export function LimitsCell({ row }: { row: WorkspaceHubRow }) {
  const t = useTranslations('workspaces-hub.cell.limits');
  const locale = useLocale();
  const l = row.limits;
  return (
    <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap text-xs">
      <span className="tabular-nums">
        {t('summary', {
          messages: capText(l.monthlyMessages, locale),
          users: capText(l.users, locale),
          contacts: capText(l.contacts, locale),
          devices: capText(l.devices, locale),
        })}
      </span>
      {l.overridden && <Badge tone="warning">{t('override')}</Badge>}
    </div>
  );
}

export function WalletCell({ row }: { row: WorkspaceHubRow }) {
  const t = useTranslations('workspaces-hub.cell');
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 whitespace-nowrap tabular-nums">
      <span>{formatWalletBalance(row.wallet.balanceMinor, row.wallet.currency, locale)}</span>
      {row.wallet.low && <Badge tone="warning">{t('lowBalance')}</Badge>}
    </div>
  );
}

export function OwnerCell({ row }: { row: WorkspaceHubRow }) {
  const t = useTranslations('workspaces-hub.cell');
  const o = row.owner;
  if (!o) return <span className="text-muted-foreground">{t('noOwner')}</span>;
  return (
    <div className="min-w-0 text-xs">
      <div className="text-sm font-medium">{o.name ?? o.email ?? ''}</div>
      {o.email && (
        <a href={`mailto:${o.email}`} className="block truncate text-primary hover:underline">
          {o.email}
        </a>
      )}
      {o.phone && <div className="text-muted-foreground">{o.phone}</div>}
    </div>
  );
}

export function MrrCell({ row, currency }: { row: WorkspaceHubRow; currency: string }) {
  const locale = useLocale();
  return <span className="tabular-nums">{formatMrr(row.mrr, currency, locale)}</span>;
}

export function Messages7dCell({ row }: { row: WorkspaceHubRow }) {
  const locale = useLocale();
  return (
    <span className="tabular-nums">{new Intl.NumberFormat(locale).format(row.messages7d)}</span>
  );
}

export function LastActiveCell({ row }: { row: WorkspaceHubRow }) {
  const t = useTranslations('workspaces-hub.cell.ago');
  const tc = useTranslations('workspaces-hub.common');
  if (!row.lastActiveAt) return <span className="text-muted-foreground">{tc('never')}</span>;
  const { unit, count } = agoParts(row.lastActiveAt);
  return (
    <span className="whitespace-nowrap">{unit === 'now' ? t('now') : t(unit, { count })}</span>
  );
}

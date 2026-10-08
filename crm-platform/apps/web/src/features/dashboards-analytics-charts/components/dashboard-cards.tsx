'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { DashWidgets } from '@crm/contracts';
import { Badge, Button, Card, cn } from '@crm/ui';
import { useWalletBalance } from '@/features/wallet-message-billing';
import { compact, formatMoney, relativeSpan } from '../lib/format';
import { Panel, Trend } from './parts';

const BASE = 'dashboards-analytics-charts.dashboard';

/** WaDesk's status vocabulary mapped to a tone: sending green, scheduled amber, paused/failed coral, completed grey. */
export const statusTone = (status: string): 'success' | 'warning' | 'danger' | 'neutral' =>
  ['processing', 'sending', 'running', 'active'].includes(status)
    ? 'success'
    : ['scheduled', 'pending', 'queued'].includes(status)
      ? 'warning'
      : ['paused', 'cancelled', 'failed'].includes(status)
        ? 'danger'
        : 'neutral';

const Bar = ({ pct, className }: { pct: number; className?: string }) => (
  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
    <div
      className={cn('h-full rounded-full bg-primary', className)}
      style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
    />
  </div>
);

/** Card 3 (WD-DASH-006): total with growth, and three bars (Subscribed and Opted-in share one column in WaDesk too). */
export function ContactsCard({ data }: { data: DashWidgets['contacts'] }) {
  const t = useTranslations(`${BASE}.contacts`);
  const denom = Math.max(1, data.total);
  const rows = [
    ['subscribed', data.subscribed],
    ['optedIn', data.subscribed],
    ['blocked', data.blocked],
  ] as const;
  return (
    <Card className="space-y-3" data-testid="card-contacts">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('title')}</p>
        <Trend delta={data.deltaPct} />
      </div>
      <p className="text-3xl font-semibold leading-none tabular-nums">{data.total}</p>
      <ul className="space-y-2 text-xs">
        {rows.map(([key, n]) => (
          <li key={key} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2">
            <span className="text-muted-foreground">{t(key)}</span>
            <Bar pct={(n / denom) * 100} className={key === 'blocked' ? 'bg-danger' : undefined} />
            <span className="text-end tabular-nums">{n}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Card 4 (WD-DASH-007): the wallet balance when the workspace holds money, else the "Get more done" prompt. */
export function WalletOrAutopilotCard() {
  const t = useTranslations(`${BASE}.wallet`);
  const a = useTranslations(`${BASE}.autopilot`);
  const wallet = useWalletBalance();
  const funded = wallet.allowed && wallet.summary !== undefined && wallet.summary.balanceMinor > 0;
  if (funded && wallet.summary) {
    return (
      <Card className="space-y-3" data-testid="card-wallet">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t('title')}</p>
          {wallet.summary.billingMode === 'wallet' && <Badge>{t('payPerMessage')}</Badge>}
        </div>
        <p className="text-3xl font-semibold leading-none tabular-nums">{wallet.label}</p>
        <Bar pct={100} />
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/billing/wallet" className="font-medium text-primary hover:underline">
            {t('topUp')}
          </Link>
        </div>
      </Card>
    );
  }
  return (
    <Card className="space-y-3 bg-primary text-primary-foreground" data-testid="card-autopilot">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] opacity-80">{a('kicker')}</p>
      <h2 className="font-serif text-2xl leading-tight">{a('title')}</h2>
      <p className="text-sm opacity-80">{a('body')}</p>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/campaigns"
          className="inline-flex h-9 items-center rounded-full bg-background/15 px-4 text-sm font-medium hover:bg-background/25"
        >
          {a('flow')}
        </Link>
        <Link
          href="/campaigns/create"
          className="inline-flex h-9 items-center rounded-full bg-background/15 px-4 text-sm font-medium hover:bg-background/25"
        >
          {a('campaign')}
        </Link>
      </div>
    </Card>
  );
}

/** The sales-pipeline strip (WD-DASH-011), only when the plan has a pipeline. */
export function PipelineStrip({ data }: { data: NonNullable<DashWidgets['pipeline']> }) {
  const t = useTranslations(`${BASE}.pipeline`);
  const locale = useLocale();
  const money = (minor: string) => formatMoney(Number(minor) / 100, data.currency, locale);
  const cells = [
    [t('open'), money(data.openValueMinor)],
    [t('deals'), String(data.openDeals)],
    [t('won'), money(data.wonThisMonthMinor)],
    [t('winRate'), `${data.winRatePct}%`],
  ] as const;
  return (
    <Card className="space-y-3" data-testid="strip-pipeline">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('kicker')}
        </p>
        <Link href="/deals" className="text-sm font-medium text-primary hover:underline">
          {t('board')}
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cells.map(([label, value]) => (
          <div key={label}>
            <dd className="font-serif text-2xl tabular-nums">{value}</dd>
            <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {label}
            </dt>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Live inbox preview (WD-DASH-016). */
export function InboxCard({ data }: { data: DashWidgets['inbox'] }) {
  const t = useTranslations(`${BASE}.inbox`);
  const locale = useLocale();
  const now = new Date();
  return (
    <Panel
      title={t('title')}
      subtitle={
        data.unread > 0 && data.oldestUnreadAt
          ? `${t('unread', { n: data.unread })} - ${t('oldest', { when: relativeSpan(data.oldestUnreadAt, now, locale) })}`
          : t('unread', { n: data.unread })
      }
      action={
        <Link href="/inbox" className="text-sm font-medium text-primary hover:underline">
          {t('open')}
        </Link>
      }
    >
      {data.recent.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('recent')}
          </p>
          <ul className="space-y-1">
            {data.recent.map((c) => (
              <li key={c.uuid}>
                <Link
                  href="/inbox"
                  className="flex items-center gap-3 rounded-md p-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold uppercase text-primary"
                  >
                    {c.title.slice(0, 2)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{c.title}</span>
                      {c.at && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {relativeSpan(c.at, now, locale)}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.preview || '-'}
                    </span>
                  </span>
                  {c.unread > 0 && <Badge tone="success">{c.unread}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/** Active campaigns (WD-DASH-013). */
export function CampaignsCard({ data }: { data: DashWidgets['campaigns'] }) {
  const t = useTranslations(`${BASE}.campaigns`);
  return (
    <Panel
      title={t('title')}
      subtitle={t('summary', {
        running: data.running,
        scheduled: data.scheduled,
        paused: data.paused,
      })}
      action={
        <Link href="/broadcasts" className="text-sm font-medium text-primary hover:underline">
          {t('viewAll', { n: data.total })}
        </Link>
      }
    >
      {data.recent.length === 0 ? (
        <div className="space-y-2 rounded-md border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium">{t('emptyTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('emptyBody')}</p>
          <Link
            href="/broadcasts/create"
            className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            + {t('new')}
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.recent.map((b) => (
            <li key={b.uuid} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{b.name ?? t('untitled')}</span>
                <Badge tone={statusTone(b.status)}>
                  {t.has(`status.${b.status}`) ? t(`status.${b.status}`) : b.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {[b.category, b.template].filter(Boolean).join(' - ')}
              </p>
              <Bar pct={b.pct} />
              <p className="flex justify-between text-xs text-muted-foreground">
                <span>{t('delivered', { done: b.done, total: b.total })}</span>
                <span className="tabular-nums">{b.pct}%</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const DOT = { online: 'bg-success', connecting: 'bg-warning', offline: 'bg-danger' } as const;

/** Connected devices (WD-DASH-014). */
export function DevicesCard({ data }: { data: DashWidgets['devices'] }) {
  const t = useTranslations(`${BASE}.devices`);
  const free = Math.max(0, data.slotCap - data.total);
  return (
    <Panel
      title={t('title')}
      subtitle={t('summary', { total: data.total, cap: data.slotCap, online: data.online })}
      action={
        <Link
          href="/channels/whatsapp"
          className="text-sm font-medium text-primary hover:underline"
        >
          + {t('connect')}
        </Link>
      }
    >
      {data.rows.length === 0 ? (
        <div className="space-y-2 rounded-md border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium">{t('emptyTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('emptyBody')}</p>
          <Link href="/channels/whatsapp">
            <Button size="sm">{t('connectDevice')}</Button>
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {data.rows.map((d) => (
            <li
              key={d.uuid}
              className="flex items-center gap-3 rounded-md border border-border p-2.5"
            >
              <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', DOT[d.state])} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{d.phone ?? d.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {d.label} - {d.region ?? t('unzoned')} - {t('per24h', { n: d.sent24h })}
                </span>
              </span>
              <span
                className={cn(
                  'text-end text-sm tabular-nums',
                  d.deliveryPct >= 95
                    ? 'text-muted-foreground'
                    : d.deliveryPct >= 85
                      ? 'text-warning'
                      : 'text-danger',
                )}
              >
                {d.deliveryPct}%<span className="block text-[10px]">{t('deliv')}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {free > 0 && (
        <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--brand)_6%,transparent)_0_6px,transparent_6px_12px)] p-2.5">
          <div>
            <div className="text-xs font-medium">{t('free', { n: free })}</div>
            <div className="font-mono text-[11px] text-muted-foreground">{t('freeHint')}</div>
          </div>
          <Link
            href="/channels/whatsapp"
            className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium hover:bg-muted"
          >
            {t('connectDeviceShort')}
          </Link>
        </div>
      )}
    </Panel>
  );
}

/** Top performing templates (WD-DASH-015); "CTR" is shown as what it measures (the read rate) and the bar as the delivery rate. */
export function TemplatesCard({ data }: { data: DashWidgets['templates'] }) {
  const t = useTranslations(`${BASE}.templates`);
  const cols = [
    'template',
    'type',
    'sent',
    'delivered',
    'read',
    'readRate',
    'performance',
    'status',
  ] as const;
  return (
    <Panel
      title={t('title')}
      subtitle={t('subtitle')}
      action={
        <span className="flex items-center gap-2">
          <Badge>{t('count', { n: data.count })}</Badge>
          <Link href="/templates/new" className="text-sm font-medium text-primary hover:underline">
            + {t('new')}
          </Link>
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              {cols.map((c) => (
                <th key={c} scope="col" className="py-2 pe-3 text-start font-medium">
                  {t(`col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr>
                <td
                  colSpan={cols.length}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  {t('empty')}{' '}
                  <Link href="/templates/new" className="font-medium text-primary hover:underline">
                    {t('create')}
                  </Link>
                </td>
              </tr>
            )}
            {data.rows.map((r) => (
              <tr key={r.uuid} className="border-b border-border/60 last:border-0">
                <td className="py-2 pe-3">
                  <span className="block font-medium">{r.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {r.language ? r.language.toUpperCase() : '-'}
                  </span>
                </td>
                <td className="py-2 pe-3 text-muted-foreground">
                  {[r.category, r.type].filter(Boolean).join(' - ') || '-'}
                </td>
                <td className="py-2 pe-3 tabular-nums">{r.sent > 0 ? compact(r.sent) : '-'}</td>
                <td className="py-2 pe-3 tabular-nums">
                  {r.sent > 0 ? compact(r.delivered) : '-'}
                </td>
                <td className="py-2 pe-3 tabular-nums">{r.sent > 0 ? compact(r.read) : '-'}</td>
                <td className="py-2 pe-3 tabular-nums">
                  {r.readRatePct !== null ? `${r.readRatePct}%` : '-'}
                </td>
                <td className="w-28 py-2 pe-3">{r.sent > 0 ? <Bar pct={r.performance} /> : '-'}</td>
                <td className="py-2">
                  <Badge
                    tone={
                      ['approved', 'public', 'active'].includes(r.status)
                        ? 'success'
                        : ['rejected', 'disabled'].includes(r.status)
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {t.has(`status.${r.status}`) ? t(`status.${r.status}`) : r.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Workspace activity log (WD-DASH-019): the latest audit rows of this workspace. */
export function ActivityCard({ data }: { data: DashWidgets['activity'] }) {
  const t = useTranslations(`${BASE}.activity`);
  const locale = useLocale();
  const now = new Date();
  return (
    <Panel title={t('title')} subtitle={t('subtitle')}>
      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {data.map((a, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                {t('by', { actor: a.actor ?? '-', module: a.module, action: a.action })}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {relativeSpan(a.at, now, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

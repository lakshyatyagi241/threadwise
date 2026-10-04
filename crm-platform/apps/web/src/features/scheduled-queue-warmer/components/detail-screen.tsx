'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ScheduleDetail } from '@crm/contracts';
import { Button, EmptyState, Spinner, StatTile, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useScheduleDetail } from '../api/schedules';
import {
  availableActions,
  funnelOf,
  isFinished,
  phoneText,
  RECIPIENT_TABS,
  recipientTabMatches,
  relativeWhen,
  type RecipientTab,
} from '../lib/schedule-model';
import { formatWhen } from '../lib/time';
import { ErrorNotice } from './error-notice';
import { Icon } from './icons';
import { useScheduleActions } from './schedule-actions';
import { StatusBadge } from './status-badge';
import { useErrorText } from './use-error-text';

const fmt = (n: number) => n.toLocaleString('en-US');
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * `/scheduled/:id` (WD-SCHED-013 to 017): the schedule's header and actions, the delivery counters and funnel, the status mix, the
 * recipients table with its status tabs, the configuration and the message as the recipients see it.
 */
export function DetailScreen({ id }: { id: string }) {
  const t = useTranslations('scheduled-queue-warmer.detail');
  const router = useRouter();
  const canManage = useCan('sched.schedules.manage');
  const errorText = useErrorText();
  const q = useScheduleDetail(id);
  const { act, retry, dialogs } = useScheduleActions(() => router.push('/scheduled'));

  if (q.isPending) {
    return (
      <div className="flex justify-center p-16">
        <Spinner />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="mx-auto max-w-xl space-y-3 p-6">
        <ErrorNotice error={errorText(q.error)} />
        <Link href="/scheduled" className="text-sm font-semibold text-brand">
          {t('back')}
        </Link>
      </div>
    );
  }
  return (
    <>
      <DetailBody s={q.data} canManage={canManage} act={act} retry={retry} />
      {dialogs}
    </>
  );
}

function DetailBody({
  s,
  canManage,
  act,
  retry,
}: {
  s: ScheduleDetail;
  canManage: boolean;
  act: ReturnType<typeof useScheduleActions>['act'];
  retry: ReturnType<typeof useScheduleActions>['retry'];
}) {
  const t = useTranslations('scheduled-queue-warmer.detail');
  const ts = useTranslations('scheduled-queue-warmer');
  const [tab, setTab] = useState<RecipientTab>('all');
  const [now] = useState(() => Date.now());
  const f = funnelOf(s.breakdown, s.totalRecipients);
  const a = availableActions(s.status);
  const target = { id: s.id, name: s.name };
  const active = s.status === 'scheduled' || s.status === 'running';
  const rows = s.recipients.filter((r) => recipientTabMatches(tab, r.status));
  const counts: Record<RecipientTab, number> = {
    all: f.all,
    sent: f.sent,
    delivered: f.delivered,
    read: f.read,
    failed: f.failed,
    pending: f.pending,
  };
  const fires = s.nextRunAt ? relativeWhen(Date.parse(s.nextRunAt), now) : null;
  const firesText = fires
    ? fires.n === undefined
      ? ts(`list.when.${fires.key}`)
      : ts(`list.when.${fires.key}`, { n: fires.n })
    : null;
  const at = (iso: string | null) => (iso ? `${formatWhen(iso, s.timezone)} ${s.timezone}` : '—');

  const kpi = (label: string, value: string, tag: string, sub?: string) => (
    <StatTile label={`${label} ${tag}`.trim()} value={value} hint={sub} />
  );

  const dl = (label: string, value: string) => (
    <div className="flex justify-between gap-3 py-1.5 text-[12.5px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">{value}</dd>
    </div>
  );

  const bar = (label: string, n: number, pct: number, tone: string) => (
    <div key={label}>
      <div className="mb-1 flex justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono">
          {fmt(n)} / {pct}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', tone)}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1300px] space-y-5 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/scheduled"
            aria-label={t('back')}
            className="inline-flex size-8 items-center justify-center rounded-full border border-border hover:bg-muted"
          >
            <Icon name="back" className="size-4" />
          </Link>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('crumb')}
            </div>
            <div className="text-xl font-semibold">{t('title')}</div>
          </div>
        </div>
        <StatusBadge status={s.status} />
      </header>

      <section className="rounded-md border border-border bg-background p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('eyebrow')}
            </div>
            <h1 className="truncate text-2xl font-semibold">{s.name || t('untitled')}</h1>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              {[
                ts.has(`type.${s.messageType}`) ? ts(`type.${s.messageType}`) : s.messageType,
                `${ts(`list.recipients.${s.recipientType}`)} · ${fmt(s.totalRecipients)}`,
                at(s.scheduledAt),
                s.scheduleType === 'recurring'
                  ? t('recurs', { interval: s.repeatInterval ?? '', n: s.repeatEvery || 1 })
                  : null,
                s.senderLabel,
                active && firesText ? t('fires', { when: firesText }) : null,
              ]
                .filter(Boolean)
                .map((x) => (
                  <span key={x} className="rounded-full bg-muted px-2.5 py-1 font-mono">
                    {x}
                  </span>
                ))}
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {a.pause && (
                <Button size="sm" variant="secondary" onClick={() => act('pause', target)}>
                  <Icon name="pause" />
                  {t('actions.pause')}
                </Button>
              )}
              {a.resume && (
                <Button size="sm" variant="secondary" onClick={() => act('resume', target)}>
                  <Icon name="resume" />
                  {t('actions.resume')}
                </Button>
              )}
              {a.runNow && (
                <Button size="sm" variant="secondary" onClick={() => act('run-now', target)}>
                  <Icon name="runNow" />
                  {t('actions.runNow')}
                </Button>
              )}
              {a.cancel && (
                <Button size="sm" variant="secondary" onClick={() => act('cancel', target)}>
                  <Icon name="cancel" />
                  {t('actions.cancel')}
                </Button>
              )}
              {a.retry && (
                <Button size="sm" variant="secondary" onClick={() => retry(target)}>
                  <Icon name="retry" />
                  {t('actions.retry')}
                </Button>
              )}
              <Button size="sm" variant="danger" onClick={() => act('destroy', target)}>
                <Icon name="delete" />
                {t('actions.delete')}
              </Button>
            </div>
          )}
        </div>
        {s.status === 'failed' && (s.failureReason ?? s.lastError) && (
          <p
            role="alert"
            className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger"
          >
            {s.failureReason ?? s.lastError}
          </p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {kpi(t('kpi.recipients'), fmt(f.all), '', ts(`list.recipients.${s.recipientType}`))}
        {kpi(
          t('kpi.delivered'),
          fmt(f.delivered),
          `${f.deliveryRate}%`,
          t('kpi.failedCount', { n: fmt(f.failed) }),
        )}
        {kpi(t('kpi.read'), fmt(f.read), `${f.readRate}%`, t('kpi.ofSent'))}
        {kpi(
          t('kpi.sent'),
          fmt(f.sent),
          `${f.progressPct}%`,
          t('kpi.pendingCount', { n: fmt(f.pending) }),
        )}
        <StatTile
          label={t('kpi.status')}
          value={ts(`status.${s.status}`)}
          hint={
            active && firesText
              ? t('kpi.fires', { when: firesText })
              : s.status === 'paused'
                ? t('kpi.paused')
                : s.status === 'completed' && s.lastRunAt
                  ? t('kpi.done', { when: formatWhen(s.lastRunAt, s.timezone) })
                  : '—'
          }
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 rounded-md border border-border bg-background p-5 lg:col-span-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('funnel.eyebrow')}
            </div>
            <h2 className="text-lg font-semibold">{t('funnel.title')}</h2>
          </div>
          {bar(t('funnel.recipients'), f.all, f.all > 0 ? 100 : 0, 'bg-brand')}
          {bar(t('funnel.sent'), f.sent, f.progressPct, 'bg-brand')}
          {bar(t('funnel.delivered'), f.delivered, f.deliveryRate, 'bg-success')}
          {bar(t('funnel.read'), f.read, f.readRate, 'bg-success')}
          {bar(t('funnel.failed'), f.failed, f.failRate, 'bg-danger')}
        </div>
        <div className="rounded-md border border-border bg-background p-5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('mix.eyebrow')}
          </div>
          <h2 className="text-lg font-semibold">{t('mix.title')}</h2>
          {f.sent + f.failed + f.pending === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('mix.empty')}</p>
          ) : null}
          <dl className="mt-3 divide-y divide-border">
            {dl(t('mix.delivered'), fmt(f.delivered))}
            {dl(t('mix.sentOnly'), fmt(Math.max(0, f.sent - f.delivered)))}
            {dl(t('mix.failed'), fmt(f.failed))}
            {dl(t('mix.pending'), fmt(f.pending))}
          </dl>
        </div>
      </section>

      <section className="rounded-md border border-border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('recipients.eyebrow')}
            </div>
            <h2 className="text-lg font-semibold">{t('recipients.title')}</h2>
          </div>
          <div role="tablist" className="flex flex-wrap gap-1 rounded-full bg-muted p-1">
            {RECIPIENT_TABS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                data-rec-tab={k}
                onClick={() => setTab(k)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-semibold',
                  tab === k
                    ? 'bg-brand text-brand-foreground'
                    : 'text-muted-foreground hover:bg-background',
                )}
              >
                {t(`recipients.tabs.${k}`)}{' '}
                <span className="font-mono text-[10px] opacity-80">· {fmt(counts[k])}</span>
              </button>
            ))}
          </div>
        </div>
        {s.recipients.length === 0 ? (
          <div className="p-4">
            <EmptyState title={t('recipients.none')} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="border-b border-border bg-muted/50 text-muted-foreground">
                <tr>
                  {(['recipient', 'phone', 'status', 'when', 'note'] as const).map((c) => (
                    <th
                      key={c}
                      className="px-4 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]"
                    >
                      {t(`recipients.cols.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const when = r.readAt ?? r.deliveredAt ?? r.sentAt;
                  return (
                    <tr key={r.phone} data-status={r.status}>
                      <td className="px-4 py-2.5 font-medium">{r.contactName ?? '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-[11.5px]">{phoneText(r.phone)}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 font-mono text-[10.5px]',
                            r.status === 'failed'
                              ? 'bg-danger/15 text-danger'
                              : r.status === 'delivered' || r.status === 'read'
                                ? 'bg-success/15 text-success'
                                : r.status === 'sent'
                                  ? 'bg-warning/15 text-warning'
                                  : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {t(`recipients.status.${r.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11.5px]">
                        {when ? formatWhen(when, s.timezone) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-[11.5px] text-muted-foreground">
                        {r.error ?? '—'}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-xs text-muted-foreground">
                      {t('recipients.emptyTab')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {s.recipientsTruncated && (
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {t('recipients.truncated', {
              n: fmt(s.recipients.length),
              total: fmt(s.totalRecipients),
            })}
          </p>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-md border border-border bg-background p-5 lg:col-span-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('config.eyebrow')}
          </div>
          <h2 className="text-lg font-semibold">{t('config.title')}</h2>
          <dl className="mt-2 divide-y divide-border">
            {dl(t('config.scheduleType'), ts(`composer.when.modes.${s.scheduleType}.title`))}
            {dl(
              t('config.messageType'),
              ts.has(`type.${s.messageType}`) ? ts(`type.${s.messageType}`) : s.messageType,
            )}
            {dl(t('config.scheduledAt'), at(s.scheduledAt))}
            {s.nextRunAt && dl(t('config.nextRun'), at(s.nextRunAt))}
            {s.lastRunAt && dl(t('config.lastRun'), at(s.lastRunAt))}
            {s.scheduleType === 'recurring' &&
              dl(
                t('config.repeats'),
                `${s.repeatEvery || 1} ${s.repeatInterval ?? ''}${
                  s.daysOfWeek.length ? ` (${s.daysOfWeek.map((d) => DAY[d]).join(', ')})` : ''
                }${s.endDate ? ` · ${t('config.until', { date: s.endDate })}` : ''}`,
              )}
            {dl(t('config.sender'), s.senderLabel ?? '—')}
            {s.provider && dl(t('config.provider'), s.provider)}
            {s.sendAttempts > 0 && dl(t('config.attempts'), String(s.sendAttempts))}
          </dl>
        </div>
        <div className="rounded-md border border-border bg-background p-5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('preview.eyebrow')}
          </div>
          <h2 className="text-lg font-semibold">{t('preview.title')}</h2>
          <div className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-[13px]">
            {s.messageType === 'location' && s.latitude !== null && s.longitude !== null
              ? `${s.latitude}, ${s.longitude}`
              : (s.message ?? (s.media ? s.media : t('preview.empty')))}
          </div>
          {s.media && s.messageType === 'media' && (
            <p className="mt-2 break-all font-mono text-[10.5px] text-muted-foreground">
              {s.media}
            </p>
          )}
          {!isFinished(s.status) && canManage && (
            <Link
              href="/scheduled/create"
              className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-brand"
            >
              {t('another')}
              <Icon name="next" />
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}

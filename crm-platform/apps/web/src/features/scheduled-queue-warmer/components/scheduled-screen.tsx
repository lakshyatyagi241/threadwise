'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ScheduleSummary, ScheduleTab } from '@crm/contracts';
import { Alert, Button, EmptyState, Input, Spinner, StatTile, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useSchedules } from '../api/schedules';
import {
  availableActions,
  nextWhen,
  parseState,
  relativeWhen,
  stateToSearch,
  TABS,
  totalPages,
  totalsOf,
  PAGE_SIZE,
  type ListState,
} from '../lib/schedule-model';
import { formatWhen } from '../lib/time';
import { Icon, type IconName } from './icons';
import { useScheduleActions } from './schedule-actions';
import { StatusBadge } from './status-badge';
import { useErrorText } from './use-error-text';

type Translate = ReturnType<typeof useTranslations>;

const fmt = (n: number) => n.toLocaleString('en-US');

function whenText(t: Translate, iso: string, now: number): string {
  const w = relativeWhen(Date.parse(iso), now);
  return w.n === undefined ? t(`when.${w.key}`) : t(`when.${w.key}`, { n: w.n });
}

function recipientsText(t: Translate, s: ScheduleSummary): string {
  return `${fmt(s.totalRecipients)} / ${t(`recipients.${s.recipientType}`)}`;
}

/**
 * `/scheduled` (TW-SCHED-001, 002): the four-tile strip, the "up next" card, the status tabs with their counts, the search and
 * the schedule table with its row actions. The tab, the search and the page live in the address.
 */
export function ScheduledScreen() {
  const t = useTranslations('scheduled-queue-warmer.list');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const canManage = useCan('sched.schedules.manage');
  const errorText = useErrorText();
  const state = useMemo(() => parseState(new URLSearchParams(search.toString())), [search]);
  const go = (patch: Partial<ListState>) =>
    router.replace(`${pathname}${stateToSearch({ ...state, page: 1, ...patch })}`, {
      scroll: false,
    });

  // Search applies 220 ms after typing stops, without a reload.
  const [q, setQ] = useState(state.q);
  useEffect(() => {
    if (q.trim() === state.q) return;
    const id = window.setTimeout(() => go({ q: q.trim() }), 220);
    return () => window.clearTimeout(id);
    // `go` closes over the current state; the timer restarts on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const list = useSchedules(state);
  const { act, retry, dialogs } = useScheduleActions();
  const [now] = useState(() => Date.now());

  const data = list.data;
  const items = data?.items ?? [];
  const stats = data?.stats;
  const totals = totalsOf(items);
  const pages = totalPages(data?.total ?? 0);
  const filtered = state.tab !== 'all' || state.q !== '';

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('crumb')}
          </div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-brand/40 bg-brand/10 px-2.5 py-1 font-mono text-[11px] font-medium text-brand">
            {t('queued', { n: stats ? stats.upcoming + stats.running : 0 })}
          </span>
          {canManage && (
            <Link
              href="/scheduled/create"
              className="inline-flex h-9 items-center gap-2 rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground hover:opacity-90"
            >
              <Icon name="plus" />
              {t('create')}
            </Link>
          )}
        </div>
      </header>

      {list.isError && <Alert tone="danger">{errorText(list.error).text}</Alert>}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={t('stats.total')}
          value={fmt(stats?.all ?? 0)}
          hint={t('stats.totalHint')}
        />
        <StatTile
          label={t('stats.active')}
          value={fmt(stats ? stats.upcoming + stats.running : 0)}
          hint={t('stats.activeHint')}
        />
        <StatTile
          label={t('stats.sent')}
          value={fmt(totals.totalSent)}
          hint={t('stats.sentHint')}
        />
        <StatTile
          label={t('stats.delivery')}
          value={`${totals.deliveryRate}%`}
          hint={t('stats.deliveryHint')}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-md border border-border bg-background p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('upNext.eyebrow')}
              </div>
              <h2 className="text-lg font-semibold">{t('upNext.title')}</h2>
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {t('upNext.pending', { n: data?.upNext ? 1 : 0 })}
            </span>
          </div>
          {data?.upNext ? (
            <Link
              href={`/scheduled/${data.upNext.id}`}
              className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <div className="w-16 shrink-0 text-center">
                <div className="font-mono text-[10px] text-muted-foreground">
                  {whenText(t, nextWhen(data.upNext), now)}
                </div>
                <div className="mt-0.5 text-lg font-semibold leading-none">
                  {formatWhen(nextWhen(data.upNext), data.upNext.timezone).split(' · ')[1]}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold">{data.upNext.name}</div>
                <div className="font-mono text-[10.5px] text-muted-foreground">
                  {recipientsText(t, data.upNext)} · {data.upNext.messageType}
                  {data.upNext.repeatInterval ? ` · ${data.upNext.repeatInterval}` : ''}
                </div>
              </div>
              <span className="rounded-full bg-brand/10 px-2 py-0.5 font-mono text-[10.5px] text-brand">
                {data.upNext.scheduleType === 'recurring'
                  ? t('upNext.recurring')
                  : t('upNext.queued')}
              </span>
            </Link>
          ) : (
            <div className="py-6 text-center text-[12.5px] text-muted-foreground">
              {t('upNext.empty')}{' '}
              {canManage && (
                <Link href="/scheduled/create" className="font-semibold text-brand hover:underline">
                  {t('upNext.createOne')}
                </Link>
              )}
            </div>
          )}
        </div>
        <div className="rounded-md bg-brand p-5 text-brand-foreground">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
            {t('tip.eyebrow')}
          </div>
          <div className="mt-1 text-xl font-semibold leading-tight">{t('tip.title')}</div>
          <p className="mt-2 text-xs leading-relaxed opacity-85">{t('tip.body')}</p>
          {canManage && (
            <Link
              href="/scheduled/create"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-background px-4 py-2 text-xs font-semibold text-brand"
            >
              {t('tip.cta')}
              <Icon name="next" />
            </Link>
          )}
        </div>
      </section>

      <section className="rounded-md border border-border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-3">
          <div
            role="tablist"
            className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-muted p-1"
          >
            {TABS.map((tab: ScheduleTab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={state.tab === tab}
                data-sched-tab={tab}
                onClick={() => go({ tab })}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold',
                  state.tab === tab
                    ? 'bg-brand text-brand-foreground'
                    : 'text-muted-foreground hover:bg-background',
                )}
              >
                {t(`tabs.${tab}`)}
                <span className="ms-1 font-mono text-[10px] opacity-80">{stats?.[tab] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="relative min-w-[240px] max-w-[320px] flex-1">
            <Icon
              name="search"
              className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="h-9 ps-9"
            />
          </div>
        </div>

        {list.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={t('empty.title')}
              message={filtered ? t('empty.filtered') : t('empty.none')}
              actions={
                <>
                  {filtered && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQ('');
                        go({ tab: 'all', q: '' });
                      }}
                    >
                      {t('empty.reset')}
                    </Button>
                  )}
                  {canManage && (
                    <Link
                      href="/scheduled/create"
                      className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground"
                    >
                      {t('create')}
                    </Link>
                  )}
                </>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="border-b border-border bg-muted/50 text-muted-foreground">
                <tr>
                  {(
                    ['schedule', 'type', 'recipients', 'sendTime', 'repeat', 'status'] as const
                  ).map((c) => (
                    <th
                      key={c}
                      className="px-3 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]"
                    >
                      {t(`cols.${c}`)}
                    </th>
                  ))}
                  <th className="w-[200px] px-4 py-2.5 text-end font-mono text-[10px] font-normal uppercase tracking-[0.14em]">
                    {t('cols.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((s) => (
                  <ScheduleRow
                    key={s.id}
                    s={s}
                    now={now}
                    canManage={canManage}
                    act={act}
                    retry={retry}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(data?.total ?? 0) > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs">
            <span className="text-muted-foreground">{t('page', { page: state.page, pages })}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={state.page <= 1}
                onClick={() =>
                  router.replace(`${pathname}${stateToSearch({ ...state, page: state.page - 1 })}`)
                }
              >
                {t('prev')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={state.page >= pages}
                onClick={() =>
                  router.replace(`${pathname}${stateToSearch({ ...state, page: state.page + 1 })}`)
                }
              >
                {t('next')}
              </Button>
            </div>
          </div>
        )}
      </section>
      {dialogs}
    </div>
  );
}

function ScheduleRow({
  s,
  now,
  canManage,
  act,
  retry,
}: {
  s: ScheduleSummary;
  now: number;
  canManage: boolean;
  act: ReturnType<typeof useScheduleActions>['act'];
  retry: ReturnType<typeof useScheduleActions>['retry'];
}) {
  const t = useTranslations('scheduled-queue-warmer.list');
  const ts = useTranslations('scheduled-queue-warmer');
  const a = availableActions(s.status);
  const target = { id: s.id, name: s.name };
  const at = nextWhen(s);
  const sub =
    s.status === 'completed' && s.lastRunAt
      ? t('completedAt', { when: formatWhen(s.lastRunAt, s.timezone) })
      : `${whenText(t, at, now)} · ${s.timezone}`;

  const btn = (icon: IconName, label: string, onClick: () => void, danger = false) => (
    <button
      key={label}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-full hover:bg-muted',
        danger && 'text-danger hover:bg-danger/10',
      )}
    >
      <Icon name={icon} className="size-4" />
    </button>
  );

  return (
    <tr data-sched-row={s.id} data-sched-status={s.status} className="hover:bg-muted/40">
      <td className="px-3 py-3">
        <Link href={`/scheduled/${s.id}`} className="block min-w-0 hover:underline">
          <div className="truncate font-semibold">{s.name}</div>
          <div className="max-w-[260px] truncate font-mono text-[10.5px] text-muted-foreground">
            {s.senderLabel ?? '—'}
          </div>
        </Link>
      </td>
      <td className="px-3 py-3">
        <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10.5px]">
          {ts.has(`type.${s.messageType}`) ? ts(`type.${s.messageType}`) : s.messageType}
        </span>
      </td>
      <td className="px-3 py-3 font-mono text-[11.5px]">{recipientsText(t, s)}</td>
      <td className="px-3 py-3">
        <div className="font-mono text-[11.5px]">{formatWhen(at, s.timezone)}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{sub}</div>
      </td>
      <td className="px-3 py-3">
        {s.scheduleType === 'recurring' ? (
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10.5px]">
            {s.repeatInterval}
          </span>
        ) : (
          <span className="font-mono text-[10.5px] text-muted-foreground">{t('once')}</span>
        )}
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={s.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-end">
        <Link
          href={`/scheduled/${s.id}`}
          title={t('actions.open')}
          aria-label={t('actions.open')}
          className="inline-flex size-7 items-center justify-center rounded-full text-brand hover:bg-brand/10"
        >
          <Icon name="open" className="size-4" />
        </Link>
        {canManage && (
          <>
            {(s.status === 'scheduled' || s.status === 'paused') && (
              <Link
                href={`/scheduled/${s.id}/edit`}
                title={t('actions.edit')}
                aria-label={t('actions.edit')}
                className="inline-flex size-7 items-center justify-center rounded-full hover:bg-muted"
              >
                <Icon name="edit" className="size-4" />
              </Link>
            )}
            {a.pause && btn('pause', t('actions.pause'), () => act('pause', target))}
            {a.resume && btn('resume', t('actions.resume'), () => act('resume', target))}
            {a.runNow && btn('runNow', t('actions.runNow'), () => act('run-now', target))}
            {a.cancel && btn('cancel', t('actions.cancel'), () => act('cancel', target), true)}
            {a.retry && btn('retry', t('actions.retry'), () => retry(target))}
            {btn(
              'delete',
              a.runNow ? t('actions.delete') : t('actions.deleteHistory'),
              () => act('destroy', target),
              true,
            )}
          </>
        )}
      </td>
    </tr>
  );
}

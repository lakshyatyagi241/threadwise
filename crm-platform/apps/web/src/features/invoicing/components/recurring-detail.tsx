'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, Spinner } from '@crm/ui';
import { useRecurring } from '../api/hooks';
import { formatDateTime } from '../lib/dates';
import { rowActions } from '../lib/recurring';
import { BackIcon, ClockIcon, PencilIcon, RefreshIcon, TrashIcon } from './icons';
import {
  ContactPill,
  ErrorLine,
  Money,
  UserText,
  useInvoicingCan,
  useWorkspaceZone,
} from './parts';
import { RecurringInvoiceBuilder } from './recurring-builder';
import {
  amountMinorOf,
  DayText,
  RecurringStatusChip,
  useEveryText,
  useModeText,
  useRecurringActions,
} from './recurring-parts';
import { RecurringRuns } from './recurring-runs';

/**
 * `/recurring-invoices/[id]`: the schedule at a glance (status, next and last run, counts, the upcoming dates), its actions and the
 * run history. `?edit=1` shows the schedule editor in place of the summary.
 */
export function RecurringInvoiceDetail({ id }: { id: string }) {
  const t = useTranslations('invoicing.recurring.detail');
  const tr = useTranslations('invoicing.recurring');
  const router = useRouter();
  const search = useSearchParams();
  const locale = useLocale();
  const zone = useWorkspaceZone();
  const can = useInvoicingCan();
  const every = useEveryText();
  const mode = useModeText();
  const q = useRecurring(id);
  const actions = useRecurringActions({ onDeleted: () => router.replace('/recurring-invoices') });

  if (search.get('edit') === '1' && can.updateRecurring)
    return <RecurringInvoiceBuilder recurringId={id} />;

  if (q.isPending) {
    return (
      <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="space-y-3">
        <ErrorLine error={q.error} onRetry={() => void q.refetch()} />
        <Link
          href="/recurring-invoices"
          className="inline-block text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          {t('backToList')}
        </Link>
      </div>
    );
  }
  const r = q.data;
  const a = rowActions(r, { update: can.updateRecurring, remove: can.deleteRecurring });
  const stat = 'rounded-lg border border-border bg-background p-3';
  const label = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/recurring-invoices"
            aria-label={t('back')}
            title={t('back')}
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            <BackIcon className="size-4 rtl:rotate-180" />
          </Link>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold tracking-tight" dir="auto">
                {r.name}
              </h1>
              <RecurringStatusChip status={r.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {every(r.frequency, r.interval)} - {mode.full(r.mode, r.sendChannel)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {a.edit && (
            <Link
              href={`/recurring-invoices/${r.id}?edit=1`}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              <PencilIcon /> {tr('edit')}
            </Link>
          )}
          {a.pause && (
            <Button
              variant="secondary"
              className="h-10"
              disabled={actions.pending === r.id}
              onClick={() => void actions.pause(r)}
            >
              <ClockIcon /> {tr('pause')}
            </Button>
          )}
          {a.resume && (
            <Button
              variant="secondary"
              className="h-10"
              disabled={actions.pending === r.id}
              onClick={() => void actions.resume(r)}
            >
              <RefreshIcon /> {tr('resume')}
            </Button>
          )}
          {a.runNow && (
            <Button variant="brand" className="h-10" onClick={() => actions.askRunNow(r)}>
              <RefreshIcon /> {tr('runNow.action')}
            </Button>
          )}
          {a.remove && (
            <Button variant="danger" className="h-10" onClick={() => actions.askDelete(r)}>
              <TrashIcon /> {tr('delete.action')}
            </Button>
          )}
        </div>
      </header>

      {r.failureCount > 0 && (
        <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('failures', { count: r.failureCount })}</span>
          <a href="#runs" className="font-medium underline underline-offset-2">
            {t('seeHistory')}
          </a>
        </Alert>
      )}
      {r.status === 'paused' && <Alert tone="warning">{t('pausedNote')}</Alert>}
      {r.status === 'ended' && <Alert tone="info">{t('endedNote')}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={stat}>
          <div className={label}>{t('nextRun')}</div>
          <div className="mt-1 text-lg font-semibold">
            <DayText day={r.status === 'ended' ? null : r.nextRunDate} />
          </div>
          {r.status === 'paused' && (
            <div className="text-xs text-muted-foreground">{tr('onHold')}</div>
          )}
        </div>
        <div className={stat}>
          <div className={label}>{t('lastRun')}</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">
            {r.lastRunAt ? formatDateTime(r.lastRunAt, locale, zone) : '-'}
          </div>
        </div>
        <div className={stat}>
          <div className={label}>{t('runs')}</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">
            {r.maxRuns === null ? r.runCount : tr('runsOf', { done: r.runCount, max: r.maxRuns })}
          </div>
          <div className="text-xs text-muted-foreground">
            {t('failedCount', { count: r.failureCount })}
          </div>
        </div>
        <div className={stat}>
          <div className={label}>{t('amount')}</div>
          <div className="mt-1 text-lg font-semibold">
            <Money minor={amountMinorOf(r)} currency={r.currency} />
          </div>
          <div className="text-xs text-muted-foreground">{t('amountNote')}</div>
        </div>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <section
          aria-labelledby="rec-upcoming"
          className="rounded-xl border border-border bg-background"
        >
          <h2
            id="rec-upcoming"
            className="border-b border-border px-4 py-3 text-base font-semibold"
          >
            {t('upcoming')}
          </h2>
          {r.upcoming.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">{t('noUpcoming')}</p>
          ) : (
            <ol className="divide-y divide-border">
              {r.upcoming.map((d, i) => (
                <li key={d} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-6 text-xs font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <DayText day={d} className="font-medium" />
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          aria-labelledby="rec-template"
          className="rounded-xl border border-border bg-background"
        >
          <h2
            id="rec-template"
            className="border-b border-border px-4 py-3 text-base font-semibold"
          >
            {t('template')}
          </h2>
          <dl className="divide-y divide-border text-sm">
            <Row term={t('buyer')}>
              {r.contact ? (
                <ContactPill contact={{ id: r.contact.id, name: r.contact.name ?? r.buyerName }} />
              ) : r.buyerName ? (
                <UserText>{r.buyerName}</UserText>
              ) : (
                '-'
              )}
            </Row>
            <Row term={t('lines')}>{tr('lineCount', { count: r.lineCount })}</Row>
            <Row term={t('currency')}>
              <span dir="ltr">{r.currency}</span>
            </Row>
            <Row term={t('mode')}>{mode.full(r.mode, r.sendChannel)}</Row>
            <Row term={t('starts')}>
              <DayText day={r.startDate} />
            </Row>
            <Row term={t('ends')}>{r.endDate ? <DayText day={r.endDate} /> : t('never')}</Row>
            <Row term={t('limit')}>
              {r.maxRuns === null ? t('noLimit') : t('invoicesCount', { count: r.maxRuns })}
            </Row>
          </dl>
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {t('templateNote')}
          </p>
        </section>
      </div>

      <RecurringRuns id={r.id} />
      {actions.node}
    </div>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 truncate text-end font-medium">{children}</dd>
    </div>
  );
}

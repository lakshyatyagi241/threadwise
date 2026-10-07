'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WizardBroadcast } from '@crm/contracts';
import { Button, Input, Select, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useBroadcast } from '../../wizard/api/wizard';
import { useScheduleWords } from '../../wizard/components/use-words';
import { ErrorBlock, Skeleton } from '../../wizard/components/parts';
import { controlsFor, runPath } from '../../wizard/lib/broadcast';
import { useRecurringBroadcasts } from '../api';
import { seriesHref } from '../lib';
import { useDebounced, usePaging } from '../use-paging';
import { useRowControl, useScrollTo, useWorkspaceTime } from '../use-history';
import {
  Body,
  EmptyList,
  HistoryFrame,
  NUM,
  NewChip,
  Pager,
  StatusChip,
  TD,
  TH,
  TableBox,
  rowClass,
} from './parts';

const SERIES_STATUSES = ['active', 'paused', 'ended', 'cancelled'] as const;

/** The runs of one series (each is a campaign), read from the series' own detail when its row is opened. */
function Runs({ id }: { id: string }) {
  const t = useTranslations('campaigns.history');
  const time = useWorkspaceTime();
  const q = useBroadcast(id);
  if (q.isPending) return <Skeleton label={t('loading')} lines={2} />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.runList.length === 0)
    return <p className="text-sm text-muted-foreground">{t('recurring.noRuns')}</p>;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{t('recurring.runs')}</caption>
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th scope="col" className="px-2 py-1 text-start font-medium">
            {t('col.run')}
          </th>
          <th scope="col" className="px-2 py-1 text-start font-medium">
            {t('col.runAt')}
          </th>
          <th scope="col" className="px-2 py-1 text-start font-medium">
            {t('col.status')}
          </th>
          <th scope="col" className="px-2 py-1 text-end font-medium">
            {t('col.audience')}
          </th>
          <th scope="col" className="px-2 py-1 text-end font-medium">
            {t('col.sent')}
          </th>
          <th scope="col" className="px-2 py-1 text-end font-medium">
            {t('col.delivered')}
          </th>
          <th scope="col" className="px-2 py-1 text-end font-medium">
            {t('col.failed')}
          </th>
          <th scope="col" className="px-2 py-1" />
        </tr>
      </thead>
      <tbody>
        {q.data.runList.map((r) => (
          <tr key={r.id} className="border-t border-border/60">
            <td className="px-2 py-1.5 tabular-nums">#{r.occurrence}</td>
            <td className="px-2 py-1.5">{time.when(r.runAt)}</td>
            <td className="px-2 py-1.5">
              <StatusChip status={r.status} />
            </td>
            <td className={`px-2 py-1.5 ${NUM}`}>{r.counts.recipients.toLocaleString()}</td>
            <td className={`px-2 py-1.5 ${NUM}`}>{r.counts.sent.toLocaleString()}</td>
            <td className={`px-2 py-1.5 ${NUM}`}>{r.counts.delivered.toLocaleString()}</td>
            <td className={`px-2 py-1.5 ${NUM}`}>{r.counts.failed.toLocaleString()}</td>
            <td className="px-2 py-1.5 text-end">
              <Link
                href={runPath(r.id)}
                className="font-medium text-brand underline underline-offset-2"
              >
                {t('open')}
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SeriesRow({
  b,
  mark,
  open,
  onToggle,
  control,
}: {
  b: WizardBroadcast;
  mark: boolean;
  open: boolean;
  onToggle: () => void;
  control: ReturnType<typeof useRowControl>;
}) {
  const t = useTranslations('campaigns.history');
  const ta = useTranslations('campaigns.wizard.status');
  const words = useScheduleWords();
  const time = useWorkspaceTime();
  const scrollTo = useScrollTo();
  const canControl = useCan('camp.campaigns.control');
  return (
    <Fragment>
      <tr
        ref={mark ? scrollTo : undefined}
        aria-current={mark ? 'true' : undefined}
        className={rowClass(mark)}
      >
        <td className={`${TD} max-w-[16rem]`}>
          <div className="flex items-center gap-2">
            <Link
              href={seriesHref(b.id)}
              className="truncate font-medium text-brand hover:underline"
            >
              {b.name}
            </Link>
            {mark && <NewChip />}
          </div>
          {b.templateName && (
            <div className="truncate text-xs text-muted-foreground">{b.templateName}</div>
          )}
        </td>
        <td className={`${TD} max-w-[22rem] text-xs`}>{words.schedule(b.schedule)}</td>
        <td className={`${TD} whitespace-nowrap`}>{time.when(b.nextRunAt)}</td>
        <td className={`${TD} whitespace-nowrap`}>{time.when(b.lastRunAt)}</td>
        <td className={`${TD} ${NUM}`}>{b.runs.toLocaleString()}</td>
        <td className={TD}>
          <StatusChip status={b.status} />
        </td>
        <td className={`${TD} whitespace-nowrap text-end`}>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={open}
              aria-controls={`runs-${b.id}`}
              onClick={onToggle}
            >
              {open ? t('recurring.hideRuns') : t('recurring.showRuns')}
            </Button>
            {canControl &&
              controlsFor(b).map((a) => (
                <Button
                  key={a}
                  size="sm"
                  variant={a === 'cancel' ? 'danger' : a === 'resume' ? 'brand' : 'secondary'}
                  disabled={control.busy !== null}
                  onClick={() => control.act(b.id, a, true)}
                >
                  {control.busy === `${b.id}:${a}` && <Spinner />}
                  {a === 'cancel' ? t('recurring.cancel') : ta(`action.${a}`)}
                </Button>
              ))}
          </div>
        </td>
      </tr>
      {open && (
        <tr id={`runs-${b.id}`} className="border-b border-border/60 bg-muted/30">
          <td colSpan={7} className="px-6 py-3">
            <Runs id={b.id} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** `/campaigns/recurring`: the recurring series, with the rule in words, next and last run, and each series' runs. */
export function RecurringBroadcastsScreen({ highlight }: { highlight: string | null }) {
  const t = useTranslations('campaigns.history');
  const ts = useTranslations('campaigns.wizard.status.state');
  const control = useRowControl();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(search.trim());
  const paging = usePaging(`${q}|${status}`);
  const res = useRecurringBroadcasts({ q, status, cursor: paging.cursor });
  const rows = res.data?.data ?? [];

  const filters = (
    <div className="flex flex-wrap items-end gap-3" role="search">
      <label className="min-w-[12rem] max-w-md flex-1 text-xs text-muted-foreground">
        {t('filters.search')}
        <Input
          type="search"
          value={search}
          maxLength={120}
          placeholder={t('filters.searchPlaceholder')}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-1"
        />
      </label>
      <label className="w-40 text-xs text-muted-foreground">
        {t('filters.status')}
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1">
          <option value="">{t('filters.allStatuses')}</option>
          {SERIES_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );

  return (
    <HistoryFrame title={t('recurring.title')} hint={t('recurring.hint')} filters={filters}>
      <Body
        pending={res.isPending}
        error={res.isError ? res.error : null}
        onRetry={() => void res.refetch()}
        empty={
          rows.length === 0 ? (
            <EmptyList
              filtered={q !== '' || status !== ''}
              none={t('recurring.empty')}
              onClear={() => {
                setSearch('');
                setStatus('');
              }}
            />
          ) : null
        }
      >
        <TableBox label={t('recurring.title')}>
          <thead>
            <tr>
              <th scope="col" className={TH}>
                {t('col.name')}
              </th>
              <th scope="col" className={TH}>
                {t('col.rule')}
              </th>
              <th scope="col" className={TH}>
                {t('col.nextRun')}
              </th>
              <th scope="col" className={TH}>
                {t('col.lastRun')}
              </th>
              <th scope="col" className={`${TH} text-end`}>
                {t('col.runs')}
              </th>
              <th scope="col" className={TH}>
                {t('col.status')}
              </th>
              <th scope="col" className={TH}>
                <span className="sr-only">{t('col.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <SeriesRow
                key={b.id}
                b={b}
                mark={b.id === highlight}
                open={openId === b.id}
                onToggle={() => setOpenId(openId === b.id ? null : b.id)}
                control={control}
              />
            ))}
          </tbody>
        </TableBox>
        <Pager
          page={paging.page}
          hasPrev={paging.hasPrev}
          hasNext={Boolean(res.data?.page.nextCursor)}
          busy={res.isFetching}
          onPrev={paging.prev}
          onNext={() => res.data?.page.nextCursor && paging.next(res.data.page.nextCursor)}
        />
      </Body>
      {control.dialog}
    </HistoryFrame>
  );
}

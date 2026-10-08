'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { Button, Input, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useScheduledBroadcasts } from '../api';
import { canCancel, rowHref } from '../lib';
import { useDebounced, usePaging } from '../use-paging';
import { useRowControl, useScrollTo, useWorkspaceTime } from '../use-history';
import {
  Body,
  EmptyList,
  HistoryFrame,
  NUM,
  NewChip,
  Pager,
  TD,
  TH,
  TableBox,
  rowClass,
} from './parts';

/** `/campaigns/scheduled`: broadcasts waiting for their time, soonest first, in the workspace time zone, with a countdown. */
export function ScheduledBroadcastsScreen({ highlight }: { highlight: string | null }) {
  const t = useTranslations('campaigns.history');
  const ta = useTranslations('campaigns.wizard.status');
  const router = useRouter();
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const time = useWorkspaceTime();
  const scrollTo = useScrollTo();
  const canControl = useCan('camp.campaigns.control');
  const control = useRowControl();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const paging = usePaging(q);
  const res = useScheduledBroadcasts({ q, cursor: paging.cursor });
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
      <span className="pb-2 text-xs text-muted-foreground">
        {t('scheduled.zone', { zone: time.zone })}
      </span>
    </div>
  );

  return (
    <HistoryFrame title={t('scheduled.title')} hint={t('scheduled.hint')} filters={filters}>
      <Body
        pending={res.isPending}
        error={res.isError ? res.error : null}
        onRetry={() => void res.refetch()}
        empty={
          rows.length === 0 ? (
            <EmptyList
              filtered={q !== ''}
              none={t('scheduled.empty')}
              onClear={() => setSearch('')}
            />
          ) : null
        }
      >
        <TableBox label={t('scheduled.title')}>
          <thead>
            <tr>
              <th scope="col" className={TH}>
                {t('col.name')}
              </th>
              <th scope="col" className={TH}>
                {t('col.template')}
              </th>
              <th scope="col" className={`${TH} text-end`}>
                {t('col.audience')}
              </th>
              <th scope="col" className={TH}>
                {t('col.runAt')}
              </th>
              <th scope="col" className={TH}>
                {t('col.countdown')}
              </th>
              <th scope="col" className={TH}>
                {t('col.sender')}
              </th>
              <th scope="col" className={TH}>
                <span className="sr-only">{t('col.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const href = rowHref(r);
              const mark = r.id === highlight;
              const due = r.runAt ? new Date(r.runAt) : null;
              return (
                <tr
                  key={r.id}
                  ref={mark ? scrollTo : undefined}
                  aria-current={mark ? 'true' : undefined}
                  className={`${rowClass(mark)} cursor-pointer`}
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('a,button')) router.push(href);
                  }}
                >
                  <td className={`${TD} max-w-[18rem]`}>
                    <div className="flex items-center gap-2">
                      <Link href={href} className="truncate font-medium text-brand hover:underline">
                        {r.name}
                      </Link>
                      {mark && <NewChip />}
                    </div>
                  </td>
                  <td className={`${TD} max-w-[12rem] truncate`}>{r.templateName ?? '-'}</td>
                  <td className={`${TD} ${NUM}`}>{r.counts.recipients.toLocaleString()}</td>
                  <td className={`${TD} whitespace-nowrap`}>{time.when(r.runAt)}</td>
                  <td className={`${TD} whitespace-nowrap text-muted-foreground`}>
                    {due ? format.relativeTime(due, now) : '-'}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{r.senderLabel ?? '-'}</td>
                  <td className={`${TD} whitespace-nowrap text-end`}>
                    <div className="flex justify-end gap-2">
                      <Link
                        href={href}
                        className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
                      >
                        {t('open')}
                      </Link>
                      {canControl && canCancel(r) && (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={control.busy !== null}
                          onClick={() => control.act(r.id, 'cancel', false)}
                        >
                          {control.busy === `${r.id}:cancel` && <Spinner />}
                          {ta('action.cancel')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
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

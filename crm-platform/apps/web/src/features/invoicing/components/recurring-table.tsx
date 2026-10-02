'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { MenuItem, MenuSeparator, cn } from '@crm/ui';
import type { RecurringInvoiceResponse } from '@crm/contracts';
import { formatDateTime } from '../lib/dates';
import { rowActions } from '../lib/recurring';
import { frozenEdge, isScrolledSideways, STICKY_ONLY, STICKY_ONLY_HEAD } from '../lib/sticky';
import { ClockIcon, EyeIcon, PencilIcon, RefreshIcon, TrashIcon } from './icons';
import { ContactPill, Money, UserText, useInvoicingCan, useWorkspaceZone } from './parts';
import {
  amountMinorOf,
  DayText,
  RecurringStatusChip,
  useEveryText,
  useModeText,
} from './recurring-parts';
import { RowMenu } from './row-menu';

const COLUMNS = [
  'name',
  'buyer',
  'every',
  'next',
  'last',
  'runs',
  'failures',
  'amount',
  'mode',
  'status',
  'actions',
] as const;
const COL_W: Record<(typeof COLUMNS)[number], number> = {
  name: 230,
  buyer: 190,
  every: 150,
  next: 130,
  last: 170,
  runs: 110,
  failures: 100,
  amount: 140,
  mode: 170,
  status: 120,
  actions: 56,
};
const TABLE_W = COLUMNS.reduce((sum, c) => sum + COL_W[c], 0);

export interface RecurringRowHandlers {
  pendingId: string | null;
  onPause: (r: RecurringInvoiceResponse) => void;
  onResume: (r: RecurringInvoiceResponse) => void;
  onRunNow: (r: RecurringInvoiceResponse) => void;
  onDelete: (r: RecurringInvoiceResponse) => void;
}

/** The schedules, one row each: the name column stays put while the rest scrolls sideways inside the card. */
export function RecurringTable({
  rows,
  handlers,
}: {
  rows: readonly RecurringInvoiceResponse[];
  handlers: RecurringRowHandlers;
}) {
  const t = useTranslations('invoicing.recurring');
  const tc = useTranslations('invoicing.recurring.columns');
  const locale = useLocale();
  const zone = useWorkspaceZone();
  const every = useEveryText();
  const mode = useModeText();
  const can = useInvoicingCan();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const th =
    'sticky top-0 z-20 border-b border-border bg-muted px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const td = 'border-b border-border px-3 py-2';

  return (
    <div
      role="region"
      aria-label={t('scrollArea')}
      tabIndex={0}
      onScroll={(e) => setScrolled(isScrolledSideways(e.currentTarget.scrollLeft))}
      className="thin-scrollbar min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <table
        className="w-full table-fixed border-separate border-spacing-0 text-sm"
        style={{ minWidth: TABLE_W }}
      >
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c} style={{ width: COL_W[c] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c}
                scope="col"
                className={cn(
                  th,
                  (c === 'runs' || c === 'failures' || c === 'amount') && 'text-end',
                  c === 'name' && `${STICKY_ONLY_HEAD} ${frozenEdge(scrolled)}`,
                )}
              >
                {c === 'actions' ? (
                  <span className="sr-only">{tc('actions')}</span>
                ) : (
                  <span className="block truncate">{tc(c)}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const a = rowActions(r, { update: can.updateRecurring, remove: can.deleteRecurring });
            const muted = r.status === 'ended';
            const busy = handlers.pendingId === r.id;
            return (
              <tr
                key={r.id}
                aria-busy={busy}
                className={cn(
                  'group h-14 align-middle transition-colors hover:bg-muted',
                  muted && 'text-muted-foreground',
                  busy && 'opacity-60',
                )}
              >
                <td className={cn('max-w-0', td, STICKY_ONLY, frozenEdge(scrolled))}>
                  <Link
                    href={`/recurring-invoices/${r.id}`}
                    dir="auto"
                    title={r.name}
                    className="block truncate font-medium outline-none hover:underline focus-visible:underline"
                  >
                    {r.name}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground">
                    {t('lineCount', { count: r.lineCount })}
                  </div>
                </td>
                <td className={cn('max-w-0', td)}>
                  {r.contact ? (
                    <ContactPill
                      contact={{ id: r.contact.id, name: r.contact.name ?? r.buyerName }}
                    />
                  ) : r.buyerName ? (
                    <UserText className="block truncate">{r.buyerName}</UserText>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className={cn('max-w-0', td)}>
                  <span className="block truncate">{every(r.frequency, r.interval)}</span>
                </td>
                <td className={cn('max-w-0', td)}>
                  <DayText
                    day={r.status === 'ended' ? null : r.nextRunDate}
                    className={cn(
                      'block truncate',
                      r.status === 'paused' && 'text-muted-foreground',
                    )}
                  />
                  {r.status === 'paused' && r.nextRunDate && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {t('onHold')}
                    </span>
                  )}
                </td>
                <td className={cn('max-w-0', td, 'tabular-nums')}>
                  <span className="block truncate">
                    {r.lastRunAt ? formatDateTime(r.lastRunAt, locale, zone) : '-'}
                  </span>
                </td>
                <td className={cn(td, 'text-end tabular-nums')}>
                  {r.maxRuns === null
                    ? r.runCount
                    : t('runsOf', { done: r.runCount, max: r.maxRuns })}
                </td>
                <td className={cn(td, 'text-end tabular-nums')}>
                  {r.failureCount > 0 ? (
                    <Link
                      href={`/recurring-invoices/${r.id}#runs`}
                      title={t('failuresTitle', { count: r.failureCount })}
                      className="inline-flex min-w-6 items-center justify-center rounded-full bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger outline-none hover:bg-danger/25 focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {r.failureCount}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
                <td className={cn(td, 'text-end')}>
                  <Money minor={amountMinorOf(r)} currency={r.currency} className="font-medium" />
                </td>
                <td className={cn('max-w-0', td)}>
                  <span className="block truncate">{mode.short(r.mode)}</span>
                  {r.mode === 'issue_send' && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {t(
                        `channel.${r.sendChannel === 'whatsapp' ? 'whatsapp' : r.sendChannel === 'link' ? 'link' : 'email'}`,
                      )}
                    </span>
                  )}
                </td>
                <td className={td}>
                  <RecurringStatusChip status={r.status} />
                </td>
                <td className="border-b border-border px-1 py-2">
                  <RowMenu label={t('moreFor', { name: r.name })}>
                    {(close) => (
                      <>
                        <MenuItem
                          onSelect={() => {
                            close();
                            router.push(`/recurring-invoices/${r.id}`);
                          }}
                        >
                          <EyeIcon /> {t('open')}
                        </MenuItem>
                        {a.edit && (
                          <MenuItem
                            onSelect={() => {
                              close();
                              router.push(`/recurring-invoices/${r.id}?edit=1`);
                            }}
                          >
                            <PencilIcon /> {t('edit')}
                          </MenuItem>
                        )}
                        {(a.pause || a.resume || a.runNow) && <MenuSeparator />}
                        {a.pause && (
                          <MenuItem
                            onSelect={() => {
                              close();
                              handlers.onPause(r);
                            }}
                          >
                            <ClockIcon /> {t('pause')}
                          </MenuItem>
                        )}
                        {a.resume && (
                          <MenuItem
                            onSelect={() => {
                              close();
                              handlers.onResume(r);
                            }}
                          >
                            <RefreshIcon /> {t('resume')}
                          </MenuItem>
                        )}
                        {a.runNow && (
                          <MenuItem
                            onSelect={() => {
                              close();
                              handlers.onRunNow(r);
                            }}
                          >
                            <RefreshIcon /> {t('runNow.action')}
                          </MenuItem>
                        )}
                        {a.remove && (
                          <>
                            <MenuSeparator />
                            <MenuItem
                              danger
                              onSelect={() => {
                                close();
                                handlers.onDelete(r);
                              }}
                            >
                              <TrashIcon /> {t('delete.action')}
                            </MenuItem>
                          </>
                        )}
                      </>
                    )}
                  </RowMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

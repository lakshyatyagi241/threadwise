'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input, Select, Spinner } from '@crm/ui';
import { CAMPAIGN_RECIPIENT_STATUSES } from '@crm/contracts';
import { useRecipients } from '../api/campaigns';
import { pageCount } from '../lib/list-model';
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from './icons';

const STATUS_TONE: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  pending: 'bg-muted text-muted-foreground',
  sent: 'bg-brand/10 text-brand',
  delivered: 'bg-success/10 text-success',
  read: 'bg-success/15 text-success',
  responded: 'bg-success/20 text-success',
  failed: 'bg-danger/10 text-danger',
  unsubscribed: 'bg-warning/15 text-warning',
  skipped: 'bg-muted text-muted-foreground',
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/**
 * The recipient log of a campaign (TW-CAMP-019, "Messages" and "Opt-outs" tabs): who, which variant, how far each got and when,
 * 50 a page, with a status filter and a search by name or number. `fixedStatus` pins the filter (the opt-outs tab).
 */
export function RecipientsTab({ id, fixedStatus }: { id: string; fixedStatus?: string }) {
  const t = useTranslations('campaigns.detail.recipients');
  const [status, setStatus] = useState(fixedStatus ?? 'all');
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState(1);

  // Search applies once typing stops, from the first page.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(typed.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [typed]);

  const res = useRecipients(id, { status: fixedStatus ?? status, q, page });
  const rows = res.data?.data ?? [];
  const total = res.data?.page.total ?? 0;
  const pages = pageCount(total, res.data?.page.perPage ?? 50);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {fixedStatus ? (
          <span className="text-xs text-muted-foreground">{t('optOutsHint')}</span>
        ) : (
          <Select
            aria-label={t('status')}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="h-9 w-44 text-xs"
          >
            <option value="all">{t('allStatuses')}</option>
            {CAMPAIGN_RECIPIENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        )}
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="h-9 w-60 ps-9 text-xs"
          />
        </div>
      </div>

      {res.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-start text-muted-foreground">
                {(
                  [
                    'recipient',
                    'phone',
                    'variant',
                    'status',
                    'sent',
                    'delivered',
                    'read',
                    'replied',
                    'error',
                  ] as const
                ).map((k) => (
                  <th
                    key={k}
                    className="px-3 py-2.5 text-start font-mono text-[10px] uppercase tracking-wide"
                  >
                    {t(`col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border/60 last:border-0 hover:bg-muted/30"
                >
                  <td className="px-3 py-2 font-medium">{r.name || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    {r.phone || '—'}
                  </td>
                  <td className="px-3 py-2">{r.variant ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 font-mono text-[10.5px] ${STATUS_TONE[r.status] ?? ''}`}
                    >
                      {t(`statuses.${r.status}`)}
                    </span>
                    {r.clicked && (
                      <span className="ms-1 text-[10px] text-brand">{t('clicked')}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {when(r.sentAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {when(r.deliveredAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {when(r.readAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {when(r.respondedAt)}
                  </td>
                  <td
                    className="max-w-[240px] truncate px-3 py-2 text-xs text-danger"
                    title={r.error ?? undefined}
                  >
                    {r.error ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{t('showing', { shown: rows.length, total })}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="grid size-8 place-items-center rounded-md border border-border hover:bg-muted disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              aria-label={t('prev')}
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <span className="px-2 tabular-nums">
              {page} / {pages}
            </span>
            <button
              type="button"
              className="grid size-8 place-items-center rounded-md border border-border hover:bg-muted disabled:opacity-40"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
              aria-label={t('next')}
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

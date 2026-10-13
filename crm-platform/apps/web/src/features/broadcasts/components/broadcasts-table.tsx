'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTimeZone, useTranslations } from 'next-intl';
import { Badge, cn } from '@crm/ui';
import type { BroadcastListItem } from '@crm/contracts';
import {
  canDelete,
  providerTag,
  reference,
  scheduleText,
  statusLabel,
  statusTone,
} from '../lib/list-model';
import { ChartIcon, DownloadIcon, TrashIcon } from './icons';

const TH = 'px-3 py-3 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]';
const ICON_BTN =
  'grid size-7 place-items-center rounded-full border border-border bg-background outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

const num = (v: number) => v.toLocaleString();

function StatusBadge({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <Badge
      tone={tone === 'solid' || tone === 'neutral' ? 'neutral' : tone}
      className={cn(
        'gap-1 font-mono text-[10.5px]',
        tone === 'solid' && 'bg-foreground text-background',
      )}
    >
      {statusLabel(status)}
    </Badge>
  );
}

/** The broadcast table (TW-BCAST-001): one row per broadcast with its counters, status, schedule and the row actions. */
export function BroadcastsTable({
  rows,
  canExport,
  canDeleteRows,
  onExport,
  onDelete,
  unofficial = false,
  empty,
}: {
  rows: BroadcastListItem[];
  /** Shown under the column heads when there are no rows, as Reference keeps the heads on an empty list. */
  empty?: ReactNode;
  /** Whether the platform has the unofficial engine on; off, a broadcast sent through it reads "Unofficial (disabled)". */
  unofficial?: boolean;
  canExport: boolean;
  canDeleteRows: boolean;
  onExport: (b: BroadcastListItem) => void;
  onDelete: (b: BroadcastListItem) => void;
}) {
  const t = useTranslations('broadcasts.list');
  const timeZone = useTimeZone();
  const now = new Date();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] table-fixed text-sm">
        <thead className="border-b border-border bg-muted text-muted-foreground">
          <tr>
            <th className={cn(TH, 'w-[220px] px-4')}>{t('col.name')}</th>
            <th className={cn(TH, 'w-[180px]')}>{t('col.template')}</th>
            <th className={cn(TH, 'w-[90px]')}>{t('col.contacts')}</th>
            <th className={cn(TH, 'w-[80px]')}>{t('col.sent')}</th>
            <th className={cn(TH, 'w-[95px]')}>{t('col.delivered')}</th>
            <th className={cn(TH, 'w-[80px]')}>{t('col.read')}</th>
            <th className={cn(TH, 'w-[80px]')}>{t('col.failed')}</th>
            <th className={cn(TH, 'w-[80px]')}>{t('col.clicked')}</th>
            <th className={cn(TH, 'w-[150px]')}>{t('col.status')}</th>
            <th className={cn(TH, 'w-[130px] px-4')}>{t('col.schedule')}</th>
            <th className={cn(TH, 'w-[110px] text-end')}>
              <span className="sr-only">{t('col.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((b) => (
            <tr key={b.id} className="hover:bg-muted/50">
              <td className="px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Link
                    href={`/broadcasts/${b.id}`}
                    className="min-w-0 truncate font-semibold hover:underline"
                  >
                    {b.name}
                  </Link>
                  <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider">
                    {providerTag(b.provider, unofficial, t('unofficialDisabled'))}
                  </span>
                </div>
                <div className="text-[10.5px] text-muted-foreground">
                  Broadcast #{reference(b.id)}
                </div>
              </td>
              <td className="truncate px-3 py-3">{b.templateName ?? '—'}</td>
              <td className="px-3 py-3 font-mono tabular-nums">{num(b.totalRecipients)}</td>
              <td className="px-3 py-3 font-mono tabular-nums text-brand">{num(b.successCount)}</td>
              <td className="px-3 py-3 font-mono tabular-nums">{num(b.deliveredCount)}</td>
              <td className="px-3 py-3 font-mono tabular-nums">{num(b.readCount)}</td>
              <td
                className={cn(
                  'px-3 py-3 font-mono tabular-nums',
                  b.failCount > 0 ? 'text-danger' : 'text-muted-foreground',
                )}
              >
                {num(b.failCount)}
              </td>
              <td
                className={cn(
                  'px-3 py-3 font-mono tabular-nums',
                  b.clickedCount > 0 ? 'text-brand' : 'text-muted-foreground',
                )}
              >
                {num(b.clickedCount)}
              </td>
              <td className="px-3 py-3">
                <StatusBadge status={b.status} />
              </td>
              <td className="px-4 py-3 font-mono text-[11px]">
                {scheduleText(b.scheduledAt, now, t('today'), timeZone) ?? '—'}
              </td>
              <td className="px-3 py-3 text-end">
                <div className="inline-flex items-center gap-1">
                  <Link
                    href={`/broadcasts/${b.id}`}
                    className={ICON_BTN}
                    title={t('viewAnalytics')}
                    aria-label={t('viewAnalytics')}
                  >
                    <ChartIcon className="size-3.5" />
                  </Link>
                  {canExport && (
                    <button
                      type="button"
                      className={ICON_BTN}
                      title={t('exportRows')}
                      aria-label={t('exportRows')}
                      onClick={() => onExport(b)}
                    >
                      <DownloadIcon className="size-3.5" />
                    </button>
                  )}
                  {canDeleteRows && canDelete(b.status) && (
                    <button
                      type="button"
                      className={cn(ICON_BTN, 'hover:border-danger hover:text-danger')}
                      title={t('delete')}
                      aria-label={t('delete')}
                      onClick={() => onDelete(b)}
                    >
                      <TrashIcon className="size-3" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && empty}
    </div>
  );
}

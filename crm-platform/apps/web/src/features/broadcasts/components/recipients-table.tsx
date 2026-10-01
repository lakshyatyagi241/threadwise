'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { BroadcastRecipient } from '@crm/contracts';
import { formatTime, limitId, rowTone, type RowTone } from '../lib/detail-model';

const TH = 'px-3 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]';

const TONE: Record<RowTone, string> = {
  read: 'border-success/30 bg-success/10 text-success',
  delivered: 'border-success/30 bg-success/10 text-success',
  sent: 'border-border bg-muted text-foreground',
  failed: 'border-danger/30 bg-danger/10 text-danger',
  other: 'border-border bg-muted/50 text-muted-foreground',
};

/** Who got it, when (TW-BCAST-032): one row per recipient with its times in the broadcast's zone, clicks and error or message id. */
export function RecipientsTable({
  rows,
  timezone,
  empty,
}: {
  rows: BroadcastRecipient[];
  timezone: string | null;
  empty: string;
}) {
  const t = useTranslations('broadcasts.detail.recipients');
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="border-b border-border bg-muted text-muted-foreground">
          <tr>
            <th className={cn(TH, 'px-4')}>{t('name')}</th>
            <th className={TH}>{t('phone')}</th>
            <th className={TH}>{t('status')}</th>
            <th className={TH}>{t('sentAt')}</th>
            <th className={TH}>{t('deliveredAt')}</th>
            <th className={TH}>{t('readAt')}</th>
            <th className={TH}>{t('clicks')}</th>
            <th className={TH}>{t('errorOrId')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-xs text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.contactId} className="hover:bg-muted/40">
                <td className="max-w-[220px] truncate px-4 py-2.5 font-semibold">{r.name}</td>
                <td className="px-3 py-2.5 font-mono text-[11px]">{r.phone || '—'}</td>
                <td className="px-3 py-2.5">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wide',
                      TONE[rowTone(r.status)],
                    )}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono text-[10.5px]">
                  {formatTime(r.sentAt, timezone)}
                </td>
                <td className="px-3 py-2.5 font-mono text-[10.5px] text-brand">
                  {formatTime(r.deliveredAt, timezone)}
                </td>
                <td className="px-3 py-2.5 font-mono text-[10.5px] text-primary">
                  {formatTime(r.readAt, timezone)}
                </td>
                <td
                  className={cn(
                    'px-3 py-2.5 font-mono text-[10.5px]',
                    r.clicks > 0 ? 'font-semibold text-brand' : 'text-muted-foreground',
                  )}
                  title={
                    r.lastClickAt
                      ? t('lastClick', { when: formatTime(r.lastClickAt, timezone) })
                      : undefined
                  }
                >
                  {r.clicks > 0 ? r.clicks.toLocaleString() : '—'}
                </td>
                <td className="max-w-[200px] px-3 py-2.5">
                  {r.error ? (
                    <div className="truncate text-[11px] text-danger" title={r.error}>
                      {r.error}
                    </div>
                  ) : r.providerMessageId ? (
                    <div
                      className="truncate font-mono text-[10.5px] text-muted-foreground"
                      title={r.providerMessageId}
                    >
                      {limitId(r.providerMessageId)}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

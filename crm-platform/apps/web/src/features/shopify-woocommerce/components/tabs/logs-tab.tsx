'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { StoreDashboard } from '@crm/contracts';
import { formatRelative } from '@/features/auth-registration-security/shared/relative-time';
import { EmptyRow, Pill, ROW, TD, TH, TableFrame } from '../ui';

const STATUSES = ['processed', 'sent', 'skipped', 'failed'] as const;

/** The activity tab (WD-ECOM-023): counts by status and the 15 newest webhook deliveries. */
export function LogsTab({ data }: { data: StoreDashboard }) {
  const t = useTranslations('ecom.logs');
  const locale = useLocale();
  const [now] = useState(() => new Date().getTime());
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUSES.map((s) => (
          <div key={s} className="rounded-2xl border border-border bg-background p-4 shadow-sm">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t(s)}
            </div>
            <div className="mt-2 text-[26px] leading-none tabular-nums">
              {(data.logsByStatus[s] ?? 0).toLocaleString(locale)}
            </div>
          </div>
        ))}
      </div>
      <TableFrame>
        <thead>
          <tr>
            <th className={TH}>{t('event')}</th>
            <th className={TH}>{t('recipient')}</th>
            <th className={TH}>{t('status')}</th>
            <th className={TH}>{t('when')}</th>
          </tr>
        </thead>
        <tbody>
          {data.recentLogs.length === 0 ? (
            <EmptyRow cols={4}>{t('none')}</EmptyRow>
          ) : (
            data.recentLogs.map((l) => (
              <tr key={l.id} className={ROW}>
                <td className={`${TD} font-mono text-[12px]`}>{l.eventType}</td>
                <td className={TD}>{l.recipient ?? '—'}</td>
                <td className={TD} title={l.error ?? undefined}>
                  <Pill status={l.status} />
                </td>
                <td className={`${TD} text-muted-foreground`}>
                  {formatRelative(l.createdAt, now, locale)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </TableFrame>
    </div>
  );
}

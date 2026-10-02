'use client';

import { useTranslations } from 'next-intl';
import type { BroadcastDetail } from '@crm/contracts';
import { eventRows } from '../lib/detail-model';

/** Events tab (TW-BCAST-034): created, scheduled, status and completed, in the broadcast's own time zone. */
export function EventsTab({ detail }: { detail: BroadcastDetail }) {
  const t = useTranslations('broadcasts.detail.events');
  const rows = eventRows(detail.events, detail.broadcast.timezone);
  return (
    <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('kicker')}
      </div>
      <h2 className="mb-5 mt-1 text-[22px] leading-tight">{t('title')}</h2>
      <ol className="relative ms-3 space-y-5 border-s border-border">
        {rows.map((e) => (
          <li key={e.key} className="ms-5">
            <span
              className="absolute -start-1.5 mt-1.5 size-3 rounded-full border-2 border-background bg-brand"
              aria-hidden="true"
            />
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {t(e.key)}
            </div>
            <div className="text-sm">{e.value}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

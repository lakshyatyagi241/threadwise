'use client';

import { useTranslations } from 'next-intl';
import { Button, Spinner } from '@crm/ui';
import type { BroadcastDetail } from '@crm/contracts';
import { useBroadcastRecipients } from '../api/detail';
import { HBars } from './charts';

const KICKER = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
const TH = 'px-3 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]';

/** Failures tab (TW-BCAST-033): the top failure reasons as bars and the recipients that failed with their error. */
export function FailuresTab({ id, detail }: { id: string; detail: BroadcastDetail }) {
  const t = useTranslations('broadcasts.detail.failures');
  const list = useBroadcastRecipients(id, { status: 'failed' });
  const reasons = detail.failureReasons;
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
      <div className="rounded-2xl border border-border bg-background p-5 shadow-sm xl:col-span-5">
        <div className={KICKER}>{t('kicker')}</div>
        <h2 className="mt-1 text-[22px] leading-tight">{t('title')}</h2>
        {reasons.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-border py-12 text-center text-xs text-muted-foreground">
            {t('none')}
          </div>
        ) : (
          <div className="mt-4">
            <HBars
              label={t('title')}
              color="var(--danger)"
              rows={reasons.map((r) => ({ label: r.reason, value: r.count }))}
            />
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm xl:col-span-7">
        <div className="border-b border-border px-5 py-4">
          <div className={KICKER}>{t('affectedKicker')}</div>
          <h2 className="mt-1 text-[22px] leading-tight">
            {t('count', { count: detail.counts.failed })}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted text-muted-foreground">
              <tr>
                <th className={`${TH} px-4`}>{t('name')}</th>
                <th className={TH}>{t('phone')}</th>
                <th className={TH}>{t('error')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.isPending ? (
                <tr>
                  <td colSpan={3} className="py-6">
                    <div className="flex justify-center">
                      <Spinner label={t('loading')} />
                    </div>
                  </td>
                </tr>
              ) : list.items.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    —
                  </td>
                </tr>
              ) : (
                list.items.map((r) => (
                  <tr key={r.contactId}>
                    <td className="max-w-[200px] truncate px-4 py-2.5 font-semibold">{r.name}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px]">{r.phone || '—'}</td>
                    <td className="px-3 py-2.5 text-[11.5px] text-danger">
                      {r.error || t('unknown')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {list.hasNextPage && (
          <div className="flex justify-center border-t border-border p-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? t('loading') : t('more')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

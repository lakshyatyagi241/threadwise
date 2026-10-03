'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { useActivity } from '../api/catalog';
import { formatWhen } from '../lib/format';
import { CARD, LoadError, LoadingBlock, PILL_LINK, TEXT_LINK, TH } from './parts';

const MODE_TONE = {
  spm: 'bg-success/15 text-success',
  mpm: 'bg-warning/15 text-warning',
  link: 'bg-muted text-foreground',
} as const;

/** The 50 newest catalog messages the workspace sent (WD-CAT-016). */
export function ActivityTab() {
  const t = useTranslations('catalogProducts.activity');
  const locale = useLocale();
  const activity = useActivity();

  if (activity.isPending) return <LoadingBlock label={t('loading')} />;
  if (activity.isError) {
    return (
      <LoadError
        error={activity.error}
        title={t('loadError')}
        onRetry={() => void activity.refetch()}
      />
    );
  }
  const rows = activity.data.data;

  return (
    <section className={cn(CARD, 'overflow-hidden')}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <h2 className="font-serif text-[18px] font-normal leading-tight">{t('title')}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Link
          href="/catalog/send"
          className={cn(PILL_LINK, 'h-auto shrink-0 py-1.5 text-[11.5px]')}
        >
          {t('sendAnother')}
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center text-muted-foreground">
          <div className="font-serif text-[20px] text-foreground/80">{t('emptyTitle')}</div>
          <p className="mt-2 text-[12.5px]">
            {t.rich('emptyBody', {
              link: (chunks) => (
                <Link href="/catalog/send" className={TEXT_LINK}>
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead className="border-b border-border bg-muted text-muted-foreground">
              <tr>
                <th className={cn(TH, 'px-5')}>{t('col.when')}</th>
                <th className={TH}>{t('col.to')}</th>
                <th className={TH}>{t('col.mode')}</th>
                <th className={TH}>{t('col.body')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3 font-mono text-[11px]">
                    {formatWhen(r.createdAt, locale)}
                  </td>
                  <td className="px-2 py-3 font-mono">{r.recipient || '—'}</td>
                  <td className="px-2 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px]',
                        MODE_TONE[r.mode],
                      )}
                    >
                      {r.mode.toUpperCase()}
                    </span>
                  </td>
                  <td className="max-w-md px-2 py-3 text-[12px]">
                    <div className="truncate">{r.body}</div>
                    {r.status === 'failed' && (
                      <div
                        className="mt-0.5 truncate text-[11px] text-danger"
                        title={r.error ?? undefined}
                      >
                        {t('failed')}
                        {r.error ? `: ${r.error}` : ''}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

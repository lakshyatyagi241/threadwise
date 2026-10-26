'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Select, Spinner } from '@crm/ui';
import { useInsights } from '../api/viber';
import { peak, pct, segments } from '../lib/insights-model';
import { VIBER, ViberMark } from './viber-icons';

const n = (v: number) => v.toLocaleString();
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** `/viber/insights` (TW-VIB-016): message volume, active users and delivered, seen and failed counts over seven days. Read only. */
export function InsightsScreen() {
  const t = useTranslations('viber.insights');
  const [pick, setPick] = useState<string | undefined>();
  const tz = zone();
  const insights = useInsights(pick, tz);
  const data = insights.data;
  const totals = data?.totals;
  const rows = data?.rows ?? [];
  const max = peak(rows);
  const noChannels = data !== undefined && data.channels.length === 0;

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-[32px] font-normal leading-none tracking-tight sm:text-[40px]">
            {t('title')}{' '}
            <span className="not-italic" style={{ color: VIBER }}>
              {t('titleAccent')}
            </span>
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">{t('intro')}</p>
        </div>
        {data && data.channels.length > 1 && (
          <Select
            aria-label={t('channelPicker')}
            value={data.channelId ?? ''}
            onChange={(e) => setPick(e.target.value)}
            className="w-auto rounded-full font-semibold"
          >
            {data.channels.map((c, i) => (
              <option key={c.id} value={c.id}>
                {c.name || t('channelFallback', { n: i + 1 })}
              </option>
            ))}
          </Select>
        )}
      </div>

      {insights.isError && <Alert tone="danger">{t('loadError')}</Alert>}
      {insights.isLoading && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}

      {noChannels && (
        <div className="rounded-2xl border border-border bg-background p-10 text-center shadow-sm">
          <ViberMark className="mx-auto mb-3 size-12 rounded-2xl" />
          <p className="text-[13.5px]">{t('connectFirst')}</p>
          <Link
            href="/viber"
            className="mt-3 inline-flex h-9 items-center rounded-full px-4 text-xs font-semibold text-white"
            style={{ background: VIBER }}
          >
            {t('connectChannel')}
          </Link>
        </div>
      )}

      {data && totals && !noChannels && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-success/40 bg-background p-4 shadow-sm">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('tile.users')}
              </div>
              <div className="mt-2 text-[30px] leading-none">{n(totals.users)}</div>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('tile.received')}
              </div>
              <div className="mt-2 text-[30px] leading-none">{n(totals.in)}</div>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('tile.sent')}
              </div>
              <div className="mt-2 text-[30px] leading-none">{n(totals.out)}</div>
              <div className="mt-2 text-[11px] text-success">
                {t('rates', {
                  seen: pct(totals.seen, totals.out),
                  delivered: pct(totals.delivered, totals.out),
                })}
              </div>
            </div>
            <div className="rounded-2xl border border-danger/40 bg-background p-4 shadow-sm">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('tile.failed')}
              </div>
              <div className="mt-2 text-[30px] leading-none">{n(totals.failed)}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('dailyVolume')}
            </div>
            <div className="space-y-2.5">
              {rows.map((r) => {
                const w = segments(r, max);
                return (
                  <div key={r.date}>
                    <div className="mb-0.5 flex items-center justify-between text-[11.5px]">
                      <span className="font-mono text-muted-foreground">{r.date}</span>
                      <span className="text-muted-foreground">
                        <span className="text-success" title={t('inLabel')}>
                          ↓{r.in}
                        </span>{' '}
                        ·{' '}
                        <span style={{ color: VIBER }} title={t('outLabel')}>
                          ↑{r.out}
                        </span>
                      </span>
                    </div>
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-success" style={{ width: `${w.in}%` }} />
                      <div className="h-full" style={{ width: `${w.out}%`, background: VIBER }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

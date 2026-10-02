'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReferralHistoryResponse, ReferralMeResponse } from '@crm/contracts';
import { cn } from '@crm/ui';
import { deltaView, formatMoney, plusMoney } from '../lib/format';

type Stats = ReferralHistoryResponse['stats'];

function Tile({
  label,
  tag,
  tagClass,
  children,
  foot,
}: {
  label: string;
  tag?: string;
  tagClass?: string;
  children: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {tag && <span className={cn('text-xs tabular-nums', tagClass)}>{tag}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">{children}</div>
      {foot && <div className="mt-1 text-xs text-muted-foreground tabular-nums">{foot}</div>}
    </div>
  );
}

/** The five KPI cards of the history page. They are lifetime or fixed-window figures: the search never changes them. */
export function KpiStrip({ stats, me }: { stats: Stats; me: ReferralMeResponse }) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.kpi');
  const locale = useLocale();
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const money = (minor: number) => formatMoney(minor, me.currency, locale);
  const delta = deltaView(stats.deltaPct);
  return (
    <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <Tile
        label={t('signupsLifetime')}
        tag={t('vsPrev', { delta: delta.text })}
        tagClass={delta.tone === 'success' ? 'text-success' : 'text-danger'}
      >
        <span data-kpi="signupsLifetime" className="text-3xl font-semibold leading-none">
          {n(stats.signupsLifetime)}
        </span>
        <span className="text-xs text-muted-foreground">{t('people')}</span>
      </Tile>
      <Tile label={t('earned')} tag={t('lifetime')} tagClass="text-success">
        <span data-kpi="creditsLifetime" className="text-3xl font-semibold leading-none">
          {money(stats.creditsLifetimeMinor)}
        </span>
      </Tile>
      <Tile
        label={t('signups30d')}
        tag={plusMoney(stats.credits30dMinor, me.currency, locale)}
        tagClass="text-success"
      >
        <span data-kpi="signups30d" className="text-3xl font-semibold leading-none">
          {n(stats.signups30d)}
        </span>
        <span className="text-xs text-muted-foreground">{t('last30')}</span>
      </Tile>
      <Tile label={t('avg')}>
        <span data-kpi="avgPerSignup" className="text-3xl font-semibold leading-none">
          {money(stats.avgPerSignupMinor)}
        </span>
        <span className="text-xs text-muted-foreground">{t('perSignup')}</span>
      </Tile>
      <Tile
        label={t('yourCode')}
        tag={t('shareToEarn')}
        tagClass="text-success"
        foot={t('rewardPerSignup', { reward: plusMoney(me.rewardMinor, me.currency, locale) })}
      >
        <span data-kpi="code" className="truncate font-mono text-2xl font-semibold leading-none">
          {me.code}
        </span>
      </Tile>
    </section>
  );
}

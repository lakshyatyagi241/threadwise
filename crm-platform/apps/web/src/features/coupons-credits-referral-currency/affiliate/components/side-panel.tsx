'use client';

import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { ReferralHistoryResponse, ReferralMeResponse } from '@crm/contracts';
import { Button, EmptyState } from '@crm/ui';
import { formatMoney, plusMoney } from '../lib/format';

/** Code, reward, full link and Copy link. */
export function ShareCard({
  me,
  onCopy,
}: {
  me: ReferralMeResponse;
  onCopy: (url: string) => void;
}) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.share');
  const locale = useLocale();
  return (
    <div className="rounded-lg bg-brand p-5 text-brand-foreground">
      <div className="text-xs font-medium opacity-70">{t('title')}</div>
      <div className="mt-2 font-mono text-2xl font-semibold">{me.code}</div>
      <p className="mt-2 text-xs leading-relaxed opacity-85">
        {t('body', { reward: plusMoney(me.rewardMinor, me.currency, locale) })}
      </p>
      <div className="mt-3 break-all rounded-md border border-brand-foreground/15 bg-brand-foreground/15 px-3 py-2 font-mono text-xs">
        {me.link}
      </div>
      <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => onCopy(me.link)}>
        {t('copy')}
      </Button>
    </div>
  );
}

type Payout = ReferralHistoryResponse['payouts'][number];

/** The last payouts (up to 8) with when and the wallet balance after, or the empty state. */
export function PayoutsCard({
  payouts,
  currency,
  now,
}: {
  payouts: Payout[];
  currency: string;
  now: Date;
}) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.payouts');
  const format = useFormatter();
  const locale = useLocale();
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium text-muted-foreground">{t('title')}</h2>
        <Link href="/billing/wallet" className="text-xs font-semibold text-primary hover:underline">
          {t('wallet')}
        </Link>
      </div>
      {payouts.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="space-y-2.5">
          {payouts.slice(0, 8).map((p) => (
            <li key={p.id} data-payout className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-success/15 font-mono text-xs text-success"
              >
                +
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium leading-tight">
                  {plusMoney(p.amountMinor, currency, locale)}
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {t('meta', {
                    when: format.relativeTime(new Date(p.createdAt), now),
                    balance: formatMoney(p.balanceAfterMinor, currency, locale),
                  })}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The checklist; the price-per-message line is only true when the workspace pays per message. */
export function HowItWorks({ me }: { me: ReferralMeResponse }) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.how');
  const locale = useLocale();
  const steps = [
    t('share', { code: me.code }),
    t('signup'),
    t('lands', { reward: plusMoney(me.rewardMinor, me.currency, locale) }),
    ...(me.payPerMessage
      ? [t('spend', { price: formatMoney(me.creditsPerMessage, me.currency, locale) })]
      : []),
  ];
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <h2 className="mb-2 text-xs font-medium text-muted-foreground">{t('title')}</h2>
      <ul className="space-y-1.5 text-sm leading-snug">
        {steps.map((s) => (
          <li key={s} className="flex items-start gap-2">
            <svg
              viewBox="0 0 16 16"
              className="mt-0.5 h-3 w-3 shrink-0 text-primary"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M3 8l3 3 7-7" />
            </svg>
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { BILLING_KEYS, fetchBillingStatus } from '../api';
import { CancelRenewal } from './cancel-renewal';
import { PLANS_PATH, barFor } from '../lib/format';

const NS = 'plans-subscriptions-trials.bar';
/** "Connect a channel" goes to the official WhatsApp connect flow (Settings > Channels > WhatsApp). Personal numbers by QR are not offered. */
export const CONNECT_PATH = '/channels/whatsapp';

/**
 * The slim bar across the top of the app (WD-PLAN-013): a free-trial countdown, the "trial ended" notice, or the renewal reminder in the last
 * 7 days of a paid plan. Non-dismissible, one payload (`/billing/status`), nothing shown otherwise.
 */
export function TrialBar() {
  const t = useTranslations(NS);
  const locale = useLocale();
  const q = useQuery({
    queryKey: BILLING_KEYS.status,
    queryFn: ({ signal }) => fetchBillingStatus(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const { permissions } = useSession();
  if (!q.data) return null;
  const kind = barFor(q.data);
  if (!kind) return null;

  const date = q.data.planEndsAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(q.data.planEndsAt))
    : '';
  const btn =
    'inline-flex h-7 items-center rounded-md px-3 text-xs font-medium focus-visible:ring-2 focus-visible:ring-primary';
  return (
    <div
      role="status"
      data-testid="trial-bar"
      data-kind={kind}
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-foreground px-4 py-2 text-sm text-background"
    >
      <span>
        {kind === 'trial'
          ? t('trial', { days: q.data.daysLeft ?? 1 })
          : kind === 'trialEnded'
            ? t('trialEnded')
            : kind === 'grace'
              ? t('grace', { days: q.data.daysLeft ?? 1 })
              : q.data.subscription
                ? t('autoRenew', { days: q.data.daysLeft ?? 1, date })
                : t('renew', { days: q.data.daysLeft ?? 1, date })}
      </span>
      <span className="flex gap-2">
        {kind === 'trial' && (
          <Link
            href={CONNECT_PATH}
            className={`${btn} border border-background/40 hover:bg-background/10`}
          >
            {t('connect')}
          </Link>
        )}
        <Link href={PLANS_PATH} className={`${btn} bg-background text-foreground hover:opacity-90`}>
          {kind === 'renew' || kind === 'grace'
            ? q.data.subscription
              ? t('managePlan')
              : t('renewNow')
            : t('buy')}
        </Link>
        {kind === 'renew' && q.data.subscription && (
          <CancelRenewal
            compact
            subscription={q.data.subscription}
            canManage={'plan.subscription.manage' in permissions}
          />
        )}
      </span>
    </div>
  );
}

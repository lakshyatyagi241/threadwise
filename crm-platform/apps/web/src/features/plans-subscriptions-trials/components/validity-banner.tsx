'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PlanValidity } from '@crm/contracts';
import { Alert } from '@crm/ui';
import { bannerFor } from '../lib/format';

const NS = 'plans-subscriptions-trials.plans.banner';

/** The one sentence about where the workspace stands (TW-PLAN-011): expired, active until, trial, or free. */
export function ValidityBanner({
  validity,
  planName,
}: {
  validity: PlanValidity;
  planName: string | null;
}) {
  const t = useTranslations(NS);
  const locale = useLocale();
  const banner = bannerFor(validity);
  if (!banner) return null;
  const fmt = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso)) : '';
  const date = fmt(
    banner.key === 'trial' || banner.key === 'trialEnded'
      ? validity.trialEndsAt
      : validity.planEndsAt,
  );
  return (
    <Alert tone={banner.tone} data-testid="validity-banner" data-state={validity.state}>
      {t(banner.key, { date, days: validity.daysLeft ?? 0, plan: planName ?? '' })}
    </Alert>
  );
}

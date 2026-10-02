'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { authApi, keys } from '../api';
import { useSession } from '../../shared/session-context';
import { AvatarCard } from './avatar-card';
import { planBadgeName } from './plan-badge';

/**
 * The top of the account rail: photo, name, email and the plan the workspace is
 * on (TW-AUTH-024). The plan name comes from the plan catalogue; until it loads
 * (or if it cannot) the session's own plan value is shown instead.
 */
export function RailProfile() {
  const t = useTranslations('auth-registration-security.account.hub');
  const { user, org } = useSession();
  const plans = useQuery({
    queryKey: keys.plans,
    queryFn: authApi.plans,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const plan = planBadgeName(plans.data, org.plan, t('planFree'));

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 lg:flex-col lg:gap-3">
      <AvatarCard />
      <div className="min-w-0 flex-1 lg:w-full lg:flex-none lg:text-center">
        <p className="truncate text-lg font-semibold leading-tight">
          {user.displayName ?? user.fullName}
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
          {user.email}
        </p>
        {/* Hidden until the catalogue answers, so the slug never flashes before the plan's name. */}
        {!plans.isPending && (
          <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 font-mono text-[11px] text-success">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
            <span className="truncate" data-testid="plan-badge">
              {t('planBadge', { plan })}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

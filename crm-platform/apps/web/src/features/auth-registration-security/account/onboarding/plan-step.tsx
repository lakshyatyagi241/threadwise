'use client';

import type { OnboardingResponse } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Spinner } from '@crm/ui';
import { ErrorNote } from '../../shared/error-note';
import { showFlash } from '../../shared/flash';
import { redirectOnGateError } from '../../shared/gate-errors';
import { landingPath } from '../../shared/landing';
import { authApi, keys } from '../api';
import { PlanCardView } from '../plans/plan-card-view';

/**
 * Step 3 of 3: the plan picker (TW-AUTH-009). The cards are the PLAN domain's
 * active catalogue with the workspace's current plan marked; the workspace was
 * already put on the default plan at sign-up, so "start free / skip for now"
 * and the free card only finish onboarding. A paid card leads to /account/plans
 * (checkout arrives with the billing domain), a custom quote to /support. The
 * "top up credits" link Reference showed is left out: there is no wallet yet.
 */
export function PlanStep({ data, onBack }: { data: OnboardingResponse; onBack: () => void }) {
  const t = useTranslations('auth-registration-security.account.onboarding.plan');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function finish() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await authApi.completeOnboarding();
      // Where to go comes from the session: an administrator lands on the dashboard.
      const session = await authApi.session();
      queryClient.removeQueries({ queryKey: keys.onboarding });
      showFlash(t('welcome'));
      router.replace(landingPath(session.landing, session.flags));
      router.refresh();
    } catch (err) {
      if (redirectOnGateError(err, router.replace)) return;
      setError(err);
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      {data.plans.length === 0 ? (
        <Alert tone="info">{t('empty')}</Alert>
      ) : (
        <ul
          className="max-h-[28rem] space-y-4 overflow-y-auto px-1 pb-1 pt-3"
          aria-label={t('listLabel')}
        >
          {data.plans.map((plan) => (
            <li key={plan.id}>
              <PlanCardView card={plan} busy={pending} onContinueFree={() => void finish()} />
            </li>
          ))}
        </ul>
      )}

      <ErrorNote error={error} />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
          {t('back')}
        </Button>
        <Button type="button" onClick={() => void finish()} disabled={pending}>
          {pending && <Spinner label={t('finishing')} />}
          {pending ? t('finishing') : t('startFree')}
        </Button>
      </div>
    </div>
  );
}

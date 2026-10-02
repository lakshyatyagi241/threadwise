'use client';

import type { OnboardingResponse } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, LINK, Spinner } from '../../guest/ui';
import { ErrorNote } from '../../shared/error-note';
import { showFlash } from '../../shared/flash';
import { redirectOnGateError } from '../../shared/gate-errors';
import { landingPath } from '../../shared/landing';
import { authApi, keys } from '../api';
import { PlanCardView } from '../plans/plan-card-view';

/**
 * Step 3 of 3: the plan picker (WD-AUTH-009). The cards are the PLAN domain's
 * active catalogue with the workspace's current plan marked; the workspace was
 * already put on the default plan at sign-up, so "start free / skip for now"
 * and the free card only finish onboarding. A paid card leads to /account/plans
 * (checkout arrives with the billing domain), a custom quote to /support.
 *
 * Above the cards a note explains what happens when the monthly allowance runs
 * out (extra sends cost wallet credits at the platform's rate), and below them a
 * link leads to topping the credits up. Both read `billing` from the response.
 */
export function PlanStep({ data, onBack }: { data: OnboardingResponse; onBack: () => void }) {
  const t = useTranslations('auth-registration-security.account.onboarding.plan');
  const tg = useTranslations('auth-registration-security.gate.onboarding.plan');
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
    <div>
      <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-(--auth-green)/30 bg-(--auth-mint)/40 p-3.5">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-(--auth-green)/25 text-(--auth-link)">
          <svg
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5.5v.5M7.5 8h.5v3h.5" />
          </svg>
        </span>
        <p className="text-[11.5px] leading-relaxed text-(--auth-ink-700)">
          {tg.rich('credits', {
            credits: data.billing.creditsPerMessage,
            rate: (chunks) => <span className="font-semibold">{chunks}</span>,
          })}
        </p>
      </div>

      {data.plans.length === 0 ? (
        <Alert tone="info" className="border-dashed p-5 text-center">
          {t('empty')}
        </Alert>
      ) : (
        <ul
          className="max-h-[440px] space-y-2.5 overflow-y-auto px-1 pb-1 pt-3"
          aria-label={t('listLabel')}
        >
          {data.plans.map((plan) => (
            <li key={plan.id}>
              <PlanCardView card={plan} busy={pending} onContinueFree={() => void finish()} />
            </li>
          ))}
        </ul>
      )}

      <ErrorNote error={error} className="mt-3" />

      <Button
        type="button"
        variant="secondary"
        className="mt-4 w-full py-2.5 font-semibold"
        onClick={() => void finish()}
        disabled={pending}
      >
        {pending ? <Spinner label={t('finishing')} /> : null}
        {pending ? t('finishing') : t('startFree')}
      </Button>

      <p className="mt-3 text-center text-[11.5px] text-(--auth-ink-500)">
        {tg('topUpPrompt')}{' '}
        <Link href={data.billing.topUpUrl || '/account/wallet'} className={LINK}>
          {tg('topUp')}
        </Link>
      </p>

      <p className="mt-2 text-center">
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="text-[12px] text-(--auth-ink-500) hover:text-foreground disabled:opacity-60"
        >
          {t('back')}
        </button>
      </p>
    </div>
  );
}

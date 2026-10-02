'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FormHeader } from '../../guest/auth-shell';
import { StepList } from '../../guest/step-list';
import { Alert, Button, Spinner } from '../../guest/ui';
import { ErrorNote } from '../../shared/error-note';
import { signOut } from '../../shared/sign-out';
import { useSession } from '../../shared/session-context';
import { useGateRedirect } from '../../shared/use-gate-redirect';
import { authApi, keys } from '../api';
import { PlanStep } from './plan-step';
import { WorkspaceStep } from './workspace-step';

const MANAGE_PERMISSION = 'admin.settings.manage';

/**
 * First-run setup: step 2 (workspace) then step 3 (plan). Step 1 was the sign-up form. It is drawn inside the
 * sign-up page's own chrome (the admin's chosen design), so the left panel does not change between the steps;
 * this component supplies the title block and the step list, which depend on the step.
 */
export function OnboardingView({ defaultCountryIso }: { defaultCountryIso: string | null }) {
  const t = useTranslations('auth-registration-security.account.onboarding');
  const tg = useTranslations('auth-registration-security.gate.onboarding');
  const c = useTranslations('auth-registration-security.account.common');
  const router = useRouter();
  const { permissions, org } = useSession();
  const query = useQuery({
    queryKey: keys.onboarding,
    queryFn: authApi.onboarding,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  useGateRedirect(query.error);
  const [back, setBack] = useState(false);

  const done = query.data?.step === 'done';
  useEffect(() => {
    // Nothing left to set up: go where this person lands.
    if (done) router.replace('/');
  }, [done, router]);

  // The step the title shows while the data is still loading comes from the session.
  const step = (query.data?.step ?? org.onboardingStep) === 'plan' && !back ? 3 : 2;
  const header = (
    <>
      <FormHeader
        page="register"
        header={{
          eyebrow: tg(`header.step${step}.eyebrow`),
          title: tg(`header.step${step}.title`),
          accent: tg(`header.step${step}.accent`),
          subtitle: step === 3 ? tg('header.step3.subtitle') : undefined,
        }}
      />
      <StepList current={step} className="mb-4" />
    </>
  );

  if (!(MANAGE_PERMISSION in permissions)) {
    return (
      <>
        {header}
        <div className="space-y-4">
          <p className="text-[15px] font-semibold">{t('notAllowed.title')}</p>
          <Alert tone="info">{t('notAllowed.body')}</Alert>
          <Button variant="secondary" size="sm" onClick={() => void signOut()}>
            {c('signOut')}
          </Button>
        </div>
      </>
    );
  }

  if (query.isPending || done) {
    return (
      <>
        {header}
        <div className="flex items-center gap-2 text-[13px] text-(--auth-ink-500)">
          <Spinner label={c('loading')} /> {c('loading')}
        </div>
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        {header}
        <div className="space-y-3">
          <ErrorNote error={query.error} />
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            {c('retry')}
          </Button>
        </div>
      </>
    );
  }

  const data = query.data;
  const onPlan = data.step === 'plan' && !back;
  return (
    <>
      {header}
      {onPlan ? (
        <PlanStep data={data} onBack={() => setBack(true)} />
      ) : (
        <WorkspaceStep
          key={back ? 'edit' : 'first'}
          data={data}
          defaultCountryIso={defaultCountryIso}
          onSaved={() => setBack(false)}
        />
      )}
    </>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Spinner } from '@crm/ui';
import { ErrorNote } from '../../shared/error-note';
import { signOut } from '../../shared/sign-out';
import { useSession } from '../../shared/session-context';
import { useGateRedirect } from '../../shared/use-gate-redirect';
import { authApi, keys } from '../api';
import { PlanStep } from './plan-step';
import { Stepper } from './stepper';
import { WorkspaceStep } from './workspace-step';

const MANAGE_PERMISSION = 'admin.settings.manage';

/** First-run setup: step 2 (workspace) then step 3 (plan). Step 1 was the sign-up form. */
export function OnboardingView() {
  const t = useTranslations('auth-registration-security.account.onboarding');
  const c = useTranslations('auth-registration-security.account.common');
  const router = useRouter();
  const { permissions } = useSession();
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

  if (!(MANAGE_PERMISSION in permissions)) {
    return (
      <Card className="space-y-4 p-6">
        <h1 className="text-xl font-semibold">{t('notAllowed.title')}</h1>
        <Alert tone="info">{t('notAllowed.body')}</Alert>
        <Button variant="secondary" onClick={() => void signOut()}>
          {c('signOut')}
        </Button>
      </Card>
    );
  }

  if (query.isPending || done) {
    return (
      <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner label={c('loading')} /> {c('loading')}
      </Card>
    );
  }
  if (query.isError) {
    return (
      <Card className="space-y-3 p-6">
        <ErrorNote error={query.error} />
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {c('retry')}
        </Button>
      </Card>
    );
  }

  const data = query.data;
  const onPlan = data.step === 'plan' && !back;
  return (
    <Card className="space-y-6 p-5 sm:p-8">
      <Stepper current={onPlan ? 3 : 2} />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {onPlan ? t('plan.title') : t('workspace.title')}
        </h1>
        {!onPlan && <p className="text-sm text-muted-foreground">{t('workspace.subtitle')}</p>}
      </div>
      {onPlan ? (
        <PlanStep data={data} onBack={() => setBack(true)} />
      ) : (
        <WorkspaceStep key={back ? 'edit' : 'first'} data={data} onSaved={() => setBack(false)} />
      )}
    </Card>
  );
}

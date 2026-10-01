'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, Card, Spinner } from '@crm/ui';
import { BanIcon } from '../../shared/icons';
import { useSession } from '../../shared/session-context';
import { signOut } from '../../shared/sign-out';
import { gatePageRedirect } from '../gate-target';
import { useSessionRecheck } from './use-session-recheck';

/**
 * The suspended-account lock screen (TW-AUTH-016): the person can sign in but
 * nothing else works until an administrator reactivates them. It greets by
 * name, says who to ask, and offers sign out. When the tab regains focus it
 * checks whether the suspension was lifted and leaves if so.
 */
export function SuspendedView() {
  const t = useTranslations('auth-registration-security.account.suspended');
  const router = useRouter();
  const { user } = useSession();
  const [leaving, setLeaving] = useState(false);

  useSessionRecheck((fresh) => {
    const to = gatePageRedirect('suspended', { flags: fresh.flags, landing: fresh.landing });
    if (to) {
      setLeaving(true);
      router.replace(to);
    }
  });

  return (
    <Card className="mx-auto w-full max-w-md space-y-5 p-6 text-center sm:p-8">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <BanIcon className="size-6" />
      </span>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('greeting', { name: user.displayName ?? user.fullName })}
        </p>
      </div>
      <p className="rounded-md border border-border bg-muted px-4 py-3 text-sm">{t('support')}</p>
      <Button onClick={() => void signOut()} disabled={leaving} className="w-full sm:w-auto">
        {leaving && <Spinner label={t('checking')} />}
        {t('signOut')}
      </Button>
    </Card>
  );
}

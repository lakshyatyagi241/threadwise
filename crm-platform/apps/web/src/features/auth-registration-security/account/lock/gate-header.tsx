'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@crm/ui';
import { useSession } from '../../shared/session-context';
import { signOut } from '../../shared/sign-out';

/** The slim top bar of the pages that need a session but not the app shell (lock screens, onboarding). */
export function GateHeader() {
  const t = useTranslations();
  const { user } = useSession();
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <span className="text-lg font-semibold">{t('common.appName')}</span>
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="hidden truncate text-muted-foreground sm:inline" dir="ltr">
          {user.email}
        </span>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          {t('auth-registration-security.account.common.signOut')}
        </Button>
      </div>
    </header>
  );
}

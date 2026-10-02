'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, Spinner } from '../../guest/ui';
import { BanIcon } from '../../shared/icons';
import { useSession } from '../../shared/session-context';
import { signOut } from '../../shared/sign-out';
import { gatePageRedirect } from '../gate-target';
import { LockPage } from './lock-page';
import { useSessionRecheck } from './use-session-recheck';

/**
 * The suspended-account lock screen (TW-AUTH-016): the person can sign in but
 * nothing else works until an administrator reactivates them. It greets by
 * name, says who to ask, and offers sign out. When the tab regains focus it
 * checks whether the suspension was lifted and leaves if so.
 */
export function SuspendedView() {
  const t = useTranslations('auth-registration-security.account.suspended');
  const tg = useTranslations('auth-registration-security.gate.suspended');
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
    <LockPage
      tone="danger"
      icon={<BanIcon className="size-6" />}
      lead={tg('titleLead')}
      accent={tg('titleAccent')}
    >
      <p className="mt-3 text-center text-[13px] text-(--auth-ink-600)">
        {t('greeting', { name: user.displayName ?? user.fullName })}
      </p>
      <p className="mt-5 rounded-xl border border-border bg-muted px-4 py-3 text-[12px] text-(--auth-ink-700)">
        {t('support')}
      </p>
      <div className="mt-5 flex items-center justify-center">
        <Button
          size="sm"
          className="px-4 py-2 text-[12.5px]"
          onClick={() => void signOut()}
          disabled={leaving}
        >
          {leaving && <Spinner label={t('checking')} />}
          {t('signOut')}
        </Button>
      </div>
    </LockPage>
  );
}

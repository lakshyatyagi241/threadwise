'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button, Spinner } from '../../guest/ui';
import { ErrorNote } from '../../shared/error-note';
import { MailIcon } from '../../shared/icons';
import { useSession } from '../../shared/session-context';
import { signOut } from '../../shared/sign-out';
import { gatePageRedirect } from '../gate-target';
import { useResendVerification } from '../use-resend-verification';
import { LockPage } from './lock-page';
import { useSessionRecheck } from './use-session-recheck';

/**
 * The "verify your email" lock screen for the "block" policy (WD-AUTH-015/016).
 * Shows the address, resend (throttled, with a countdown from the 429's
 * retryAfterSeconds) and sign out. It re-reads the session when the tab regains
 * focus and leaves as soon as the address is verified.
 */
export function VerifyEmailRequiredView() {
  const t = useTranslations('auth-registration-security.account.verifyRequired');
  const tg = useTranslations('auth-registration-security.gate.verify');
  const router = useRouter();
  const { user } = useSession();
  const verification = useResendVerification({ onAlreadyVerified: () => router.replace('/') });
  const { notice, reason, pending, throttled, seconds, error } = verification;
  const tm = useTranslations('auth-registration-security.account.mailFailure');

  useSessionRecheck((fresh) => {
    const to = gatePageRedirect('verifyEmail', { flags: fresh.flags, landing: fresh.landing });
    if (to) router.replace(to);
  });

  return (
    <LockPage
      tone="warning"
      icon={<MailIcon className="size-6" />}
      lead={tg('titleLead')}
      accent={tg('titleAccent')}
    >
      <p className="mt-3 text-center text-[13px] text-(--auth-ink-600)">{t('body')}</p>
      <p className="mt-1 break-all text-center text-[13px] font-semibold" dir="ltr">
        {user.email}
      </p>

      <div aria-live="polite" className="mt-4 space-y-2 empty:hidden">
        {notice === 'sent' && <Alert tone="success">{t('sent', { email: user.email })}</Alert>}
        {notice === 'notSent' && (
          <Alert tone="danger" className="space-y-1">
            <p>{t('notSent')}</p>
            {reason && <p className="text-xs">{tm(reason)}</p>}
          </Alert>
        )}
        {notice === 'throttled' && <Alert tone="info">{t('throttled')}</Alert>}
        {notice === 'alreadyVerified' && <Alert tone="success">{t('alreadyVerified')}</Alert>}
        <ErrorNote error={error} />
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <Button
          size="sm"
          className="py-2 text-[12.5px]"
          onClick={() => void verification.resend()}
          disabled={pending || throttled}
        >
          {pending && <Spinner label={t('sending')} />}
          {throttled ? t('resendIn', { seconds }) : t('resend')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="py-2 text-[12.5px] font-medium"
          onClick={() => void signOut()}
        >
          {t('signOut')}
        </Button>
      </div>
      <p className="mt-5 text-center text-[11.5px] text-(--auth-ink-500)">{t('help')}</p>
    </LockPage>
  );
}

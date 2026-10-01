'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button, Card, Spinner } from '@crm/ui';
import { ErrorNote } from '../../shared/error-note';
import { MailIcon } from '../../shared/icons';
import { useSession } from '../../shared/session-context';
import { signOut } from '../../shared/sign-out';
import { gatePageRedirect } from '../gate-target';
import { useResendVerification } from '../use-resend-verification';
import { useSessionRecheck } from './use-session-recheck';

/**
 * The "verify your email" lock screen for the "block" policy (WD-AUTH-015/016).
 * Shows the address, resend (throttled, with a countdown from the 429's
 * retryAfterSeconds) and sign out. It re-reads the session when the tab regains
 * focus and leaves as soon as the address is verified.
 */
export function VerifyEmailRequiredView() {
  const t = useTranslations('auth-registration-security.account.verifyRequired');
  const router = useRouter();
  const { user } = useSession();
  const verification = useResendVerification({ onAlreadyVerified: () => router.replace('/') });
  const { notice, pending, throttled, seconds, error } = verification;

  useSessionRecheck((fresh) => {
    const to = gatePageRedirect('verifyEmail', { flags: fresh.flags, landing: fresh.landing });
    if (to) router.replace(to);
  });

  return (
    <Card className="mx-auto w-full max-w-md space-y-5 p-6 text-center sm:p-8">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
        <MailIcon className="size-6" />
      </span>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('body')}</p>
        <p className="break-all text-sm font-semibold" dir="ltr">
          {user.email}
        </p>
      </div>

      <div aria-live="polite" className="space-y-2 text-start">
        {notice === 'sent' && <Alert tone="success">{t('sent', { email: user.email })}</Alert>}
        {notice === 'notSent' && <Alert tone="danger">{t('notSent')}</Alert>}
        {notice === 'throttled' && <Alert tone="info">{t('throttled')}</Alert>}
        {notice === 'alreadyVerified' && <Alert tone="success">{t('alreadyVerified')}</Alert>}
        <ErrorNote error={error} />
      </div>

      <div className="flex flex-col gap-2">
        <Button onClick={() => void verification.resend()} disabled={pending || throttled}>
          {pending && <Spinner label={t('sending')} />}
          {throttled ? t('resendIn', { seconds }) : t('resend')}
        </Button>
        <Button variant="secondary" onClick={() => void signOut()}>
          {t('signOut')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('help')}</p>
    </Card>
  );
}

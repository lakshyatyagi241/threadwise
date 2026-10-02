'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Button, Spinner, cn } from '@crm/ui';
import { ErrorNote } from '../shared/error-note';
import { dismissFlash, useFlash } from '../shared/flash';
import { CheckIcon, CloseIcon, MailIcon } from '../shared/icons';
import { useSession } from '../shared/session-context';
import { useSessionFlag } from '../shared/use-session-flag';
import { PreferenceSync } from './preference-sync';
import { useResendVerification } from './use-resend-verification';

const FLASH_MS = 6000;

/**
 * Persistent notices above every signed-in page: the one-line flash that
 * survives a navigation ("Switched to Acme") and the email-verification nag
 * (TW-AUTH-015, policy "banner").
 */
export function AccountBanners() {
  return (
    <>
      <PreferenceSync />
      <FlashBanner />
      <VerificationBanner />
    </>
  );
}

/** The one-line notice that survives a navigation. Also rendered by the lock-screen layout. */
export function FlashBanner() {
  const t = useTranslations('auth-registration-security.account.banners');
  const flash = useFlash();
  const id = flash?.id;

  useEffect(() => {
    if (id === undefined) return;
    const timer = setTimeout(() => dismissFlash(id), FLASH_MS);
    return () => clearTimeout(timer);
  }, [id]);

  if (!flash) return null;
  const tone =
    flash.tone === 'danger'
      ? 'border-danger/40 bg-danger/10 text-danger'
      : flash.tone === 'info'
        ? 'border-border bg-muted text-foreground'
        : 'border-success/40 bg-success/10 text-success';
  return (
    <div
      role={flash.tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-center gap-2 border-b px-4 py-2 text-sm', tone)}
    >
      {flash.tone === 'success' && <CheckIcon />}
      <span className="min-w-0 flex-1">{flash.message}</span>
      <button
        type="button"
        onClick={() => dismissFlash(flash.id)}
        aria-label={t('dismiss')}
        className="rounded p-1 hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-primary"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function VerificationBanner() {
  const t = useTranslations('auth-registration-security.account.banners');
  const tm = useTranslations('auth-registration-security.account.mailFailure');
  const router = useRouter();
  const { flags, user, sessionId } = useSession();
  const [dismissed, setDismissed] = useSessionFlag(`ars.verify-banner.${sessionId}`);
  const verification = useResendVerification({ onAlreadyVerified: () => router.refresh() });

  // The lock screen replaces the banner under the "block" policy.
  if (!flags.emailUnverified || flags.emailBlocked || dismissed) return null;

  const { notice, reason, seconds, throttled, pending, error } = verification;
  return (
    <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <MailIcon className="size-4 text-warning" />
        <p className="min-w-0 flex-1">
          {t('verifyMessage', { email: user.email })}{' '}
          {notice === 'sent' && <span className="font-medium text-success">{t('sent')}</span>}
          {notice === 'notSent' && (
            <span className="font-medium text-danger">
              {t('notSent')}
              {reason ? ` ${tm(reason)}` : ''}
            </span>
          )}
          {notice === 'alreadyVerified' && (
            <span className="font-medium text-success">{t('alreadyVerified')}</span>
          )}
          {notice === 'throttled' && <span className="font-medium">{t('throttled')}</span>}
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void verification.resend()}
          disabled={pending || throttled}
        >
          {pending && <Spinner label={t('sending')} />}
          {throttled ? t('resendIn', { seconds }) : t('resend')}
        </Button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t('dismiss')}
          className="rounded p-1 hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-primary"
        >
          <CloseIcon />
        </button>
      </div>
      {error ? <ErrorNote error={error} className="mt-2" /> : null}
      {/* The countdown is announced politely once, not every second. */}
      <span className="sr-only" role="status">
        {throttled ? t('resendWait') : ''}
      </span>
    </div>
  );
}

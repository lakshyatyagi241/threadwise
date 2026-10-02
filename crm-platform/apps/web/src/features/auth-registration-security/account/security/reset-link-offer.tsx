'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ERROR_CODES,
  neutralAckSchema,
  registrationConfigResponseSchema,
  type ForgotPasswordRequest,
} from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Spinner } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { useCaptcha } from '../../guest/captcha';
import { ErrorNote } from '../../shared/error-note';
import { useSession } from '../../shared/session-context';
import { keys } from '../api';

/**
 * "No current password to type": the way out of the password-expired lock screen for an account that has no password
 * of its own (it signed in with Google or Facebook, so it holds a random one nobody knows) or whose owner forgot it.
 * Asking for the current password there would be a dead end, so this sends the same reset link the sign-in page's
 * "Forgot password" sends, to the address on the account. The request is the public one (the answer never says whether
 * the address exists), so it carries the captcha when the platform has one switched on for this action.
 */
export function ResetLinkOffer() {
  const t = useTranslations('auth-registration-security.account.password.resetLink');
  const { user, org } = useSession();
  const config = useQuery({
    queryKey: keys.registrationConfig,
    queryFn: ({ signal }) =>
      apiFetch('/auth/registration-config', { schema: registrationConfigResponseSchema, signal }),
    staleTime: 60_000,
  });
  const captcha = useCaptcha(config.data?.captcha ?? null, 'forgot');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function send() {
    if (pending) return;
    setError(null);
    if (captcha.needsInteraction) {
      setError(new ApiError(400, ERROR_CODES.AUTH_CAPTCHA_FAILED, 'Captcha required'));
      return;
    }
    setPending(true);
    try {
      const captchaToken = await captcha.token();
      const body: ForgotPasswordRequest = {
        orgSlug: org.slug,
        email: user.email,
        ...(captchaToken ? { captchaToken } : {}),
      };
      await apiFetch('/auth/forgot-password', { method: 'POST', body, schema: neutralAckSchema });
      setSent(true);
    } catch (err) {
      captcha.reset();
      setError(err);
    } finally {
      setPending(false);
    }
  }

  const captchaProblem =
    error instanceof ApiError && error.code === ERROR_CODES.AUTH_CAPTCHA_FAILED;

  return (
    <div
      className="space-y-3 rounded-md border border-border bg-muted px-3 py-3 text-sm"
      data-testid="reset-link-offer"
    >
      <div className="space-y-1">
        <p className="font-semibold">{t('title')}</p>
        <p className="text-muted-foreground">{t('body', { email: user.email })}</p>
      </div>
      {sent ? (
        <Alert tone="success">{t('sent', { email: user.email })}</Alert>
      ) : (
        <>
          {captcha.widget}
          {captchaProblem ? (
            <Alert tone="danger">{t('captchaFailed')}</Alert>
          ) : (
            <ErrorNote error={error} />
          )}
          <Button type="button" variant="secondary" onClick={() => void send()} disabled={pending}>
            {pending && <Spinner label={t('sending')} />}
            {pending ? t('sending') : t('send')}
          </Button>
        </>
      )}
    </div>
  );
}

'use client';

import { ERROR_CODES } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { isAccountLocked, lockedMinutes, retryAfterSeconds } from './error-utils';

/**
 * The shared "something went wrong" line: never the server's English wording,
 * always our own translated text chosen by error `code`, plus the request id so
 * a support request can be traced.
 */
export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  const t = useTranslations('auth-registration-security.account.errors');
  if (!error) return null;

  const api = error instanceof ApiError ? error : null;
  const wait = retryAfterSeconds(error);
  let text: string;
  if (isAccountLocked(error)) {
    // Too many wrong codes or passwords: say how long in minutes, from the API's Retry-After.
    const minutes = lockedMinutes(error);
    text = minutes ? t('lockedWait', { minutes }) : t('locked');
  } else if (api?.code === ERROR_CODES.RATE_LIMITED) {
    text = wait ? t('rateLimitedWait', { seconds: wait }) : t('rateLimited');
  } else if (api?.code === ERROR_CODES.FORBIDDEN) {
    text = t('forbidden');
  } else if (api?.code === ERROR_CODES.UNAUTHENTICATED) {
    text = t('signedOut');
  } else if (!api) {
    text = t('network');
  } else {
    text = t('unexpected');
  }

  return (
    <Alert tone="danger" className={className}>
      {text}
      {api?.requestId && (
        <span className="mt-1 block text-xs opacity-80">
          {t('requestId')}: <span className="font-mono">{api.requestId}</span>
        </span>
      )}
    </Alert>
  );
}

'use client';

import { Alert } from '@crm/ui';
import { useTranslations } from 'next-intl';
import type { MappedError } from './errors';
import { showsRequestId } from './errors';
import { PolicyList } from './policy-errors';

/** The form-level message for a failed submit: friendly text, the broken password rules, and the request id when useful. */
export function FormError({
  error,
  skipFieldMessage = false,
}: {
  error: MappedError | null;
  /** True when the message is already shown next to its input. */
  skipFieldMessage?: boolean;
}) {
  const t = useTranslations('auth-registration-security.guest');
  if (!error || skipFieldMessage) return null;
  return (
    <Alert tone="danger" className="space-y-1.5">
      <p>{t(`errors.${error.key}`, error.params)}</p>
      {error.policy.length > 0 && (
        <PolicyList issues={error.policy} className="list-disc space-y-0.5 ps-5 text-xs" />
      )}
      {showsRequestId(error) && (
        <p className="text-xs opacity-80">
          {t('errors.requestId')}: <span className="font-mono">{error.requestId}</span>
        </p>
      )}
      {error.stale && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-xs font-medium underline underline-offset-2"
        >
          {t('errors.reload')}
        </button>
      )}
    </Alert>
  );
}

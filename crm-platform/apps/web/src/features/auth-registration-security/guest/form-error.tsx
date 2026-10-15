'use client';

import { useTranslations } from 'next-intl';
import type { MappedError } from './errors';
import { PolicyList } from './policy-errors';
import { Alert } from './ui';

/**
 * The form-level message for a failed submit: friendly text, the broken password rules, and the request id when
 * useful. Nothing here clears the form: a lapsed session or a refused request leaves everything typed in place.
 */
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
    </Alert>
  );
}

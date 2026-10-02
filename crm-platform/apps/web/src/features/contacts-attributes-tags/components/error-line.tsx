'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button } from '@crm/ui';
import { errorKind, planLimitOf, requestIdOf } from '../lib/errors';

/**
 * A failed call, in our words (chosen by error code) plus the request id so a support request can be traced.
 * `onRetry` adds a "Try again" button for reads.
 */
export function ErrorLine({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations('contacts-attributes-tags.errors');
  const kind = errorKind(error);
  const requestId = requestIdOf(error);
  return (
    <Alert tone={kind === 'unavailable' ? 'warning' : 'danger'} className={className}>
      <span>{t(kind, { limit: planLimitOf(error) ?? 0 })}</span>
      {requestId && (
        <span className="mt-1 block text-xs opacity-80">
          {t('requestId')}: <span className="font-mono">{requestId}</span>
        </span>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button } from '@crm/ui';
import { errorKind, type ErrorContext } from '../lib/errors';

/**
 * A failed call, in our words (chosen by error code) plus the request id so a support request can be traced.
 * `onRetry` adds a "Try again" button for reads. `context` says whether the call was for one company or for a list (see `ErrorContext`).
 */
export function ErrorLine({
  error,
  onRetry,
  context,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  context?: ErrorContext;
  className?: string;
}) {
  const t = useTranslations('companies.errors');
  const kind = errorKind(error, context);
  return (
    <Alert tone={kind === 'unavailable' ? 'warning' : 'danger'} className={className}>
      <span>{t(kind)}</span>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

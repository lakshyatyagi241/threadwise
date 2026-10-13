'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button } from '@crm/ui';
import { errorKind } from '../lib/errors';

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
  const t = useTranslations('companies.errors');
  const kind = errorKind(error);
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

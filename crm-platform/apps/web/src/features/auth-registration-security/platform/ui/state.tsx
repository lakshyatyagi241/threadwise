'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';

/** A region that is still loading. Sized by the caller so the page does not jump when data arrives. */
export function LoadingBlock({ className }: { className?: string }) {
  const t = useTranslations('auth-registration-security.platform.common');
  return (
    <div className={className ?? 'flex min-h-40 items-center justify-center text-muted-foreground'}>
      <Spinner label={t('loading')} />
      <span className="ms-2 text-sm">{t('loading')}</span>
    </div>
  );
}

/** An API failure: a friendly sentence for known statuses, the request id for support, and a retry. */
export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations('auth-registration-security.platform.common');
  const api = error instanceof ApiError ? error : null;
  const message =
    api?.status === 403
      ? t('errors.forbidden')
      : api && api.status < 500
        ? t('errors.request')
        : t('errors.unexpected');
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{message}</p>
      {api?.requestId && (
        <p className="text-xs opacity-80">
          {t('requestId')}: <span className="font-mono">{api.requestId}</span>
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { errorKind } from './lib/errors';

const NS = 'waboo-migration.common';

export function LoadingBlock() {
  const t = useTranslations(NS);
  return (
    <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Spinner label={t('loading')} />
      {t('loading')}
    </div>
  );
}

/** A failed call: a sentence for the kind of failure, the request id for support, and a retry. */
export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations(NS);
  const api = error instanceof ApiError ? error : null;
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{t(`errors.${errorKind(error)}`)}</p>
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

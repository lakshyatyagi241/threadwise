'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button, Spinner } from '@crm/ui';
import { errorKind, requestIdOf } from '../lib/errors';

/** A region that is still loading. */
export function LoadingBlock({ className }: { className?: string }) {
  const t = useTranslations('wallet-message-billing.common');
  return (
    <div
      role="status"
      className={
        className ?? 'flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground'
      }
    >
      <Spinner label={t('loading')} />
      {t('loading')}
    </div>
  );
}

/** An API failure as a friendly sentence chosen by the error code, the request id for support, and a retry. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations('wallet-message-billing.errors');
  const tc = useTranslations('wallet-message-billing.common');
  const requestId = requestIdOf(error);
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{t(errorKind(error))}</p>
      {requestId && (
        <p className="text-xs opacity-80">
          {tc('requestId')}: <span className="font-mono">{requestId}</span>
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {tc('retry')}
        </Button>
      )}
    </Alert>
  );
}

/** The caller lacks the permission for a screen: said up front, with no request made. */
export function PermissionDenied({ permission }: { permission: string }) {
  const t = useTranslations('wallet-message-billing.common');
  return (
    <Alert tone="warning" className="space-y-0.5">
      <p className="font-medium">{t('deniedTitle')}</p>
      <p>{t('deniedBody', { permission })}</p>
    </Alert>
  );
}

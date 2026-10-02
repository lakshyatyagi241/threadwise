'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button, Spinner } from '@crm/ui';
import { errorKind, requestIdOf } from '../lib/errors';

export function LoadingBlock() {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.common');
  return (
    <div
      role="status"
      className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <Spinner label={t('loading')} />
      {t('loading')}
    </div>
  );
}

/** An API failure as a sentence chosen by status, the request id for support, and a retry. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.errors');
  const tc = useTranslations('coupons-credits-referral-currency.affiliate.common');
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

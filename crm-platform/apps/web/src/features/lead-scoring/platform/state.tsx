'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button } from '@crm/ui';
import { errorKind } from './logic';
import { PageLoader } from '@/components/page-loader';

const NS = 'lead-scoring-admin.common';

export function LoadingBlock() {
  const t = useTranslations(NS);
  return <PageLoader label={t('loading')} size={96} className="grid min-h-32 place-items-center" />;
}

/** A failed call: a sentence for the kind of failure, the request id for support, and a retry. */
export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations(NS);
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{t(`errors.${errorKind(error)}`)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}
